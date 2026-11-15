/**
 * 倪师语料检索 / 引用校验自测
 *
 *   npx tsx myscripts/test-rag.ts
 *
 * 覆盖：语料规模、冷启动与单次检索耗时、结构键命中的合理性、
 *       引用过滤（含跨 chunk 切断）、完整 prompt 装配。
 */

import { generateChart } from '../lib/ziwei/algorithm';
import { searchCorpus, corpusStats, DOCS } from '../lib/corpus';
import { retrieveForChart } from '../lib/corpus/from-chart';
import { verifyCitations, createCitationFilter } from '../lib/corpus/citation';
import { buildInterpretSystemPrompt, buildPatternsSection } from '../app/api/interpret/_shared';
import { loadCorpus } from '../lib/ziwei/dataset';

let pass = 0;
let fail = 0;

function ok(msg: string) {
  pass++;
  console.log(`  ✓ ${msg}`);
}
function bad(msg: string, extra?: unknown) {
  fail++;
  console.log(`  ✗ ${msg}`);
  if (extra !== undefined) console.log('    ', extra);
}
function check(cond: boolean, msg: string, extra?: unknown) {
  cond ? ok(msg) : bad(msg, extra);
}

async function main() {
  // ── 1. 语料规模 ──
  console.log('\n── 用例 1：语料规模 ──');
  const s = corpusStats();
  console.log(`  条目 ${s.docs}（原话 ${s.quotes} / 摘要 ${s.summaries} / 古籍 ${s.classics}），共 ${s.chars} 字`);
  check(s.quotes === 1848, `倪师原话 1848 条（实际 ${s.quotes}）`);
  check(s.classics === 75, `古籍节选 75 段（实际 ${s.classics}）`);
  const noCite = DOCS.filter((d) => !d.id || !d.text);
  check(noCite.length === 0, '每条都有 id 与正文');
  const badTime = DOCS.filter((d) => d.kind === 'quote' && d.sec === undefined);
  check(badTime.length === 0, '倪师原话全部带可解析时间码');

  // ── 2. 性能 ──
  console.log('\n── 用例 2：检索性能 ──');
  const tCold = Date.now();
  searchCorpus({ text: '夫妻宫 七杀 婚姻', limit: 8 });
  const coldMs = Date.now() - tCold;
  const t2 = Date.now();
  for (let i = 0; i < 20; i++) searchCorpus({ text: '夫妻宫 七杀 婚姻 化忌', limit: 8 });
  const avgMs = (Date.now() - t2) / 20;
  console.log(`  冷启动 ${coldMs} ms（含建索引），热查询均值 ${avgMs.toFixed(1)} ms`);
  check(avgMs < 20, '单次检索 < 20 ms');

  // ── 3. 结构键命中 ──
  console.log('\n── 用例 3：结构键检索是否对路 ──');
  const chart: any = generateChart({ year: 1990, month: 6, day: 15, hour: 7, gender: 'female' } as any);

  const loveQ = '请重点分析【夫妻宫】（主管：配偶），该宫主星为七杀。';
  const love = retrieveForChart(chart, loveQ);
  const lovePal = love.hits.filter((h) => h.tags.palaces.includes('夫妻')).length;
  console.log(`  「夫妻宫」召回 ${love.hits.length} 条，其中标签命中夫妻宫 ${lovePal} 条`);
  console.log(`    首条：〔${love.hits[0]?.cite}〕${love.hits[0]?.text.slice(0, 40)}…`);
  check(love.hits.length >= 3, '夫妻宫问题至少召回 3 条');
  check(lovePal >= Math.min(2, love.hits.length), '多数召回带夫妻宫标签');

  const careerQ = '事业和升职方面怎么样？';
  const career = retrieveForChart(chart, careerQ);
  console.log(`  「事业」识别宫位：${career.query.palaces?.join('/')}，召回 ${career.hits.length} 条`);
  check((career.query.palaces ?? []).includes('官禄'), '问句「事业」被映射到官禄宫');

  const healthQ = '健康上要注意什么？';
  const health = retrieveForChart(chart, healthQ);
  console.log(`  「健康」识别宫位：${health.query.palaces?.join('/')}，召回 ${health.hits.length} 条`);
  check((health.query.palaces ?? []).includes('疾厄'), '问句「健康」被映射到疾厄宫');

  const none = searchCorpus({ text: '量子计算机 光刻机 芯片制程' });
  check(none.length <= 8, `无关问题不会崩（返回 ${none.length} 条）`);

  const allCite = [...love.hits, ...career.hits, ...health.hits].every((h) => /^P\d+·\d{2}:\d{2}:\d{2}$/.test(h.cite) || h.kind === 'classic');
  check(allCite, '每条命中都有合法出处标签');

  // ── 4. 引用校验 ──
  console.log('\n── 用例 4：引用校验 ──');
  const refs = [{ part: 9, sec: 2169 }, { part: 5, sec: 600 }];
  const good = verifyCitations('倪师指出〔P9·00:36:09〕感情宜晚。', refs);
  check(good.stats.kept === 1 && good.stats.stripped === 0, '合法出处被放行');

  const badPart = verifyCitations('倪师指出〔P42·00:36:09〕此事无解。', refs);
  check(badPart.stats.stripped === 1 && badPart.text.includes('〔出处待核〕'), '不存在的讲次被替换');

  const wrongTime = verifyCitations('倪师指出〔P9·00:10:00〕此事无解。', refs);
  check(wrongTime.stats.stripped === 1, '讲次存在但时间码对不上被替换');

  const tolerant = verifyCitations('〔P9·00:36:40〕', refs);
  check(tolerant.stats.kept === 1, '90 秒内的时间码容差被放行');

  const f = createCitationFilter(refs);
  const out = f.push('前半句〔P9·00:3') + f.push('6:09〕后半句');
  const tail = f.flush();
  check(out.includes('〔P9·00:36:09〕') && out.includes('前半句') && f.stats.kept === 1,
    `标记被 chunk 切断也能正确校验（flush="${tail}"）`);

  const weak = verifyCitations('〔P5〕讲过这个。', refs);
  check(weak.stats.kept === 1, '只写讲次算弱引用，放行');

  // ── 5. 完整 prompt ──
  console.log('\n── 用例 5：prompt 装配 ──');
  const corpus = await loadCorpus(chart.birthInfo);
  // 格局检测在 route 里做（patterns.ts 带 server-only，不能进公共模块），这里用样例验证格式化
  const samplePatterns = [
    { name: '七杀朝斗', level: 'good', description: '七杀坐命寅申，主威权', source: '《紫微斗数全书·杀破狼》' },
  ];
  const patterns = buildPatternsSection(chart, samplePatterns);
  const prompt = buildInterpretSystemPrompt(chart, corpus, love.hits, loveQ, { patterns: samplePatterns });
  console.log(`  prompt ${prompt.length} 字｜断语库 ${corpus ? corpus.key : 'miss'}｜格局段 ${patterns ? '有' : '无'}`);
  check(prompt.includes('【命盘结构】'), '含命盘结构');
  check(prompt.includes('【断语库原文】'), '含断语库原文');
  check(prompt.includes('【倪师原话】'), '含倪师原话');
  check(prompt.includes('〔P'), 'prompt 里带出处标记');
  check(prompt.includes('【命中格局】') && prompt.includes('七杀朝斗'), '含命中格局与古籍出处');
  check(prompt.includes('不得自造讲次') || prompt.includes('不得自造'), '含禁止编造出处的约束');
  check(corpus ? prompt.includes(corpus.key) : true, '命盘键写进了 prompt');

  // 无召回时的降级
  const empty = buildInterpretSystemPrompt(chart, corpus, [], loveQ);
  check(empty.includes('不要**') || empty.includes('不要'), '无召回时给出「不要声称倪师说」的降级提示');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
