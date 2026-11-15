import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/heming — 合盘 AI 分析（SSE 流式）
 *
 * 请求体：{ chartA: ZiweiChart, chartB: ZiweiChart, question?: string }
 * 响应：SSE，data: {"delta":{"text":"..."}}，结尾 data: {"citations":{...}} + [DONE]
 *
 * AI 提供商配置同 /api/interpret，走 OpenAI 兼容协议。
 */
import {
  chartToContext,
  getProviderConfig,
  buildCorpusSection,
  buildNishiSection,
  refsOf,
} from '../interpret/_shared';
import { loadCorpus, type Corpus } from '@/lib/ziwei/dataset';
import { retrieveForPair } from '@/lib/corpus/from-chart';
import { createCitationFilter } from '@/lib/corpus/citation';
import type { SearchHit } from '@/lib/corpus';

function buildHemingPrompt(
  chartA: any,
  chartB: any,
  corpusA: Corpus | null,
  corpusB: Corpus | null,
  hits: SearchHit[],
  question?: string,
): string {
  const focus = question || '感情婚姻 夫妻宫 两人相处';
  return `你是紫微斗数合盘分析师，精通倪海厦《天纪》体系。请对比以下两张命盘做合盘分析。

【命盘 A】
${chartToContext(chartA)}

${buildCorpusSection(corpusA, focus)}

【命盘 B】
${chartToContext(chartB)}

${buildCorpusSection(corpusB, focus)}

${buildNishiSection(hits)}

请从以下维度分析两人的契合度：
1. **【命格互动】** 双方命宫主星的互动关系，性格互补或冲突点。
2. **【夫妻宫对照】** A 的夫妻宫 vs B 的命宫，B 的夫妻宫 vs A 的命宫，看彼此在对方眼中的形象。
3. **【四化飞星互动】** 双方生年四化对对方宫位的冲照情况。
4. **【宫位对照】** 福德、财帛、官禄等关键宫位的配合度。
5. **【综合建议】** 相处中需要注意的方面与增进关系的建议。

${question ? `\n用户特别想了解：${question}\n` : ''}
要求：用 Markdown 输出，分节用 **【标题】**；两边的断语库原文都是事实依据，不得与之矛盾；引用倪师原话时必须原样带上〔P讲次·时间码〕标记，不得自造出处；保持客观，不做绝对化断言；命理专名保留中文。`;
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

  // 两张盘各自取语料（同一年份只解压一次；不同年份会各解压一次并自动轮转清理）
  const [corpusA, corpusB] = await Promise.all([
    loadCorpus(chartA?.birthInfo),
    loadCorpus(chartB?.birthInfo),
  ]);

  // 合盘以「夫妻/相处」为主轴检索，两张盘各取 6 条后合并去重
  const t0 = Date.now();
  const hits = retrieveForPair(chartA, chartB, question || '感情婚姻 夫妻宫 相处 性格');
  const searchMs = Date.now() - t0;

  const chatMessages = [
    {
      role: 'system',
      content: '你是紫微斗数合盘分析师，精通倪海厦《天纪》体系。基于命盘宫位、星曜与断语库原文客观分析，不做绝对化断言。',
    },
    { role: 'user', content: buildHemingPrompt(chartA, chartB, corpusA, corpusB, hits, question) },
  ];

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: chatMessages, stream: true, temperature: 0.7, ...extraBody }),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `连接 AI 接口失败：${e instanceof Error ? e.message : '未知错误'}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ error: `AI 接口错误 ${upstream.status}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const filter = createCitationFilter(refsOf(hits));
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const emit = (text: string) => {
        if (!text) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`));
      };
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
              if (delta.reasoning_content) emit(delta.reasoning_content);
              if (delta.content) emit(filter.push(delta.content));
            } catch { /* skip */ }
          }
        }
        emit(filter.flush());
      } catch { /* ignore */ } finally {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ citations: filter.stats })}\n\n`));
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
      'X-Ziwei-Corpus': `${corpusA ? corpusA.key : 'miss'}|${corpusB ? corpusB.key : 'miss'}`,
      'X-Ziwei-Nishi': hits.length ? `${hits.length};${searchMs}ms` : 'miss',
    },
  });
}
