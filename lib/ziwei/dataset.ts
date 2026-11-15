/**
 * lib/ziwei/dataset —— 本地断语库（解读数据集 v4.0）读取层
 *
 * 数据集来源：GitHub Release `v4.0-13d`，落在 mydata/（不入库）。
 *   ziwei-interp-v4-all.tar        77 个 year-YYYY.jsonl.zst
 *   year-YYYY.jsonl.zst            单年文件（可选，优先使用）
 *
 * 单年文件解压后约 742 MB / 8760 行（365 天 × 12 时辰 × 2 性别），
 * 平均每行 85 KB —— 不能整体读进内存，也不能逐行全表扫描。
 *
 * 做法：
 *   1. 按需把「用户出生年份」那一个年份解压到 mydata/.cache/year-YYYY.jsonl；
 *   2. 文件内按 (日期, 时辰) 单调递增，用「字节偏移二分查找」定位，每次只读
 *      512 KB 窗口，约 11 次比对即可命中，全程不加载整表；
 *   3. 命中的那一条抽成 13 维语料，落一份几十 KB 的单盘缓存，后续零成本；
 *   4. 解压文件按 LRU（默认保留 2 个年份）自动清理。
 *
 * 数据口径（务必留意）：
 *   - k = `YYYY-MM-DD-时辰序号-性别`，时辰序号 0–11（子=0…亥=11），不是钟点；
 *   - 该数据集由「排盘引擎 + 断语库」确定性生成，按时辰序号直接排盘，
 *     **未做出生地真太阳时校正**；本模块以 chart.birthInfo（引擎已归一化的
 *     排盘日与时辰序号）作为 key，与页面展示的口径一致。
 */

import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

// ── 常量 ──────────────────────────────────────────────────────────────

export const DATASET_YEAR_MIN = 1950;
export const DATASET_YEAR_MAX = 2026;

export const CORPUS_TOPICS = [
  'overview', 'personality', 'love', 'career', 'wealth', 'health',
  'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents',
] as const;

export type CorpusTopic = (typeof CORPUS_TOPICS)[number];

export const CORPUS_TOPIC_LABELS: Record<CorpusTopic, string> = {
  overview:    '命格总览',
  personality: '性格特质',
  love:        '感情婚姻',
  career:      '事业职业',
  wealth:      '财富运势',
  health:      '健康状况',
  family:      '兄弟合伙',
  children:    '子女缘分',
  move:        '迁移外出',
  friends:     '人际贵人',
  home:        '田宅不动产',
  spirit:      '精神福德',
  parents:     '父母长辈',
};

/** 一年文件的平均行长（字节），用于窗口大小与统计 */
const READ_WINDOW = 512 * 1024;
const MAX_WINDOW_TRIES = 5;
const MEMORY_CACHE_MAX = 32;

// ── 类型 ──────────────────────────────────────────────────────────────

export type CorpusGender = 'male' | 'female';

export interface BirthKeyInput {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  gender?: string;
}

export interface Corpus {
  /** 数据集内的键，如 1990-01-01-0-male */
  key: string;
  year: number;
  month: number;
  day: number;
  /** 时辰序号 0–11 */
  hour: number;
  gender: CorpusGender;
  /** 命宫第一颗主星；空宫为 null */
  mingStar: string | null;
  /** 13 维解读全文 */
  content: Partial<Record<CorpusTopic, string>>;
  /** 命中来源：memory / disk / extract */
  from: 'memory' | 'disk' | 'extract';
  /** 本次查找耗时（毫秒） */
  elapsedMs: number;
}

export interface CorpusSelection {
  topic: CorpusTopic;
  label: string;
  text: string;
  /** 是否被预算截断 */
  truncated: boolean;
}

interface KeyParts {
  y: number;
  m: number;
  d: number;
  h: number;
  g: CorpusGender;
}

interface RawRecord {
  k?: string;
  y?: number;
  m?: number;
  d?: number;
  h?: number;
  g?: string;
  ms?: string | null;
  t?: Record<string, number>;
  c?: Record<string, string>;
}

// ── 路径与开关 ────────────────────────────────────────────────────────

export function isDatasetEnabled(): boolean {
  return process.env.ZIWEI_DATASET !== '0';
}

export function getDataDir(): string {
  return resolve(process.env.ZIWEI_DATA_DIR ?? join(process.cwd(), 'mydata'));
}

function getCacheDir(): string {
  return join(getDataDir(), '.cache');
}

function yearJsonlPath(year: number): string {
  return join(getCacheDir(), `year-${year}.jsonl`);
}

function yearZstPath(year: number): string {
  return join(getDataDir(), `year-${year}.jsonl.zst`);
}

function tarPath(): string {
  return join(getDataDir(), 'ziwei-interp-v4-all.tar');
}

function corpusCachePath(key: string): string {
  return join(getCacheDir(), 'corpus', `${key}.json`);
}

/** 本地是否具备数据集（tar 或任一年份的 zst 任一存在） */
export function datasetAvailable(): boolean {
  try {
    const dir = getDataDir();
    if (!existsSync(dir)) return false;
    if (existsSync(tarPath())) return true;
    return readdirSync(dir).some((f) => /^year-\d{4}\.jsonl\.zst$/.test(f));
  } catch {
    return false;
  }
}

// ── key 构造与比较 ────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 由 chart.birthInfo 生成数据集键。
 * birthInfo 里的 year/month/day 已是引擎归一化后的「排盘日」（含晚子时换日），
 * hour 是时辰序号 0–11，与数据集口径一致。
 */
export function birthInfoToKey(bi: BirthKeyInput | null | undefined): string | null {
  if (!bi) return null;
  const { year, month, day, hour, gender } = bi;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(hour)) return null;
  if ((year as number) < DATASET_YEAR_MIN || (year as number) > DATASET_YEAR_MAX) return null;
  if ((month as number) < 1 || (month as number) > 12) return null;
  if ((day as number) < 1 || (day as number) > 31) return null;
  if ((hour as number) < 0 || (hour as number) > 11) return null;
  if (gender !== 'male' && gender !== 'female') return null;
  return `${year}-${pad2(month as number)}-${pad2(day as number)}-${hour}-${gender}`;
}

function parseKey(k: string): KeyParts | null {
  const parts = k.split('-');
  if (parts.length !== 5) return null;
  const [y, m, d, h, g] = parts;
  const yN = Number(y);
  const mN = Number(m);
  const dN = Number(d);
  const hN = Number(h);
  if (!Number.isFinite(yN) || !Number.isFinite(mN) || !Number.isFinite(dN) || !Number.isFinite(hN)) return null;
  if (g !== 'male' && g !== 'female') return null;
  return { y: yN, m: mN, d: dN, h: hN, g };
}

/**
 * 只比较 (日期, 时辰)，不比较性别。
 * 原因：文件内性别是 male 在前、female 在后，而字典序里 female < male，
 * 用整体字符串比较会破坏单调性，二分直接失效。
 */
function cmpDateHour(a: KeyParts, b: KeyParts): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  if (a.d !== b.d) return a.d - b.d;
  return a.h - b.h;
}

function parseKeyOfLine(line: string): KeyParts | null {
  const i = line.indexOf('"k":"');
  if (i < 0) return null;
  const j = line.indexOf('"', i + 5);
  if (j < 0) return null;
  return parseKey(line.slice(i + 5, j));
}

// ── 子进程 ────────────────────────────────────────────────────────────

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rej(new Error(`${cmd} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      rej(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ code, stderr });
    });
  });
}

// ── 按年份解压（带进程内并发去重）──────────────────────────────────────

const inflight = new Map<number, Promise<string | null>>();

async function buildYearFile(year: number, timeoutMs: number): Promise<void> {
  const cacheDir = getCacheDir();
  mkdirSync(cacheDir, { recursive: true });

  const target = yearJsonlPath(year);
  const tmp = `${target}.tmp`;
  try { unlinkSync(tmp); } catch { /* 不存在即忽略 */ }

  let zst = yearZstPath(year);
  if (!existsSync(zst)) {
    const tar = tarPath();
    if (!existsSync(tar)) {
      throw new Error(`缺少 year-${year}.jsonl.zst，也没有 ${tar}；请先跑 myscripts/download-ziwei-v4.sh`);
    }
    // tar 里只取这一年的成员，落 2 MB 的 zst，避免后续重复扫描 154 MB 总包
    const member = `year-${year}.jsonl.zst`;
    const r = await run('tar', ['-xf', tar, '-C', cacheDir, member], timeoutMs);
    const extracted = join(cacheDir, member);
    if (r.code !== 0 || !existsSync(extracted)) {
      throw new Error(`从 tar 解包 ${member} 失败：${r.stderr.slice(0, 300)}`);
    }
    zst = extracted;
  }

  const r2 = await run('zstd', ['-d', '--long=27', '-f', '-o', tmp, zst], timeoutMs);
  if (r2.code !== 0) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`zstd 解压 ${year} 失败：${r2.stderr.slice(0, 300)}`);
  }
  if (!existsSync(tmp) || statSync(tmp).size === 0) throw new Error(`解压 ${year} 得到空文件`);
  renameSync(tmp, target);
  pruneYears(year);
}

/** 只保留最近使用的 N 个年份文件（默认 2），避免 57 GB 全量落盘 */
function pruneYears(keepYear: number): void {
  const keep = Math.max(1, Number(process.env.ZIWEI_KEEP_YEARS ?? 2) || 2);
  // 保护窗：dev server 与测试/生产可能同时跑，清理绝不能删掉别的进程正在读的文件。
  // 10 分钟内被读过的年份一律保留（读取时会 touch 更新时间戳）。
  const graceMs = Math.max(60_000, Number(process.env.ZIWEI_PRUNE_GRACE_MS ?? 600000) || 600000);
  const now = Date.now();
  try {
    const cacheDir = getCacheDir();
    const files = readdirSync(cacheDir)
      .filter((f) => /^year-\d{4}\.jsonl$/.test(f))
      .map((f) => ({ f, year: Number(f.slice(5, 9)), mtime: statSync(join(cacheDir, f)).mtimeMs }))
      .filter((x) => x.year !== keepYear && now - x.mtime > graceMs)
      .sort((a, b) => b.mtime - a.mtime);
    for (const item of files.slice(keep - 1)) {
      try { unlinkSync(join(cacheDir, item.f)); } catch { /* ignore */ }
    }
  } catch { /* 清理失败不影响主流程 */ }
}

async function ensureYearFile(year: number): Promise<string | null> {
  const target = yearJsonlPath(year);
  try {
    if (existsSync(target) && statSync(target).size > 0) return target;
  } catch { /* 继续重建 */ }

  const pending = inflight.get(year);
  if (pending) return pending;

  const timeoutMs = Number(process.env.ZIWEI_DATASET_TIMEOUT_MS ?? 180000) || 180000;
  const task = (async () => {
    try {
      await buildYearFile(year, timeoutMs);
      return target;
    } catch (err) {
      console.warn('[dataset] 年份解压失败：', (err as Error).message);
      return null;
    }
  })().finally(() => inflight.delete(year));

  inflight.set(year, task);
  return task;
}

// ── 字节偏移二分查找 ──────────────────────────────────────────────────

interface LineHit {
  line: string;
  start: number;
  end: number;
}

function readAt(fd: number, pos: number, len: number): Buffer {
  const size = Math.max(1, len);
  const buf = Buffer.allocUnsafe(size);
  const n = readSync(fd, buf, 0, size, pos);
  return buf.subarray(0, n);
}

/**
 * 找包含 pos 的那一行的行首偏移。
 * 行可能长达 120 KB，向后找不到换行时窗口逐次翻倍（512 KB → 16 MB）。
 */
function lineStartAtOrBefore(fd: number, size: number, pos: number): number {
  if (pos <= 0) return 0;
  let want = READ_WINDOW;
  for (let i = 0; i < MAX_WINDOW_TRIES; i++, want *= 2) {
    const from = Math.max(0, pos - want);
    const buf = readAt(fd, from, pos - from);
    const nl = buf.lastIndexOf(0x0a);
    if (nl >= 0) return from + nl + 1;
    if (from === 0) return 0;
  }
  return 0;
}

/** 从真实行首读一整行；末行可能没有换行符 */
function readLineFrom(fd: number, size: number, start: number): LineHit | null {
  if (start >= size) return null;
  let want = READ_WINDOW;
  for (let i = 0; i < MAX_WINDOW_TRIES; i++, want *= 2) {
    const buf = readAt(fd, start, Math.min(want, size - start));
    if (buf.length === 0) return null;
    const nl = buf.indexOf(0x0a);
    if (nl >= 0) return { line: buf.toString('utf8', 0, nl), start, end: start + nl };
    if (start + buf.length >= size) return { line: buf.toString('utf8'), start, end: size };
  }
  return null;
}

/**
 * 二分查找：收敛到「第一个 (日期,时辰) >= target 的行首」。
 * lo/hi 都是字节偏移且都是真实行首，每次迭代 hi 严格减小或 lo 严格增大，
 * 因此不会漏掉首行/末行（早先按 mid 直接取下一行的写法会跳过首行）。
 */
function findLineByKey(fd: number, size: number, target: KeyParts): LineHit | null {
  let lo = 0;
  let hi = size;
  for (let i = 0; i < 128 && lo < hi; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const start = lineStartAtOrBefore(fd, size, mid);
    const cur = readLineFrom(fd, size, start);
    if (!cur) break;
    const parts = parseKeyOfLine(cur.line);
    if (!parts) break;
    if (cmpDateHour(parts, target) < 0) lo = cur.end + 1;
    else hi = start;
  }

  const hit = readLineFrom(fd, size, lo);
  if (!hit) return null;
  const parts = parseKeyOfLine(hit.line);
  if (!parts || cmpDateHour(parts, target) !== 0) return null;
  return hit;
}

/** 同一天同一时辰有男/女两行，相邻，命中后向前找目标性别即可 */
function matchGender(fd: number, size: number, hit: LineHit, target: KeyParts): string | null {
  let cur: LineHit | null = hit;
  for (let i = 0; i < 4 && cur; i++) {
    const parts = parseKeyOfLine(cur.line);
    if (parts) {
      if (cmpDateHour(parts, target) !== 0) break;
      if (parts.g === target.g) return cur.line;
    }
    cur = readLineFrom(fd, size, cur.end + 1);
  }
  return null;
}

// ── 语料对象 ──────────────────────────────────────────────────────────

const memoryCache = new Map<string, Corpus>();

function remember(corpus: Corpus): void {
  memoryCache.set(corpus.key, corpus);
  if (memoryCache.size > MEMORY_CACHE_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (oldest) memoryCache.delete(oldest);
  }
}

function toCorpus(rec: RawRecord, key: string, from: Corpus['from'], startedAt: number): Corpus {
  const content: Partial<Record<CorpusTopic, string>> = {};
  for (const topic of CORPUS_TOPICS) {
    const text = rec.c?.[topic];
    if (typeof text === 'string' && text.trim()) content[topic] = text;
  }
  return {
    key,
    year: rec.y ?? 0,
    month: rec.m ?? 0,
    day: rec.d ?? 0,
    hour: rec.h ?? 0,
    gender: (rec.g === 'female' ? 'female' : 'male'),
    mingStar: typeof rec.ms === 'string' && rec.ms ? rec.ms : null,
    content,
    from,
    elapsedMs: Date.now() - startedAt,
  };
}

function readCorpusCache(key: string, startedAt: number): Corpus | null {
  try {
    const p = corpusCachePath(key);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as RawRecord;
    return toCorpus(raw, key, 'disk', startedAt);
  } catch {
    return null;
  }
}

function writeCorpusCache(corpus: Corpus): void {
  try {
    const dir = join(getCacheDir(), 'corpus');
    mkdirSync(dir, { recursive: true });
    const payload: RawRecord = {
      k: corpus.key,
      y: corpus.year,
      m: corpus.month,
      d: corpus.day,
      h: corpus.hour,
      g: corpus.gender,
      ms: corpus.mingStar,
      c: corpus.content as Record<string, string>,
    };
    writeFileSync(join(dir, `${corpus.key}.json`), JSON.stringify(payload), 'utf8');
  } catch { /* 缓存写失败不影响返回 */ }
}

/**
 * 按出生信息取该命盘的 13 维语料。
 * 命中不到（年份越界 / 数据未下载 / 解压失败）返回 null，由调用方降级。
 */
export async function loadCorpus(bi: BirthKeyInput | null | undefined): Promise<Corpus | null> {
  if (!isDatasetEnabled()) return null;

  const key = birthInfoToKey(bi);
  if (!key) return null;

  const startedAt = Date.now();

  const cached = memoryCache.get(key);
  if (cached) return { ...cached, from: 'memory', elapsedMs: Date.now() - startedAt };

  const disk = readCorpusCache(key, startedAt);
  if (disk) {
    remember(disk);
    return { ...disk, elapsedMs: Date.now() - startedAt };
  }

  if (!datasetAvailable()) return null;

  const target = parseKey(key);
  if (!target) return null;

  const file = await ensureYearFile(target.y);
  if (!file) return null;

  let fd = -1;
  try {
    // touch：让 LRU 反映「最近真的被读过」，同时落进 10 分钟保护窗，避免被并发清理删掉
    try { const now = new Date(); utimesSync(file, now, now); } catch { /* ignore */ }
    fd = openSync(file, 'r');
    const size = statSync(file).size;
    const hit = findLineByKey(fd, size, target);
    if (!hit) return null;
    const line = matchGender(fd, size, hit, target);
    if (!line) return null;

    const rec = JSON.parse(line) as RawRecord;
    const corpus = toCorpus(rec, key, 'extract', startedAt);
    remember(corpus);
    writeCorpusCache(corpus);
    return corpus;
  } catch (err) {
    console.warn('[dataset] 读取语料失败：', (err as Error).message);
    return null;
  } finally {
    if (fd >= 0) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/** 诊断用：当前缓存了哪些年份、占多少空间 */
export function datasetStatus(): { dir: string; available: boolean; years: { year: number; mb: number }[] } {
  const dir = getDataDir();
  const years: { year: number; mb: number }[] = [];
  try {
    for (const f of readdirSync(getCacheDir())) {
      const m = /^year-(\d{4})\.jsonl$/.exec(f);
      if (!m) continue;
      years.push({ year: Number(m[1]), mb: Math.round(statSync(join(getCacheDir(), f)).size / 1048576) });
    }
  } catch { /* 没有缓存目录 */ }
  return { dir, available: datasetAvailable(), years: years.sort((a, b) => b.year - a.year) };
}

// ── 按问题挑维度 ──────────────────────────────────────────────────────

const TOPIC_MATCHERS: { re: RegExp; topics: CorpusTopic[] }[] = [
  { re: /感情|婚姻|夫妻|恋爱|对象|桃花|结婚|离婚/, topics: ['love'] },
  { re: /事业|工作|官禄|职业|创业|升职|跳槽|事业运/, topics: ['career'] },
  { re: /财运|财帛|钱|收入|投资|理财|破财|发财/, topics: ['wealth'] },
  { re: /健康|疾厄|生病|身体|养生|疾病/, topics: ['health'] },
  { re: /性格|个性|脾气|人格|为人/, topics: ['personality'] },
  { re: /子女|孩子|小孩|生育/, topics: ['children'] },
  { re: /兄弟|姐妹|合伙|合伙人/, topics: ['family'] },
  { re: /迁移|外出|出国|搬迁|远行|外地/, topics: ['move'] },
  { re: /人际|朋友|贵人|小人|同事|交友/, topics: ['friends'] },
  { re: /田宅|房产|买房|不动产|家宅|房子/, topics: ['home'] },
  { re: /福德|精神|内心|享受|心态/, topics: ['spirit'] },
  { re: /父母|长辈|文书|双亲/, topics: ['parents'] },
];

/**
 * 选哪些维度进提示词：
 *  - 永远带 overview（命格总览），这是全盘的锚；
 *  - 再按用户这句话的关键词带 1–2 个对应维度；
 *  - 都没命中就给 overview + personality；
 *  - 总字数超过预算时按顺序截断，保证 prompt 不爆上下文。
 */
export function selectCorpus(corpus: Corpus, userText: string, maxChars?: number): CorpusSelection[] {
  const budget = maxChars ?? (Number(process.env.ZIWEI_CORPUS_MAX_CHARS ?? 16000) || 16000);
  const text = String(userText ?? '');

  const wanted: CorpusTopic[] = ['overview'];
  for (const { re, topics } of TOPIC_MATCHERS) {
    if (re.test(text)) {
      for (const t of topics) if (!wanted.includes(t)) wanted.push(t);
    }
    if (wanted.length >= 3) break;
  }
  if (wanted.length === 1) wanted.push('personality');

  const picked: CorpusSelection[] = [];
  let used = 0;
  for (const topic of wanted) {
    const body = corpus.content[topic];
    if (!body) continue;
    const remain = budget - used;
    if (remain < 400) break;
    if (body.length <= remain) {
      picked.push({ topic, label: CORPUS_TOPIC_LABELS[topic], text: body, truncated: false });
      used += body.length;
    } else {
      picked.push({
        topic,
        label: CORPUS_TOPIC_LABELS[topic],
        text: `${body.slice(0, remain)}\n\n……（此处按上下文预算截断，余下内容从略）`,
        truncated: true,
      });
      used = budget;
      break;
    }
  }
  return picked;
}
