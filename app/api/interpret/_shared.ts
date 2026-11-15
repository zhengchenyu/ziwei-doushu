/**
 * /api/interpret 与 /api/heming 共用的工具函数。
 *
 * prompt 的结构是固定的四段，顺序有讲究：
 *   【命盘结构 + 格局】  引擎确定性算出来的事实
 *   【断语库原文】       本盘 13 维官方断语，是「结论层」
 *   【倪师原话】         检索出来的原话，带讲次与时间码，是「依据层」
 *   【输出要求】         只能引用上面给的出处，不许自造
 *
 * 层次不能混：结论听断语库，原话只用来解释「为什么这么说」。
 */

import { selectCorpus, type Corpus } from '@/lib/ziwei/dataset';
import type { SearchHit } from '@/lib/corpus';
import type { AllowedRef } from '@/lib/corpus/citation';

const BRIGHTNESS: Record<string, string> = {
  bright: '庙旺',
  normal: '平',
  dim: '落陷',
};

function starText(s: any): string {
  const b = BRIGHTNESS[s?.brightness] ?? '';
  const hua = s?.siHua ? `化${s.siHua}` : '';
  return `${s?.name ?? '?'}${b ? `(${b})` : ''}${hua ? `[${hua}]` : ''}`;
}

/** 把命盘结构压缩成给 AI 的上下文文本 */
export function chartToContext(chart: any): string {
  const palaces: any[] = chart?.palaces ?? [];
  const lines: string[] = ['【命盘结构】'];

  if (chart?.wuxingJuName) lines.push(`五行局：${chart.wuxingJuName}`);
  lines.push('');

  for (const p of palaces) {
    const stars = (p.stars ?? []).map(starText).join('、') || '空宫';
    const marks = [
      p.isMingGong ? '命宫' : '',
      p.isShenGong ? '身宫' : '',
      p.isCurrentDaXian ? '当前大限' : '',
    ].filter(Boolean).join('/');
    lines.push(`${p.name}(${p.branch}${p.stem ? `·${p.stem}` : ''})${marks ? `〔${marks}〕` : ''}: ${stars}`);
  }

  // 生年四化：从星曜上反查，比让模型自己找可靠
  const sihua: string[] = [];
  for (const p of palaces) {
    for (const s of p.stars ?? []) {
      if (s.siHua) sihua.push(`${s.name}化${s.siHua}在${p.name}`);
    }
  }
  if (sihua.length) lines.push('', `【生年四化】${sihua.join('；')}`);

  // 当前大限：字段是 daXians + currentDaXianIndex（不是 dashian）
  const daXians: any[] = chart?.daXians ?? [];
  const idx = typeof chart?.currentDaXianIndex === 'number' ? chart.currentDaXianIndex : -1;
  const cur = idx >= 0 ? daXians[idx] : undefined;
  if (cur) {
    lines.push(`【当前大限】${cur.startAge}–${cur.endAge} 岁，行至${cur.palaceName}宫（${cur.palaceBranch}）`);
  }
  if (typeof chart?.currentAge === 'number') {
    lines.push(`【当前年龄】${chart.currentAge} 岁`);
  }

  return lines.join('\n');
}

/**
 * 命中格局：34 条格局规则（带古籍出处）已经在 UI 上展示了，
 * 但一直没进 prompt。这里补上，模型才有「成格/破格」的判断依据。
 */
export function buildPatternsSection(chart: any, patterns: any[] = []): string {
  if (!patterns.length) return '';

  const rank: Record<string, number> = { excellent: 0, good: 1, neutral: 2, caution: 3 };
  const top = [...patterns].sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9)).slice(0, 6);

  const lines = ['【命中格局】'];
  top.forEach((p, i) => {
    const lvl = { excellent: '上格', good: '吉格', neutral: '中格', caution: '破格' }[p.level as string] ?? '';
    lines.push(`${i + 1}. ${p.name}（${lvl}${p.source ? `，${p.source}` : ''}）：${p.description ?? ''}`);
  });
  return lines.join('\n');
}

/** 取最后一条用户消息，用于判断这次问的是哪个维度 */
export function latestUserText(messages: { role: string; content: string }[] | undefined): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

/**
 * 断语库原文段：把数据集里这张盘的 13 维解读按问题挑几条拼进提示词。
 * 取不到语料时显式降级，并禁止模型假装引用了原文。
 */
export function buildCorpusSection(corpus: Corpus | null, userText: string): string {
  if (!corpus) {
    return [
      '【断语库】本次未取到本地语料（可能原因：出生年份早于 1950 或晚于 2026、数据集未下载、该年文件解压失败）。',
      '请只依据上面的命盘结构作答，并在开头说明「本次未接入断语库原文，以下为基于命盘结构的通用推断」；',
      '严禁编造「断语库原文」「古籍原文」这类出处。',
    ].join('\n');
  }

  const picked = selectCorpus(corpus, userText);
  const lines = [
    `【断语库原文】数据源：紫微斗数开源解读数据集 v4.0（CC BY 4.0）｜命盘键 ${corpus.key}｜命宫主星：${corpus.mingStar ?? '空宫（借对宫）'}`,
    '',
    '以下是该命盘由官方断语库确定性生成的原文，是本次分析的**结论依据**：',
    '1. 结论以原文为准，不得与之矛盾，不得反转原文的吉凶倾向；',
    '2. 可以结合上面的宫位、四化、格局、当前大限做串联补充，但不得添加原文没有的具体断言；',
    '3. 用户问的维度若不在下列原文中，明确说明「该维度本地语料未展开」，再做通用推断。',
  ];

  for (const item of picked) {
    lines.push('', `### ${item.label}${item.truncated ? '（按上下文预算截断）' : ''}`, item.text.trim());
  }
  return lines.join('\n');
}

/**
 * 倪师原话段：检索出来的 8 条上下，每条都带〔讲次·时间码〕。
 * 古籍节选单独成段并标注性质 —— 它是节选整理，不能当「原文」引。
 */
export function buildNishiSection(hits: SearchHit[]): string {
  if (!hits.length) {
    return [
      '【倪师原话】本次没有检索到相关原话。',
      '因此**不要**出现「倪师说」「倪师在《天纪》中指出」这类表述，也不要编造讲次或时间码。',
    ].join('\n');
  }

  const quotes = hits.filter((h) => h.kind !== 'classic');
  const classics = hits.filter((h) => h.kind === 'classic');

  const lines: string[] = [];
  if (quotes.length) {
    lines.push('【倪师原话】按当前命盘与问题检索得到，引用时必须原样使用方括号里的出处：', '');
    quotes.forEach((h, i) => {
      const where = h.h3 ? `${h.h2}·${h.h3}` : h.h2;
      lines.push(`${i + 1}. 〔${h.cite}〕「${h.text}」——${h.book}｜${where}`);
    });
  }

  if (classics.length) {
    lines.push(
      '',
      '【古籍节选·整理】（不是善本原文，只能当术语解释用，**不要**说成「《紫微斗数全书》原文」）：',
      ''
    );
    for (const h of classics) {
      lines.push(`- ${h.book}｜${h.h2}：「${h.text}」`);
    }
  }
  return lines.join('\n');
}

/** 检索结果里可用于校验的出处集合 */
export function refsOf(hits: SearchHit[]): AllowedRef[] {
  return hits.map((h) => ({ part: h.part, sec: h.sec }));
}

/**
 * 真太阳时口径提示。
 *
 * 断语库是按「钟表时辰」生成的，而站内排盘用的是真太阳时。若用户填了出生地，
 * 两者在时辰交界处会差一个时辰，此时断语库原文可能与命盘结构不一致。
 * 服务端拿不到原始钟点（birthInfo 只有归一化后的时辰序号），所以这里只做风险提示，
 * 不做静默的「看起来对」。
 */
const HOUR_NAME = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

export function solarTimeCaveat(chart: any): string {
  const bi = chart?.birthInfo;
  if (typeof bi?.longitude !== 'number') return '';

  const orig = bi?.origInput;
  if (orig && typeof orig.clockHour === 'number') {
    // 钟表读数直接对应的时辰支：23:00–00:59=子，1–2=丑 … 21–22=亥
    const naive = Math.floor((((orig.clockHour + 1) % 24) / 2));
    const hourShifted = naive !== bi.hour;
    const dayShifted = orig.year !== bi.year || orig.month !== bi.month || orig.day !== bi.day;

    if (hourShifted || dayShifted) {
      const clock = `${String(orig.clockHour).padStart(2, '0')}:${String(orig.clockMinute ?? 0).padStart(2, '0')}`;
      return [
        `【口径提示·必须说明】出生钟表时间 ${clock}（${HOUR_NAME[naive]}时），按真太阳时校正后为${HOUR_NAME[bi.hour] ?? '?'}时${dayShifted ? '、日期顺延一日' : ''}。`,
        '而断语库是按钟表时辰生成、未做真太阳时校正 —— 也就是说下面【断语库原文】对应的可能是相邻时辰那张盘。',
        '处理方式：与命盘结构冲突处以命盘为准，并在回答开头写明「本盘处于时辰交界，断语库原文仅供参考」。',
      ].join('\n');
    }
  }

  return [
    '【口径提示】本盘已按出生地经度做过真太阳时校正；断语库按钟表时辰生成、未做真太阳时校正。',
    '若出生时间靠近时辰交界，断语库原文与上面命盘结构可能相差一个时辰 —— 这种不一致要在回答里说明，不要强行调和。',
  ].join('\n');
}

/**
 * 排盘解读的 system prompt 全文。
 */
export function buildInterpretSystemPrompt(
  chart: any,
  corpus: Corpus | null,
  hits: SearchHit[],
  userText: string,
  opts: { patterns?: any[] } = {}
): string {
  const sections = [
    chartToContext(chart),
    buildPatternsSection(chart, opts.patterns),
    buildCorpusSection(corpus, userText),
    buildNishiSection(hits),
    solarTimeCaveat(chart),
  ].filter(Boolean);

  return `你是紫微斗数命理分析师，精通倪海厦《天纪》体系。请严格依据下面给出的命盘与语料作答，不要引入语料以外的断语。

${sections.join('\n\n')}

要求：
1. 结论以【断语库原文】为准；【倪师原话】用来解释「为什么这么说」，不得推翻断语库结论。
2. 引用倪师原话时，必须原样带上〔P讲次·时间码〕标记（如〔P9·00:36:09〕），**不得自造讲次或时间码**；上面没有的出处，一律不写。
3. 【古籍节选·整理】只是术语解释，不得称其为「原文」。
4. 用 Markdown 输出，用 **【标题】** 分节。
5. 命理专名保留中文，如「紫微化科」「七杀朝斗」。
6. 分析保持客观，不做绝对化断言。
7. 涉及健康、婚姻、投资等内容声明「仅供参考，不构成专业建议」。`;
}

/** 读环境变量，返回 OpenAI 兼容协议的提供商配置 */
export function getProviderConfig() {
  const provider = process.env.AI_PROVIDER ?? 'deepseek';

  if (provider === 'deepseek') {
    return {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      extraBody: {},
    };
  }

  // Kimi（Moonshot AI），OpenAI 兼容协议
  if (provider === 'kimi' || provider === 'moonshot') {
    const model = process.env.KIMI_MODEL ?? 'kimi-k3.1-pro';
    // kimi-k2.6 关闭推理后只允许 temperature=0.6，一起塞进 extraBody 覆盖路由默认值
    // K3 系列推理不可关闭，但代码已透传 reasoning_content，也能正常工作
    const extraBody = model.startsWith('kimi-k2.6')
      ? { thinking: { type: 'disabled' }, temperature: 0.6 }
      : {};
    return {
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY,
      model,
      extraBody,
    };
  }

  // 其他 OpenAI 兼容提供商（OpenAI / 小米 mimo / 自建中转）
  return {
    baseUrl: process.env.MIMO_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.MIMO_API_KEY ?? process.env.OPENAI_API_KEY,
    model: process.env.MIMO_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    extraBody: {},
  };
}
