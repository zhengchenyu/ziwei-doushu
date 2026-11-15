/**
 * 生成检索用的语料包：docs/tianji-ziwei + research 摘要 + lib/classics
 *
 * 产物（lib/corpus/data/*.json，随代码进版本库）：
 *   nishi.json     倪师《天纪》原话，带讲次/时间码/bvid/册目
 *   summaries.json 逐帧精读摘要的要点条目
 *   classics.json  古籍节选（3 本 75 段，标注为「节选·整理」，不当原文引证）
 *
 * 为什么要生成而不是运行时直接读 docs/：
 *   1. Next 的产物目录不保证带上 docs/，静态 JSON 更稳；
 *   2. 标签（星/宫/四化）在这里算一次，运行时零解析；
 *   3. 时间码转秒、id 稳定化，前端可以直接拿去做锚点。
 *
 * 用法：npx tsx myscripts/build-corpus.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_BOOKS } from '../lib/classics';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'lib/corpus/data');

const STARS = ['紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府', '太阴', '贪狼', '巨门', '天相', '天梁', '七杀', '破军'];
const PALACES = ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '交友', '官禄', '田宅', '福德', '父母'];
const SIHUA = ['化禄', '化权', '化科', '化忌'];
const MINOR = ['左辅', '右弼', '文昌', '文曲', '天魁', '天钺', '擎羊', '陀罗', '火星', '铃星', '地空', '地劫', '禄存', '天马', '红鸾', '天喜'];
const PATTERN_HINT = ['杀破狼', '机月同梁', '紫府同宫', '日月', '阳梁昌禄', '府相朝垣', '君臣庆会', '双禄', '七杀朝斗', '石中隐玉', '命马'];

export interface CorpusDoc {
  id: string;
  kind: 'quote' | 'summary' | 'classic';
  text: string;
  /** 讲次（P 编号），古籍为空 */
  part?: number;
  /** 时间码原文，如 00:36:09 */
  t?: string;
  /** 时间码秒数，便于拼 ?t= */
  sec?: number;
  bvid?: string;
  /** 册目分类：01-stars / 02-palaces / ... ；古籍为书名 */
  book: string;
  h2: string;
  h3?: string;
  note?: string;
  tags: { stars: string[]; palaces: string[]; sihua: string[]; minor: string[]; patterns: string[] };
  /** 先验权重：古籍/方法论低于星曜宫位 */
  w: number;
}

function tag(text: string) {
  const has = (term: string) => text.includes(term);
  return {
    stars: STARS.filter(has),
    palaces: PALACES.filter(has),
    sihua: SIHUA.filter(has),
    minor: MINOR.filter(has),
    patterns: PATTERN_HINT.filter(has),
  };
}

function parseHms(hms: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(hms.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function pad(n: number, len: number) {
  return String(n).padStart(len, '0');
}

/** 倪师原话：一行一条，字段与 nihai-tianji-corpus 一致 */
function buildNishi(): CorpusDoc[] {
  const file = join(ROOT, 'docs/tianji-ziwei/entries.jsonl');
  const raw = readFileSync(file, 'utf8');
  const docs: CorpusDoc[] = [];
  const perPart = new Map<number, number>();
  let unparsable = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      unparsable++;
      continue;
    }
    const quote = String(r.quote ?? '').trim();
    if (!quote) continue;

    const part = Number(r.part) || 0;
    const seq = (perPart.get(part) ?? 0) + 1;
    perPart.set(part, seq);

    const sec = parseHms(String(r.t_hms ?? ''));
    const tagged = tag(`${r.h2 ?? ''} ${r.h3 ?? ''} ${quote}`);
    const isMethod = r.book === '07-methodology';

    docs.push({
      id: `P${part}-${pad(seq, 3)}`,
      kind: 'quote',
      text: quote,
      part,
      t: sec === null ? undefined : String(r.t_hms),
      sec: sec ?? undefined,
      bvid: r.bvid || undefined,
      book: String(r.book ?? ''),
      h2: String(r.h2 ?? ''),
      h3: r.h3 ? String(r.h3) : undefined,
      note: r.note ? String(r.note) : undefined,
      tags: tagged,
      // 方法论层（批命顺序、原则）很有用，但略低于直接的星/宫断语
      w: isMethod ? 0.9 : ['10-divination', '11-fengshui', '08-yili'].includes(r.book) ? 0.55 : 1,
    });
  }

  if (unparsable) console.warn(`  ! 有 ${unparsable} 行无法解析`);
  return docs;
}

/** 逐帧精读摘要：每个 md 里的小节要点 + 引文 */
function buildSummaries(seen: Set<string>): CorpusDoc[] {
  const dir = join(ROOT, 'research/nishi-video-reading/summaries');
  if (!existsSync(dir)) return [];
  const docs: CorpusDoc[] = [];

  for (const f of readdirSync(dir).filter((f) => /^P\d+\.md$/.test(f)).sort()) {
    const part = Number(f.slice(1, 3));
    const body = readFileSync(join(dir, f), 'utf8');
    let h2 = '';
    let seq = 0;
    let bvid = '';

    for (const line of body.split('\n')) {
      const head = /^##\s+(.+)$/.exec(line);
      if (head) {
        h2 = head[1].trim();
        continue;
      }
      const isBullet = /^-\s+/.test(line);
      const isQuote = /^>\s+/.test(line) && line.includes('[0');
      if (!isBullet && !isQuote) continue;

      const text = line.replace(/^[->]\s+/, '').trim();
      const link = /\[(\d{2}:\d{2}:\d{2})\]\((https?:\/\/[^)]+)\)/.exec(text);
      if (!link) continue;
      if (!bvid) bvid = /(BV[0-9A-Za-z]+)/.exec(link[2])?.[1] ?? '';

      const clean = text
        .replace(/（\[\d{2}:\d{2}:\d{2}\]\([^)]+\)）/, '')
        .replace(/\[\d{2}:\d{2}:\d{2}\]\([^)]+\)/, '')
        .replace(/^[「『]|[」』]$/g, '')
        .replace(/——倪师$/, '')
        .trim();
      if (clean.length < 6) continue;
      if (seen.has(clean)) continue;
      seen.add(clean);

      const sec = parseHms(link[1]);
      seq++;
      docs.push({
        id: `S${part}-${pad(seq, 3)}`,
        kind: 'summary',
        text: clean,
        part,
        t: link[1],
        sec: sec ?? undefined,
        bvid: bvid || undefined,
        book: '逐帧精读',
        h2: h2 || '未分类',
        tags: tag(clean),
        // 「处世方法」类不是排盘规则，权重减半
        w: /处世方法|不代表我们的判断/.test(h2) ? 0.5 : 0.8,
      });
    }
  }
  return docs;
}

/** 古籍节选：只当术语卡用，标注为「节选·整理」 */
function buildClassics(): CorpusDoc[] {
  const docs: CorpusDoc[] = [];
  for (const book of ALL_BOOKS) {
    for (const chapter of book.chapters) {
      for (const p of chapter.paragraphs) {
        docs.push({
          id: `C-${book.slug}-${p.id}`,
          kind: 'classic',
          text: p.text,
          book: `${book.title}（节选·整理）`,
          h2: chapter.title,
          tags: tag(`${chapter.title} ${p.text}`),
          w: 0.75,
        });
      }
    }
  }
  return docs;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const nishi = buildNishi();
  const seen = new Set(nishi.map((d) => d.text));
  const summaries = buildSummaries(seen);
  const classics = buildClassics();

  const stats = {
    nishi: nishi.length,
    summaries: summaries.length,
    classics: classics.length,
    nishiChars: nishi.reduce((s, d) => s + d.text.length, 0),
    summaryChars: summaries.reduce((s, d) => s + d.text.length, 0),
    classicChars: classics.reduce((s, d) => s + d.text.length, 0),
    withTimecode: nishi.filter((d) => d.sec !== undefined).length,
    withTags: nishi.filter((d) => d.tags.stars.length || d.tags.palaces.length).length,
    builtAt: new Date().toISOString(),
  };

  writeFileSync(join(OUT_DIR, 'nishi.json'), JSON.stringify(nishi));
  writeFileSync(join(OUT_DIR, 'summaries.json'), JSON.stringify(summaries));
  writeFileSync(join(OUT_DIR, 'classics.json'), JSON.stringify(classics));
  writeFileSync(join(OUT_DIR, 'stats.json'), JSON.stringify(stats, null, 2));

  console.log('已生成 lib/corpus/data/');
  console.log(`  倪师原话  ${stats.nishi} 条 / ${stats.nishiChars} 字 / 带时间码 ${stats.withTimecode} / 带星宫标签 ${stats.withTags}`);
  console.log(`  逐帧摘要  ${stats.summaries} 条 / ${stats.summaryChars} 字`);
  console.log(`  古籍节选  ${stats.classics} 段 / ${stats.classicChars} 字`);
}

main();
