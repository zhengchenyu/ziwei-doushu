import { NextRequest } from 'next/server';
import {
  getProviderConfig,
  buildInterpretSystemPrompt,
  latestUserText,
  refsOf,
} from './_shared';
import { loadCorpus } from '@/lib/ziwei/dataset';
import { retrieveForChart } from '@/lib/corpus/from-chart';
import { createCitationFilter } from '@/lib/corpus/citation';
import { detectPatterns } from '@/lib/ziwei/patterns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/interpret — 排盘 AI 解读（SSE 流式）
 *
 * 请求体：{ chart: ZiweiChart, messages: {role, content}[] }
 * 响应：SSE，每行 data: {"delta":{"text":"..."}}
 * 结束：data: {"citations":{...}} 然后 data: [DONE]
 *
 * 处理顺序（先取语料，再生成）：
 *   1. 命盘 → 断语库（按年分片解压 + 二分定位，不加载整年文件）
 *   2. 命盘 + 提问 → 倪师原话检索（内存 BM25，带讲次与时间码）
 *   3. 拼 system prompt → 调模型 → 流式透传，同时校验出处标记
 */

function safePatterns(chart: any): any[] {
  try {
    return detectPatterns(chart) ?? [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const { chart, messages } = await req.json();
  const { baseUrl, apiKey, model, extraBody } = getProviderConfig();

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: '未配置 API Key，请在 .env.local 里设置 DEEPSEEK_API_KEY 或 MIMO_API_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const userText = latestUserText(messages);

  // 1) 断语库：年份分片解压 + 二分定位
  const corpus = await loadCorpus(chart?.birthInfo);

  // 2) 倪师原话：结构键（宫位/星/四化/格局）+ BM25
  const patterns = safePatterns(chart);
  const t0 = Date.now();
  // 注意：这里不把格局名塞进检索词。格局名会把「机月同梁」这类通用条目拉进来，
  // 对「夫妻宫」这种具体宫位问题反而是噪音；格局只进 prompt 的第一段。
  const { hits } = retrieveForChart(chart, userText);
  const searchMs = Date.now() - t0;

  const chatMessages = [
    {
      role: 'system',
      content: buildInterpretSystemPrompt(chart, corpus, hits, userText, { patterns }),
    },
    ...(messages ?? []).map((m: any) => ({ role: m.role, content: m.content })),
  ];

  // 调上游（OpenAI 兼容 /chat/completions，stream=true）
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
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
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `连接 AI 接口失败：${e instanceof Error ? e.message : '未知错误'}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '上游错误');
    return new Response(
      JSON.stringify({ error: `AI 接口错误 ${upstream.status}: ${errText.slice(0, 200)}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 出处校验：只放行本次召回集合里的〔P9·00:36:09〕，其余替换为〔出处待核〕
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
              // reasoning_content 是模型思考过程，不做出处校验，原样透传
              if (delta.reasoning_content) emit(delta.reasoning_content);
              if (delta.content) emit(filter.push(delta.content));
            } catch {
              /* skip */
            }
          }
        }
        emit(filter.flush());
      } catch {
        /* ignore */
      } finally {
        // 本次引用统计：前端可忽略，浏览器 Network 里能看见
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ citations: filter.stats })}\n\n`)
        );
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
      // 便于在浏览器 Network 里确认这次到底吃到了什么
      'X-Ziwei-Corpus': corpus ? `${corpus.key};${corpus.from};${corpus.elapsedMs}ms` : 'miss',
      'X-Ziwei-Nishi': hits.length ? `${hits.length};${searchMs}ms` : 'miss',
      'X-Ziwei-Patterns': patterns.length ? String(patterns.length) : '0',
    },
  });
}
