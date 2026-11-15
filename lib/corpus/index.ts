/**
 * lib/corpus —— 倪师语料检索（内存倒排 + BM25 + 结构加权）
 *
 * 语料来源（由 myscripts/build-corpus.ts 生成）：
 *   docs/tianji-ziwei/entries.jsonl   1,848 条倪师原话，带讲次/时间码/bvid
 *   research/.../summaries/*.md       逐帧精读要点
 *   lib/classics/data/*.ts            古籍节选（标注为「节选·整理」）
 *
 * 为什么是 BM25 而不是向量：
 *   这批语料只有 2,300 条短引文（约 15 万字），且判断高度依赖术语精确匹配
 *   ——「化忌冲命」与「化忌入夫妻」在向量空间里几乎重合，语义检索反而更容易串味。
 *   倒排 + BM25 + 星/宫/四化标签加权，在这个规模上更准、更快、也更好解释。
 *
 * 索引在模块首次加载时构建（约 20–40 ms），之后常驻内存，单次查询 < 5 ms。
 */

import nishiData from './data/nishi.json';
import summariesData from './data/summaries.json';
import classicsData from './data/classics.json';

export interface Tags {
  stars: string[];
  palaces: string[];
  sihua: string[];
  minor: string[];
  patterns: string[];
}

export interface CorpusDoc {
  id: string;
  kind: 'quote' | 'summary' | 'classic';
  text: string;
  part?: number;
  t?: string;
  sec?: number;
  bvid?: string;
  book: string;
  h2: string;
  h3?: string;
  note?: string;
  tags: Tags;
  w: number;
}

export interface SearchHit extends CorpusDoc {
  score: number;
  /** 引用用的短标签，如 P9·00:36:09 */
  cite: string;
  url?: string;
}

export interface SearchQuery {
  /** 自由文本（用户问题 + 宫位名 + 星名） */
  text?: string;
  stars?: string[];
  palaces?: string[];
  sihua?: string[];
  minor?: string[];
  patterns?: string[];
  /** 只在这些类型里检索；不填则全部（原话 / 摘要 / 古籍节选） */
  kinds?: Array<'quote' | 'summary' | 'classic'>;
  limit?: number;
  minScore?: number;
}

const DOCS: CorpusDoc[] = [
  ...(nishiData as CorpusDoc[]),
  ...(summariesData as CorpusDoc[]),
  ...(classicsData as CorpusDoc[]),
];

// ── 分词：中文二元组 + 拉丁词 ─────────────────────────────────────────

const CJK = /[\u4e00-\u9fff]/;

function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();

  // 拉丁 / 数字：整词
  for (const m of lower.matchAll(/[a-z0-9]{2,}/g)) out.push(m[0]);

  // 中文：按非汉字切段，每段取二元组（长度 1 的段保留单字）
  for (const seg of lower.split(/[^\u4e00-\u9fff]+/)) {
    if (!seg) continue;
    if (seg.length === 1) {
      out.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
  }
  return out;
}

// ── 倒排索引 ─────────────────────────────────────────────────────────

interface Index {
  /** token -> (docIdx -> 词频) */
  postings: Map<string, Map<number, number>>;
  lens: number[];
  avgdl: number;
  df: Map<string, number>;
}

function buildIndex(docs: CorpusDoc[]): Index {
  const postings = new Map<string, Map<number, number>>();
  const lens: number[] = new Array(docs.length);
  let total = 0;

  docs.forEach((doc, i) => {
    // 标题与册目也进索引：命中标题的条目更相关
    const toks = tokenize(`${doc.text} ${doc.h2} ${doc.h3 ?? ''} ${doc.book}`);
    lens[i] = toks.length;
    total += toks.length;
    for (const t of toks) {
      let m = postings.get(t);
      if (!m) {
        m = new Map();
        postings.set(t, m);
      }
      m.set(i, (m.get(i) ?? 0) + 1);
    }
  });

  const df = new Map<string, number>();
  for (const [t, m] of postings) df.set(t, m.size);

  return { postings, lens, avgdl: total / Math.max(docs.length, 1), df };
}

let INDEX: Index | null = null;

function index(): Index {
  if (!INDEX) INDEX = buildIndex(DOCS);
  return INDEX;
}

// ── BM25 ────────────────────────────────────────────────────────────

const K1 = 1.2;
const B = 0.75;

function idf(N: number, df: number): number {
  return Math.log(1 + (N - df + 0.5) / (df + 0.5));
}

function overlap(a: string[] | undefined, b: string[] | undefined): number {
  if (!a?.length || !b?.length) return 0;
  const set = new Set(b);
  let n = 0;
  for (const x of a) if (set.has(x)) n++;
  return n;
}

function citeOf(doc: CorpusDoc): string {
  if (doc.kind === 'classic') return doc.book.replace(/（.*?）/, '');
  const p = doc.part ? `P${doc.part}` : doc.id.slice(0, 2);
  return doc.t ? `${p}·${doc.t}` : p;
}

function urlOf(doc: CorpusDoc): string | undefined {
  if (!doc.bvid || doc.sec === undefined) return undefined;
  return `https://www.bilibili.com/video/${doc.bvid}?p=${doc.part}&t=${doc.sec}`;
}

/**
 * 检索：BM25 分数 + 结构命中加权，按册目去重（同一小节最多 2 条）。
 */
export function searchCorpus(query: SearchQuery): SearchHit[] {
  const { postings, lens, avgdl, df } = index();
  const N = DOCS.length;
  const limit = query.limit ?? 8;
  const minScore = query.minScore ?? 1.5;

  const qTokens = new Map<string, number>();
  for (const t of tokenize(query.text ?? '')) qTokens.set(t, (qTokens.get(t) ?? 0) + 1);

  // 把结构词也当查询词，让「夫妻宫」这类标题命中
  for (const term of [...(query.palaces ?? []), ...(query.stars ?? []), ...(query.sihua ?? []), ...(query.patterns ?? [])]) {
    for (const t of tokenize(term)) qTokens.set(t, (qTokens.get(t) ?? 0) + 1);
  }

  // 累加 BM25
  const score = new Float64Array(DOCS.length);
  for (const [tok, qtf] of qTokens) {
    const m = postings.get(tok);
    if (!m) continue;
    const w = idf(N, df.get(tok) ?? 0) * (1 + Math.log(qtf));
    for (const [idx, tf] of m) {
      const norm = 1 - B + (B * lens[idx]) / avgdl;
      score[idx] += (w * tf * (K1 + 1)) / (tf + K1 * norm);
    }
  }

  // 结构加权
  const hits: SearchHit[] = [];
  for (let i = 0; i < DOCS.length; i++) {
    const doc = DOCS[i];
    if (query.kinds && !query.kinds.includes(doc.kind)) continue;
    const sStars = overlap(query.stars, doc.tags.stars);
    const sPal = overlap(query.palaces, doc.tags.palaces);
    const sHua = overlap(query.sihua, doc.tags.sihua);
    const sMinor = overlap(query.minor, doc.tags.minor);
    const sPat = overlap(query.patterns, doc.tags.patterns);

    const struct = sStars * 2.6 + sPal * 4.0 + sHua * 2.0 + sMinor * 0.8 + sPat * 1.6;
    const raw = (score[i] + struct) * doc.w;
    if (raw < minScore) continue;

    hits.push({ ...doc, score: Math.round(raw * 100) / 100, cite: citeOf(doc), url: urlOf(doc) });
  }

  hits.sort((a, b) => b.score - a.score);

  // 宫位是硬约束：用户点了「夫妻宫」，就不该把「子女宫按星论儿子」排到第一。
  // 只排除「明确标了别的宫位」的条目；没有宫位标签的仍保留（标签覆盖率只有一半）。
  let pool = hits;
  if (query.palaces?.length) {
    const strict = hits.filter(
      (h) => h.tags.palaces.length === 0 || overlap(query.palaces, h.tags.palaces) > 0
    );
    if (strict.length >= 4) pool = strict;
  }

  // 按「册目 + 小节」去重：8 条里不要 5 条都来自同一个 h2
  const perGroup = new Map<string, number>();
  const picked: SearchHit[] = [];
  for (const h of pool) {
    const key = `${h.book}|${h.h2}`;
    const n = perGroup.get(key) ?? 0;
    if (n >= 2) continue;
    perGroup.set(key, n + 1);
    picked.push(h);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** 语料规模，供响应头与自测使用 */
export function corpusStats() {
  return {
    docs: DOCS.length,
    quotes: DOCS.filter((d) => d.kind === 'quote').length,
    summaries: DOCS.filter((d) => d.kind === 'summary').length,
    classics: DOCS.filter((d) => d.kind === 'classic').length,
    chars: DOCS.reduce((s, d) => s + d.text.length, 0),
  };
}

/** 供自测：按 id 取条目 */
export function getDocById(id: string): CorpusDoc | undefined {
  return DOCS.find((d) => d.id === id);
}

export { DOCS };
