/**
 * myscripts/test-corpus.ts —— 断语库接入自测（本地，不调 AI）
 *
 * 跑法：
 *   npx tsx myscripts/test-corpus.ts
 *   npx tsx myscripts/test-corpus.ts --years 1990 1991   # 额外验证多年份轮转
 *
 * 验三件事：
 *   1. 二分查找的结果与「逐行线性扫描」完全一致（线性扫描只用于测试，生产不用）；
 *   2. 大文件不被整体载入内存（对比 RSS 前后变化）；
 *   3. 取不到语料时返回 null 而不是抛错，供接口降级。
 */

import { createInterface } from 'node:readline';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';

import { datasetStatus, getDataDir, loadCorpus, selectCorpus } from '../lib/ziwei/dataset';
import { buildInterpretSystemPrompt } from '../app/api/interpret/_shared';
import { generateChart } from '../lib/ziwei/algorithm';

let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => { console.error(`  ✗ ${msg}`); failures++; };

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** 线性扫描参照实现：只在测试里用，一次扫描取多条 key */
function linearLookup(year: number, keys: string[]): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const found = new Map<string, string>();
    const wanted = new Set(keys);
    const file = join(getDataDir(), '.cache', `year-${year}.jsonl`);
    if (!existsSync(file)) {
      console.error(`  ! 参照扫描跳过：${file} 不存在（可能被另一个进程的 LRU 清理删掉了）`);
      resolve(found);
      return;
    }

    // 注意：这里读的是已解压的纯 jsonl，不能再过一遍 zstd
    const rl = createInterface({ input: createReadStream(file) });
    rl.on('line', (line) => {
      for (const key of wanted) {
        if (!found.has(key) && line.includes(`"k":"${key}"`)) {
          found.set(key, line);
          wanted.delete(key);
        }
      }
      if (wanted.size === 0) rl.close();
    });
    const done = () => resolve(found);
    rl.on('close', done);
    rl.on('error', done);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const extraIdx = argv.indexOf('--years');
  const extraYears = extraIdx >= 0 ? argv.slice(extraIdx + 1).map(Number).filter(Number.isFinite) : [];

  console.log('\n── 数据集状态 ──');
  const status = datasetStatus();
  console.log(`  数据目录: ${status.dir}`);
  console.log(`  可用: ${status.available ? '是' : '否（先把 release 文件放进 mydata/）'}`);
  console.log(`  已解压年份: ${status.years.length ? status.years.map((y) => `${y.year}(${y.mb}MB)`).join(', ') : '无'}`);

  if (!status.available) {
    console.error('\n数据集不可用，后续用例跳过。');
    process.exit(1);
  }

  const cases = [
    { key: '1990-01-01-0-male', note: '首行（年首子时男）' },
    { key: '1990-06-15-7-female', note: '年中（未时女）' },
    { key: '1990-12-31-11-female', note: '末行（年末亥时女）' },
    { key: '1990-02-28-5-male', note: '非闰年 2 月末' },
  ];

  console.log('\n── 用例 1：二分查找 vs 线性扫描 ──');
  const rssBefore = process.memoryUsage().rss;
  for (const c of cases) {
    const [y, m, d, h, g] = c.key.split('-');
    const started = Date.now();
    const corpus = await loadCorpus({
      year: Number(y), month: Number(m), day: Number(d), hour: Number(h),
      gender: g as 'male' | 'female',
    });
    const elapsed = Date.now() - started;

    if (!corpus) { bad(`${c.key} 未取到（${c.note}）`); continue; }
    const topics = Object.keys(corpus.content).length;
    const summary = `取自 ${corpus.from}，${elapsed}ms，13维命中 ${topics}/13，命宫主星 ${corpus.mingStar ?? '空宫'}`;
    if (topics === 13) ok(`${c.key}  ${summary}`); else bad(`${c.key} 维度不全：${summary}`);
  }

  // 线性扫描做参照，确认二分的行确实是同一条
  const year = 1990;
  const oracle = await linearLookup(year, cases.map((c) => c.key));
  for (const c of cases) {
    const [y, m, d, h, g] = c.key.split('-');
    const corpus = await loadCorpus({
      year: Number(y), month: Number(m), day: Number(d), hour: Number(h),
      gender: g as 'male' | 'female',
    });
    const line = oracle.get(c.key);
    if (!line) { bad(`${c.key} 线性扫描也没找到（数据集异常）`); continue; }
    const rec = JSON.parse(line) as { c: Record<string, string>; ms: string | null };
    const same =
      corpus &&
      corpus.mingStar === (rec.ms ?? null) &&
      Object.keys(rec.c).every((k) => corpus.content[k as keyof typeof corpus.content] === rec.c[k]);
    if (same) ok(`${c.key} 与线性扫描逐字段一致`);
    else bad(`${c.key} 与线性扫描不一致（二分定位错行）`);
  }

  const rssAfter = process.memoryUsage().rss;
  console.log(`  RSS: ${mb(rssBefore)} → ${mb(rssAfter)}（年文件约 742 MB，未被整体载入即为正常）`);

  console.log('\n── 用例 2：取不到语料时优雅降级 ──');
  const misses: { label: string; input: Parameters<typeof loadCorpus>[0] }[] = [
    { label: '年份超出数据集范围（2049）', input: { year: 2049, month: 5, day: 5, hour: 3, gender: 'male' } },
    { label: '不存在的公历日期（1990-02-30）', input: { year: 1990, month: 2, day: 30, hour: 0, gender: 'male' } },
    { label: '缺字段', input: { year: 1990 } },
    { label: '非法性别', input: { year: 1990, month: 1, day: 1, hour: 0, gender: 'other' } },
  ];
  for (const m of misses) {
    const got = await loadCorpus(m.input);
    if (got === null) ok(`${m.label} → null（接口会走降级提示）`);
    else bad(`${m.label} → 不该命中却返回了 ${got.key}`);
  }

  console.log('\n── 用例 3：按问题挑维度 ──');
  const sample = await loadCorpus({ year: 1990, month: 6, day: 15, hour: 7, gender: 'female' });
  if (!sample) { bad('样例盘取不到，跳过'); }
  else {
    const probes: { q: string; expect: string[] }[] = [
      { q: '帮我看看感情和婚姻', expect: ['overview', 'love'] },
      { q: '今年事业运和财运怎么样', expect: ['overview', 'career'] },
      { q: '随便看看这张盘', expect: ['overview', 'personality'] },
    ];
    for (const p of probes) {
      const picked = selectCorpus(sample, p.q);
      const names = picked.map((x) => x.topic).join('+');
      const chars = picked.reduce((s, x) => s + x.text.length, 0);
      const hit = p.expect.every((e) => picked.some((x) => x.topic === e));
      if (hit) ok(`「${p.q}」→ ${names}（${chars} 字）`);
      else bad(`「${p.q}」→ ${names}，期望含 ${p.expect.join('+')}`);
    }
  }

  console.log('\n── 用例 4：真实链路 命盘 → 语料 → system prompt ──');
  {
    const chart = generateChart({ year: 1990, month: 6, day: 15, hour: 7, gender: 'female' });
    const corpus = await loadCorpus(chart.birthInfo);
    const prompt = buildInterpretSystemPrompt(chart, corpus, [], '请分析我的感情和婚姻');
    const hasCorpus = prompt.includes('【断语库原文】');
    const hasPoint = prompt.includes('命盘键 1990-06-15-7-female');
    const hasLove = prompt.includes('### 感情婚姻');
    if (hasCorpus && hasPoint && hasLove) ok(`prompt 已注入语料，共 ${prompt.length} 字`);
    else bad(`prompt 注入不完整：corpus=${hasCorpus} key=${hasPoint} love=${hasLove}`);

    const miss = buildInterpretSystemPrompt(chart, null, [], '随便看看');
    if (miss.includes('未取到本地语料') && miss.includes('严禁编造')) ok('无语料时走降级提示，且禁止模型假称引用原文');
    else bad('无语料时的降级提示缺失');
  }

  if (extraYears.length) {
    console.log('\n── 用例 5：跨年份（会各解压一次，随后按 LRU 清理）──');
    for (const y of extraYears) {
      const started = Date.now();
      const got = await loadCorpus({ year: y, month: 3, day: 3, hour: 3, gender: 'male' });
      const elapsed = Date.now() - started;
      if (got) ok(`${y}-03-03-3-male 命中（${elapsed}ms，取自 ${got.from}）`);
      else bad(`${y} 年份取不到（该年 zst 是否在 tar 里？）`);
    }
    const after = datasetStatus();
    console.log(`  当前保留年份: ${after.years.map((x) => `${x.year}(${x.mb}MB)`).join(', ')}`);
  }

  console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
