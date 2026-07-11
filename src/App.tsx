// Sudocube 最小ゲーム UI (P1.5: 平面・1 面表示)。
// ゲームロジックは src/core/session.ts をそのまま使う (再実装しない)。
// 状態管理 (このファイル) と描画 (FaceGrid / NumberPad) を分離してあるので、
// P2 で 3D キューブの正面に drei <Html> で盤面を載せ替えても presentational は再利用できる。

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { FACES } from './core/board';
import type { FaceId } from './core/board';
import { eraseCell, elapsedMs, inputCell, newGame, score } from './core/session';
import type { Session } from './core/session';
import { FaceGrid } from './components/FaceGrid';
import { NumberPad } from './components/NumberPad';

/** 面の表示メタ (P2 の 3D 回転の代わりに面を切り替えるタブに使う)。 */
const FACE_META: Record<FaceId, { jp: string; color: string }> = {
  U: { jp: '上', color: '#f5b301' },
  D: { jp: '下', color: '#8b5cf6' },
  F: { jp: '前', color: '#3b82f6' },
  B: { jp: '後', color: '#ef4444' },
  L: { jp: '左', color: '#10b981' },
  R: { jp: '右', color: '#ec4899' },
};

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Result {
  score: number;
  ms: number;
  mistakes: number;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [face, setFace] = useState<FaceId>('F');
  const [selected, setSelected] = useState<number | null>(null);
  const [wrongCell, setWrongCell] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [result, setResult] = useState<Result | null>(null);
  // session はミュータブル (inputCell が破壊的更新) なので、参照は変えず強制再描画で反映する。
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const wrongTimer = useRef<number | null>(null);
  const restartBtnRef = useRef<HTMLButtonElement>(null);

  const startGame = useCallback(() => {
    const seed = Math.floor(Math.random() * 2 ** 32);
    setSession(newGame(seed, Date.now()));
    setFace('F');
    setSelected(null);
    setWrongCell(null);
    setResult(null);
    setNow(Date.now());
  }, []);

  // 経過タイム: playing 中だけ 250ms ごとに now を更新する。
  // session はミュータブルで参照が変わらないため、status 遷移 (勝利) を dep に含めて
  // 勝利時にこの effect を再実行させ、interval を確実に止める。
  useEffect(() => {
    if (!session || session.status !== 'playing') return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [session, session?.status]);

  // アンマウント時に誤入力タイマーを掃除。
  useEffect(() => () => {
    if (wrongTimer.current) window.clearTimeout(wrongTimer.current);
  }, []);

  const flashWrong = useCallback((i: number) => {
    if (wrongTimer.current) window.clearTimeout(wrongTimer.current);
    setWrongCell(i);
    wrongTimer.current = window.setTimeout(() => setWrongCell(null), 450);
  }, []);

  const handleInput = useCallback(
    (value: number) => {
      if (!session || session.status !== 'playing' || selected === null) return;
      const res = inputCell(session, face, selected, value);
      if (res.wrong) flashWrong(selected);
      bump();
      if (res.won) {
        const t = Date.now();
        setResult({ score: score(session, t), ms: elapsedMs(session, t), mistakes: session.mistakes });
      }
    },
    [session, face, selected, flashWrong],
  );

  const handleErase = useCallback(() => {
    if (!session || session.status !== 'playing' || selected === null) return;
    eraseCell(session, face, selected);
    bump();
  }, [session, face, selected]);

  const switchFace = useCallback((f: FaceId) => {
    setFace(f);
    setSelected(null);
    setWrongCell(null);
  }, []);

  // キーボード操作 (数字入力・消去・矢印移動)。craft 用の補助。
  useEffect(() => {
    if (!session || session.status !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '9') {
        handleInput(Number(e.key));
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleErase();
      } else if (e.key.startsWith('Arrow')) {
        if (selected === null) {
          setSelected(40); // 未選択なら中央から。キーボードのみでも遊べる。
        } else {
          let r = Math.floor(selected / 9);
          let c = selected % 9;
          if (e.key === 'ArrowUp') r = Math.max(0, r - 1);
          else if (e.key === 'ArrowDown') r = Math.min(8, r + 1);
          else if (e.key === 'ArrowLeft') c = Math.max(0, c - 1);
          else if (e.key === 'ArrowRight') c = Math.min(8, c + 1);
          setSelected(r * 9 + c);
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, selected, handleInput, handleErase]);

  // 結果 dialog が開いたら「もう一度」にフォーカスを移し、Escape で再スタートできるように。
  useEffect(() => {
    if (!result) return;
    restartBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        startGame();
      } else if (e.key === 'Tab') {
        // dialog 内のフォーカス可能要素は「もう一度」1 つだけ。Tab を dialog に留める。
        e.preventDefault();
        restartBtnRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, startGame]);

  // --- スタート画面 ---
  if (!session) {
    return (
      <div className="app start">
        <div className="start-card">
          <div className="brand-mark" aria-hidden="true">
            {(['U', 'F', 'R'] as FaceId[]).map((f) => (
              <span key={f} className="mark-face" style={{ background: FACE_META[f].color }} />
            ))}
          </div>
          <h1 className="title">SUDOCUBE</h1>
          <p className="lede">立方体 6 面の数独。まずは 1 面から解いてみよう。</p>
          <button type="button" className="btn-primary" onClick={startGame}>
            ゲームを始める
          </button>
          <p className="hint-text">セルを選んで数字パッド、または 1〜9 / ⌫ キーで入力</p>
        </div>
      </div>
    );
  }

  const won = session.status === 'won';
  const canInput = selected !== null && session.puzzle.givens[face][selected] !== 1 && !won;

  return (
    <div className="app">
      <header className="hud">
        <div className="hud-brand">
          <span className="hud-logo">SUDOCUBE</span>
        </div>
        <div className="hud-stats">
          <div className="stat">
            <span className="stat-label">ミス</span>
            <span className={`stat-value${session.mistakes > 0 ? ' bad' : ''}`}>{session.mistakes}</span>
          </div>
          <div className="stat">
            <span className="stat-label">タイム</span>
            <span className="stat-value mono">{fmtTime(elapsedMs(session, now))}</span>
          </div>
        </div>
        <button type="button" className="btn-ghost" onClick={startGame}>
          新しいゲーム
        </button>
      </header>

      <nav className="face-tabs" aria-label="面の切り替え">
        {FACES.map((f) => (
          <button
            key={f}
            type="button"
            className={`face-tab${f === face ? ' active' : ''}`}
            aria-pressed={f === face}
            onClick={() => switchFace(f)}
          >
            <span className="face-dot" style={{ background: FACE_META[f].color }} />
            <span className="face-id">{f}</span>
            <span className="face-jp">{FACE_META[f].jp}</span>
          </button>
        ))}
      </nav>

      <main className="board-area">
        <FaceGrid
          values={Uint8Array.from(session.board.faces[face])}
          givens={session.puzzle.givens[face]}
          selected={selected}
          wrongCell={wrongCell}
          onSelectCell={setSelected}
          disabled={won}
        />
      </main>

      <NumberPad onInput={handleInput} onErase={handleErase} disabled={!canInput} />

      {result && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="結果">
          <div className="result-card">
            <div className="result-badge" aria-hidden="true">🎉</div>
            <h2 className="result-title">クリア！</h2>
            <div className="score-ring">
              <span className="score-num">{result.score}</span>
              <span className="score-max">/ 100</span>
            </div>
            <dl className="result-stats">
              <div>
                <dt>タイム</dt>
                <dd className="mono">{fmtTime(result.ms)}</dd>
              </div>
              <div>
                <dt>ミス</dt>
                <dd>{result.mistakes}</dd>
              </div>
            </dl>
            <button type="button" className="btn-primary" ref={restartBtnRef} onClick={startGame}>
              もう一度
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
