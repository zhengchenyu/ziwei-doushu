/**
 * 从命盘 + 用户提问生成检索请求。
 *
 * 关键点：站内界面是「点宫位 / 点四化」自动提问的，所以**选中态本身就是最精确的检索键**，
 * 不需要从自然语言里猜意图。这里只做两件事：
 *   1. 把命盘的星曜、生年四化、命中格局转成结构标签；
 *   2. 从用户问句里识别宫位关键词（感情→夫妻、事业→官禄……）。
 */

import { searchCorpus, type SearchHit, type SearchQuery } from './index';

/** 问句关键词 → 宫位。长词在前，避免「夫妻感情」被「感情」先截断 */
const PALACE_KEYWORDS: [string[], string][] = [
  [['夫妻', '感情', '婚姻', '配偶', '结婚', '恋爱', '爱情', '对象', '另一半', '离婚', '桃花'], '夫妻'],
  [['事业', '工作', '升职', '创业', '职业', '老板', '同事', '考试', '学业', '考运'], '官禄'],
  [['财运', '赚钱', '收入', '投资', '理财', '钱', '破财', '负债'], '财帛'],
  [['健康', '身体', '疾病', '生病', '手术', '疾厄'], '疾厄'],
  [['子女', '孩子', '怀孕', '生育', '儿子', '女儿'], '子女'],
  [['父母', '父亲', '母亲', '长辈', '双亲'], '父母'],
  [['兄弟', '姐妹', '手足'], '兄弟'],
  [['朋友', '人际', '社交', '下属', '合作', '贵人'], '交友'],
  [['迁移', '出国', '外出', '搬迁', '外地', '旅行'], '迁移'],
  [['房产', '房子', '置业', '家宅', '田宅'], '田宅'],
  [['福德', '心情', '精神', '抑郁', '快乐', '享受'], '福德'],
  [['命格', '性格', '个性', '天赋', '格局', '一生', '命运'], '命宫'],
];

export function palacesFromText(text: string): string[] {
  const found = new Set<string>();
  for (const [words, palace] of PALACE_KEYWORDS) {
    if (words.some((w) => text.includes(w))) found.add(palace);
  }
  return [...found];
}

export function sihuaFromText(text: string): string[] {
  // 只认「化禄/化权/化科/化忌」这种完整写法，避免「福禄」这类词误命中
  return ['化禄', '化权', '化科', '化忌'].filter((h) => text.includes(h));
}

function majorStars(chart: any): string[] {
  const out = new Set<string>();
  for (const p of chart?.palaces ?? []) {
    for (const s of p.stars ?? []) {
      if (s.type === 'major') out.add(s.name);
    }
  }
  return [...out];
}

function palaceStars(chart: any, palaces: string[]): string[] {
  const out = new Set<string>();
  for (const p of chart?.palaces ?? []) {
    if (!palaces.includes(p.name)) continue;
    for (const s of p.stars ?? []) out.add(s.name);
  }
  return [...out];
}

export interface RetrieveResult {
  hits: SearchHit[];
  query: SearchQuery;
}

/**
 * 检索入口。
 *
 * 命中少时逐级放宽：先按「选中宫位 + 该宫星曜」，不够就退到全盘主星，
 * 再不够就只按问句文本——天梁只有 15 条原话，必须有兜底，不能空手。
 */
export function retrieveForChart(
  chart: any,
  userText: string,
  opts: { patterns?: string[]; limit?: number } = {}
): RetrieveResult {
  const palaceHit = palacesFromText(userText);
  const sihua = sihuaFromText(userText);

  // 点了宫位就只查这个宫的星 —— 把全盘 14 主星都塞进去，会让「廉贞」这类
  // 泛论条目盖过「夫妻宫」的具体断语，等于稀释了用户的选择。
  const targeted = palaceHit.length > 0;
  const query: SearchQuery = {
    text: `${userText}`,
    stars: targeted ? palaceStars(chart, palaceHit) : majorStars(chart).slice(0, 14),
    palaces: palaceHit,
    sihua,
    patterns: opts.patterns ?? [],
    limit: opts.limit ?? 8,
    minScore: targeted ? 2.6 : 2.2,
  };

  let hits = searchCorpus({ ...query, kinds: ['quote', 'summary'] });

  // 第一级兜底：宫位里没星（空宫借对宫）或命中太少，放宽到全盘主星
  if (hits.length < 4) {
    hits = searchCorpus({
      ...query,
      stars: [...new Set([...palaceStars(chart, palaceHit), ...majorStars(chart)])].slice(0, 14),
      minScore: 1.8,
    });
  }

  // 第二级兜底：只按问句文本
  if (hits.length < 3) {
    hits = searchCorpus({
      text: userText,
      palaces: palaceHit,
      sihua,
      kinds: ['quote', 'summary'],
      limit: query.limit,
      minScore: 1.2,
    });
  }

  // 古籍单独取 2 条：它是术语卡，不该挤掉原话的位次
  const classics = searchCorpus({ ...query, kinds: ['classic'], limit: 2, minScore: 2 });

  return { hits: [...hits, ...classics], query };
}

/** 合盘：两张盘各检索一次，按 id 去重后合并 */
export function retrieveForPair(chartA: any, chartB: any, userText: string): SearchHit[] {
  const a = retrieveForChart(chartA, userText, { limit: 6 }).hits;
  const b = retrieveForChart(chartB, userText, { limit: 6 }).hits;
  const seen = new Set<string>();
  const merged: SearchHit[] = [];
  for (const h of [...a, ...b]) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    merged.push(h);
  }
  return merged.slice(0, 10);
}
