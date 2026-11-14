import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/heming — 合盘 AI 分析（SSE 流式）
 *
 * 请求体：{ chartA: ZiweiChart, chartB: ZiweiChart, question?: string }
 * 响应：SSE，data: {"delta":{"text":"..."}}，结尾 data: [DONE]
 *
 * AI 提供商配置同 /api/interpret，走 OpenAI 兼容协议。
 */
import { chartToContext, getProviderConfig } from '../interpret/_shared';

function buildHemingPrompt(chartA: any, chartB: any, question?: string): string {
  return `你是紫微斗数合盘分析师，精通倪海厦《天纪》体系。请对比以下两张命盘做合盘分析。

【命盘 A】
${chartToContext(chartA)}

【命盘 B】
${chartToContext(chartB)}

请从以下维度分析两人的契合度：
1. **【命格互动】** 双方命宫主星的互动关系，性格互补或冲突点。
2. **【夫妻宫对照】** A 的夫妻宫 vs B 的命宫，B 的夫妻宫 vs A 的命宫，看彼此在对方眼中的形象。
3. **【四化飞星互动】** 双方生年四化对对方宫位的冲照情况。
4. **【宫位对照】** 福德、财帛、官禄等关键宫位的配合度。
5. **【综合建议】** 相处中需要注意的方面与增进关系的建议。

${question ? `\n用户特别想了解：${question}\n` : ''}
要求：用 Markdown 输出，分节用 **【标题】**；保持客观，不做绝对化断言；命理专名保留中文。`;
}

export async function POST(req: NextRequest) {
  const { chartA, chartB, question } = await req.json();
  const { baseUrl, apiKey, model, extraBody } = getProviderConfig();

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: '未配置 API Key，请在 .env.local 里设置 DEEPSEEK_API_KEY 或 MIMO_API_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const chatMessages = [
    {
      role: 'system',
      content: '你是紫微斗数合盘分析师，精通倪海厦《天纪》体系。基于命盘宫位与星曜客观分析，不做绝对化断言。',
    },
    { role: 'user', content: buildHemingPrompt(chartA, chartB, question) },
  ];

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: chatMessages, stream: true, temperature: 0.7, ...extraBody }),
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ error: `AI 接口错误 ${upstream.status}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const payload = t.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta;
              if (!delta) continue;
              const text = delta.content ?? '';
              const reasoning = delta.reasoning_content ?? '';
              if (reasoning) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text: reasoning } })}\n\n`));
              }
              if (text) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`));
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* ignore */ } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
