/**
 * /api/interpret 与 /api/heming 共用的工具函数。
 * 抽出来避免两个路由里重复维护命盘上下文生成和提供商配置。
 */

/** 把命盘结构压缩成给 AI 的上下文文本 */
export function chartToContext(chart: any): string {
  const palaces: any[] = chart?.palaces ?? [];
  const lines: string[] = ['【命盘宫位】'];

  for (const p of palaces) {
    const stars = (p.stars ?? [])
      .map((s: any) => `${s.name}${s.siHua ? '(' + s.siHua + ')' : ''}`)
      .join('、') || '空宫';
    lines.push(`${p.name}(${p.branch}): ${stars}`);
  }

  const dash: any[] = chart?.dashian ?? [];
  if (dash.length > 0) {
    lines.push('', '【当前大限】');
    const cur = dash.find((d: any) => d.isCurrent) ?? dash[0];
    if (cur) {
      lines.push(`${cur.range ?? ''} 大限宫：${cur.palaceName ?? ''} (${cur.branch ?? ''})`);
    }
  }

  return lines.join('\n');
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
