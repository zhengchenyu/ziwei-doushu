/**
 * 命盘本地存储（localStorage）
 *
 * 只存表单输入（BirthFormState），不存整个 ZiweiChart。
 * 原因：排盘引擎是确定性的（同输入同输出），存表单足够还原命盘，
 * 且 localStorage 容量有限（约 5MB），存完整 chart 对象没必要。
 */

import type { BirthFormState } from '@/components/BirthForm';

const STORAGE_KEY = 'ziwei-saved-charts';
const MAX_SAVED = 20;

export interface SavedChart {
  id: string;            // 唯一 ID（时间戳）
  savedAt: number;       // 保存时间
  form: BirthFormState;  // 表单输入（用来重新生成命盘）
  label: string;         // 显示名（姓名 或 年月日时辰性别）
}

/** 生成显示标签 */
export function makeLabel(form: BirthFormState): string {
  const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const name = form.name?.trim();
  const dateStr = `${form.year}-${form.month}-${form.day}`;
  const timeStr = form.unknownTime ? '时辰不详' : `${SHICHEN[formToBranchIndex(form)]}时`;
  const gender = form.gender === 'male' ? '男' : '女';
  const label = name || `${dateStr} ${timeStr} ${gender}`;
  return name ? `${name} · ${dateStr} ${timeStr} ${gender}` : label;
}

/** 从表单算时辰序号（简化版，仅供标签显示用） */
function formToBranchIndex(form: BirthFormState): number {
  if (form.unknownTime) return 0;
  const h = parseInt(form.clockHour) || 0;
  // 23:00–00:59 → 子时(0)
  if (h === 23 || h === 0) return 0;
  return Math.floor((h + 1) / 2) % 12;
}

/** 读全部已存命盘（按保存时间倒序） */
export function getSavedCharts(): SavedChart[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: SavedChart[] = JSON.parse(raw);
    return Array.isArray(list) ? list.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

/** 存一张命盘（起盘后调用），自动去重（同年月日时辰性别只留最新） */
export function saveChart(form: BirthFormState): SavedChart {
  const charts = getSavedCharts();
  const key = chartKey(form);

  // 移除同一个人旧的记录
  const filtered = charts.filter(c => chartKey(c.form) !== key);

  const entry: SavedChart = {
    id: String(Date.now()),
    savedAt: Date.now(),
    form: { ...form },
    label: makeLabel(form),
  };

  filtered.unshift(entry);
  // 超出上限删掉最老的
  if (filtered.length > MAX_SAVED) filtered.length = MAX_SAVED;

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  }
  return entry;
}

/** 删一张 */
export function deleteChart(id: string): void {
  if (typeof window === 'undefined') return;
  const charts = getSavedCharts().filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(charts));
}

/** 清空全部 */
export function clearAllCharts(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

/** 取最近一张（页面恢复用） */
export function getLastChart(): SavedChart | null {
  const charts = getSavedCharts();
  return charts.length > 0 ? charts[0] : null;
}

// ── 内部：生成去重 key ──
function chartKey(form: BirthFormState): string {
  return [
    form.year, form.month, form.day,
    form.unknownTime ? 'unk' : `${form.clockHour}:${form.clockMinute}`,
    form.gender,
    form.province, form.city,
  ].join('|');
}
