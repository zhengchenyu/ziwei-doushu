import { NextRequest } from 'next/server';
import { chartToContext, getProviderConfig } from './_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/interpret — 排盘 AI 解读（SSE 流式）
 *
 * 请求体：{ chart: ZiweiChart, messages: {role, content}[] }
 * 响应：SSE，每行 data: {"delta":{"text":"..."}}
 * 结束：data: [DONE]
 *
 * AI 提供商用 OpenAI 兼容协议，通过 .env.local 配置（见 .env.example）。
 */

// ── 构建 system prompt ──
function buildSystemPrompt(chart: any): string {
  return `你是紫微斗数命理分析师，精通倪海厦《天纪》体系。请根据以下命盘数据回答用户问题。

${chartToContext(chart)}

要求：
1. 分析要基于命盘实际宫位与星曜，不要凭空编造。
2. 引用倪海厦观点时标注出处（如"倪师在《天纪》中指出"）。
3. 用 Markdown 输出，用 **【标题】** 分节。
4. 命理专名保留中文，如"紫微化科""七杀朝斗"。
5. 分析保持客观，给出具体建议，不做绝对化断言。
6. 涉及健康、婚姻、投资等内容声明"仅供参考，不构成专业建议"。`;
}

// ── 选 AI 提供商（在 _shared.ts）──

export async function POST(req: NextRequest) {
  const { chart, messages } = await req.json();
  const { baseUrl, apiKey, model, extraBody } = getProviderConfig();

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: '未配置 API Key，请在 .env.local 里设置 DEEPSEEK_API_KEY 或 MIMO_API_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 组装 OpenAI chat messages
  const chatMessages = [
    { role: 'system', content: buildSystemPrompt(chart) },
    ...(messages ?? []).map((m: any) => ({ role: m.role, content: m.content })),
  ];

  // 调上游（OpenAI 兼容 /chat/completions，stream=true）
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: chatMessages,
      stream: true,
      temperature: 0.7,
      ...extraBody,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '上游错误');
    return new Response(
      JSON.stringify({ error: `AI 接口错误 ${upstream.status}: ${errText.slice(0, 200)}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 把上游的 SSE 转成本项目前端期望的格式：data: {"delta":{"text":"..."}}
  // Kimi K3.1 Pro 等推理模型会先输出 reasoning_content（思考过程），
  // 再输出 content（最终回复），两者都透传给前端。
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

          // 上游每行：data: {"choices":[{"delta":{"content":"xxx"}}]}
          // 推理模型还有：data: {"choices":[{"delta":{"reasoning_content":"xxx"}}]}
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue; // 结尾我们自己发
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta;
              if (!delta) continue;
              // 优先输出 content；推理模型的 reasoning_content 也透传
              const text = delta.content ?? '';
              const reasoning = delta.reasoning_content ?? '';
              if (reasoning) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text: reasoning } })}\n\n`));
              }
              if (text) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`));
              }
            } catch {
              /* skip */
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
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
