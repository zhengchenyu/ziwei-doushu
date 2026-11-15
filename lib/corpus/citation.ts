/**
 * 引用校验：流式过滤模型输出里的出处标记。
 *
 * 模型被要求用 〔P9·00:36:09〕 这种格式标出处。流式输出会把这个标记切碎在
 * 多个 chunk 里，所以这里做一个小状态机：遇到「〔」开始缓冲，等到「〕」再判定：
 *   · 讲次存在、时间码与该次召回的原话相差 ≤90 秒 → 放行
 *   · 只有讲次没有时间码 → 放行（弱引用，但至少没编造具体秒数）
 *   · 讲次不存在或时间码对不上 → 替换为〔出处待核〕并计数
 *
 * 目的很朴素：宁可显示「出处待核」，也不能让模型编一个看着很像的时间码。
 */

export interface AllowedRef {
  part?: number;
  sec?: number;
}

export interface CitationStats {
  kept: number;
  stripped: number;
  /** 被替换掉的具体标记，便于日志排查 */
  strippedTokens: string[];
}

const MAX_PENDING = 120;      // 标记最长容忍长度
const SEC_TOLERANCE = 90;     // 时间码容差

export function createCitationFilter(refs: AllowedRef[]) {
  const allowed = new Map<number, number[]>();
  for (const r of refs) {
    if (!r.part) continue;
    const arr = allowed.get(r.part) ?? [];
    if (r.sec !== undefined) arr.push(r.sec);
    allowed.set(r.part, arr);
  }

  const stats: CitationStats = { kept: 0, stripped: 0, strippedTokens: [] };
  let pending = '';

  function judge(token: string): string {
    const body = token.slice(1, -1).replace(/\s+/g, '');
    const m = /P(\d+)(?:[·・:：,，-]?(\d{1,2}):(\d{2}):(\d{2}))?/i.exec(body);
    if (!m) {
      // 不是讲次引用（如〔推断〕〔口述〕），原样放行
      return token;
    }
    const part = Number(m[1]);
    const secs = allowed.get(part);
    if (!secs) {
      stats.stripped++;
      stats.strippedTokens.push(token);
      return '〔出处待核〕';
    }
    if (m[2] === undefined) {
      stats.kept++;
      return token;
    }
    const sec = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
    const ok = secs.some((s) => Math.abs(s - sec) <= SEC_TOLERANCE);
    if (ok) {
      stats.kept++;
      return token;
    }
    stats.stripped++;
    stats.strippedTokens.push(token);
    return '〔出处待核〕';
  }

  return {
    push(chunk: string): string {
      if (!chunk) return '';
      pending += chunk;
      let out = '';

      for (;;) {
        const open = pending.indexOf('〔');
        if (open < 0) {
          out += pending;
          pending = '';
          break;
        }
        out += pending.slice(0, open);
        const close = pending.indexOf('〕', open);
        if (close < 0) {
          if (pending.length - open > MAX_PENDING) {
            // 迟迟不闭合，按普通文本放行，避免卡住输出
            out += pending.slice(open);
            pending = '';
          } else {
            pending = pending.slice(open);
          }
          break;
        }
        out += judge(pending.slice(open, close + 1));
        pending = pending.slice(close + 1);
      }
      return out;
    },
    flush(): string {
      const rest = pending;
      pending = '';
      return rest;
    },
    stats,
  };
}

/** 非流式场景（自测 / 后处理）直接校验整段文本 */
export function verifyCitations(text: string, refs: AllowedRef[]): { text: string; stats: CitationStats } {
  const f = createCitationFilter(refs);
  const out = f.push(text) + f.flush();
  return { text: out, stats: f.stats };
}
