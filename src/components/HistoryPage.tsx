// 履歴ページ。進行中セーブ (マルチスロット) とクリア済み戦績を一覧する画面。
// モーダルではなく画面として表示する。削除は誤タップ対策で 2 度押し確認 (3 秒で解除)。

import { useEffect, useRef, useState } from 'react';
import {
  countFilledCells,
  TOTAL_CELLS,
  type ClearRecord,
  type SaveEntry,
} from '../core/persistence';

interface Props {
  saves: SaveEntry[];
  records: ClearRecord[];
  onResume: (entry: SaveEntry) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

export function HistoryPage({ saves, records, onResume, onDelete, onBack }: Props) {
  // 削除確認中のエントリ id。もう一度押すと実削除、3 秒で自動解除。
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
  }, []);

  const handleDeleteTap = (id: string) => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    if (confirmId === id) {
      setConfirmId(null);
      onDelete(id);
      return;
    }
    setConfirmId(id);
    confirmTimer.current = window.setTimeout(() => setConfirmId(null), 3000);
  };

  const bestTimeMs = records.length > 0 ? Math.min(...records.map((r) => r.timeMs)) : null;
  const bestIdx = bestTimeMs === null ? -1 : records.findIndex((r) => r.timeMs === bestTimeMs);

  return (
    <div className="app history">
      <header className="history-head">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="history-title">履歴</h1>
        <span className="history-head-spacer" aria-hidden="true" />
      </header>

      <section className="history-card" aria-label="進行中のゲーム">
        <h2 className="records-title">進行中</h2>
        {saves.length === 0 ? (
          <p className="empty-text">進行中のゲームはありません。新しいゲームを始めるとここに並びます。</p>
        ) : (
          <ol className="saves-list">
            {saves.map((s) => {
              const filled = countFilledCells(s.board);
              const pct = Math.floor((filled / TOTAL_CELLS) * 100);
              const confirming = confirmId === s.id;
              return (
                <li key={s.id} className="save-row">
                  <div className="save-info">
                    <div className="save-meta">
                      <span className="save-date">{fmtDate(s.savedAt)}</span>
                      <span className="save-stat mono">{fmtTime(s.elapsedMs)}</span>
                      <span className="save-stat">ミス {s.mistakes}</span>
                    </div>
                    <div className="save-progress">
                      <span
                        className="save-bar"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`進捗 ${pct}%`}
                      >
                        <span className="save-bar-fill" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="save-pct mono">{pct}%</span>
                    </div>
                  </div>
                  <div className="save-actions">
                    <button type="button" className="btn-resume" onClick={() => onResume(s)}>
                      続きから
                    </button>
                    <button
                      type="button"
                      className={`btn-delete${confirming ? ' confirming' : ''}`}
                      onClick={() => handleDeleteTap(s.id)}
                    >
                      {confirming ? '本当に削除？' : '削除'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="history-card" aria-label="クリア戦績">
        <h2 className="records-title">クリア済み</h2>
        {records.length === 0 ? (
          <p className="empty-text">クリア済みのゲームはまだありません。最初のクリアを目指そう。</p>
        ) : (
          <ol className="records-list">
            {records.map((r, idx) => (
              <li
                key={`${r.clearedAt}-${idx}`}
                className={`record-row${idx === bestIdx ? ' best' : ''}`}
              >
                <span className="rec-date">{fmtDate(r.clearedAt)}</span>
                <span className="rec-time mono">
                  {fmtTime(r.timeMs)}
                  {idx === bestIdx && <span className="rec-best-tag">BEST</span>}
                </span>
                <span className="rec-miss">ミス {r.mistakes}</span>
                <span className="rec-score mono">{r.score.toFixed(3)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
