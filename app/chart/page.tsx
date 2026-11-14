'use client';
import { useState, useEffect, useRef } from 'react';
import BirthForm from '@/components/BirthForm';
import ChartBoard from '@/components/ChartBoard';
import InsightPanel from '@/components/InsightPanel';
import { generateChart } from '@/lib/ziwei/algorithm';
import { formToBirthInfo } from '@/lib/ziwei/share';
import type { BirthInfo, ZiweiChart, Palace } from '@/lib/ziwei/types';
import type { BirthFormState } from '@/components/BirthForm';
import {
  getSavedCharts, saveChart, deleteChart, getLastChart, clearAllCharts,
  type SavedChart,
} from '@/lib/ziwei/saved-charts';

/**
 * 命盘页 —— 开源版「排盘引擎 Demo」
 *
 * 排盘结果会自动保存到 localStorage，下次打开自动恢复最近一张盘；
 * 历史命盘列表可查看、切换、删除。
 */
export default function ChartPage() {
  const [chart, setChart] = useState<ZiweiChart | null>(null);
  const [selectedPalace, setSelectedPalace] = useState<Palace | null>(null);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const latestForm = useRef<BirthFormState | null>(null);

  // ── 进页面：自动恢复最近一张命盘 ──
  useEffect(() => {
    const last = getLastChart();
    if (last) {
      try {
        const generated = generateChart(formToBirthInfo(last.form));
        setChart(generated);
      } catch {
        // 数据损坏等异常，忽略，显示表单
      }
    }
    setSavedCharts(getSavedCharts());
  }, []);

  // ── 起盘：生成命盘 + 保存表单 ──
  const handleGenerate = (info: BirthInfo) => {
    const generated = generateChart(info);
    setChart(generated);
    setSelectedPalace(null);
    // 保存到 localStorage（用 ref 里最新的表单）
    if (latestForm.current) {
      saveChart(latestForm.current);
      setSavedCharts(getSavedCharts());
    }
  };

  // ── 从历史恢复某张盘 ──
  const restoreChart = (saved: SavedChart) => {
    try {
      const generated = generateChart(formToBirthInfo(saved.form));
      setChart(generated);
      setSelectedPalace(null);
      setShowHistory(false);
    } catch {
      alert('该命盘数据异常，无法恢复');
    }
  };

  // ── 删除某张历史 ──
  const handleDelete = (id: string) => {
    deleteChart(id);
    setSavedCharts(getSavedCharts());
  };

  // ── 清空全部历史 ──
  const handleClearAll = () => {
    if (confirm('确定清空全部历史命盘？此操作不可撤销。')) {
      clearAllCharts();
      setSavedCharts([]);
    }
  };

  // ── 已起盘：命盘 + 解读 ──
  if (chart) {
    return (
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => { setChart(null); setSelectedPalace(null); }}
            style={{
              padding: '6px 14px', cursor: 'pointer',
              border: '1px solid #ccc', borderRadius: 8, background: 'transparent',
            }}
          >
            ← 重新起盘
          </button>
          {savedCharts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              style={{
                padding: '6px 14px', cursor: 'pointer',
                border: '1px solid #ccc', borderRadius: 8, background: 'transparent',
                fontSize: 13,
              }}
            >
              📂 历史命盘（{savedCharts.length}）
            </button>
          )}
        </div>

        {showHistory && (
          <SavedChartList
            charts={savedCharts}
            onRestore={restoreChart}
            onDelete={handleDelete}
            onClearAll={handleClearAll}
            onClose={() => setShowHistory(false)}
          />
        )}

        <div
          className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]"
          style={{ gap: 20, marginTop: 16, alignItems: 'start' }}
        >
          <ChartBoard chart={chart} onPalaceSelect={setSelectedPalace} />
          <InsightPanel chart={chart} selectedPalace={selectedPalace} />
        </div>
      </main>
    );
  }

  // ── 未起盘：表单 + 历史 ──
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>紫微斗数排盘</h1>
      <p style={{ color: '#888', marginBottom: 32, fontSize: 14, lineHeight: 1.7 }}>
        输入出生年月日时，开源排盘引擎即时生成命盘。
        <br />
        排盘结果会自动保存，下次打开无需重新输入。
      </p>
      <BirthForm
        onSubmit={(info: BirthInfo) => handleGenerate(info)}
        onFormSave={(form: BirthFormState) => { latestForm.current = form; }}
      />

      {/* 历史命盘快捷入口 */}
      {savedCharts.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#666' }}>
            📂 历史命盘
          </h3>
          <SavedChartList
            charts={savedCharts}
            onRestore={restoreChart}
            onDelete={handleDelete}
            onClearAll={handleClearAll}
            onClose={() => {}}
          />
        </div>
      )}
    </main>
  );
}

// ── 历史命盘列表组件 ──
function SavedChartList({
  charts, onRestore, onDelete, onClearAll, onClose,
}: {
  charts: SavedChart[];
  onRestore: (c: SavedChart) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{
      border: '1px solid #e0e0e0', borderRadius: 12, padding: 16,
      background: '#fafafa', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>历史命盘（{charts.length}）</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClearAll}
            style={{
              padding: '4px 10px', fontSize: 11, cursor: 'pointer',
              border: '1px solid #ddd', borderRadius: 6, background: '#fff', color: '#c44',
            }}
          >
            清空
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                border: '1px solid #ddd', borderRadius: 6, background: '#fff',
              }}
            >
              收起
            </button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {charts.map(c => (
          <div
            key={c.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderRadius: 8,
              background: '#fff', border: '1px solid #eee',
            }}
          >
            <button
              onClick={() => onRestore(c)}
              style={{
                flex: 1, textAlign: 'left', cursor: 'pointer',
                background: 'transparent', border: 'none', padding: 0,
                fontSize: 13, color: '#333',
              }}
            >
              {c.label}
            </button>
            <button
              onClick={() => onDelete(c.id)}
              style={{
                marginLeft: 12, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                border: 'none', background: 'transparent', color: '#c44',
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
