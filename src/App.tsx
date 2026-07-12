// Sudocube ゲーム UI (P2: 3D キューブ盤面)。
// ゲームロジックは src/core/session.ts をそのまま使う (再実装しない)。
// 盤面ビューは 3D キューブ (CubeBoard) が唯一。面切替タブは廃止し、
// ドラッグ回転 + 24 姿勢スナップで見る面を変える。

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { FaceId } from './core/board';
import { eraseCell, elapsedMs, inputCell, newGame, score } from './core/session';
import type { Session } from './core/session';
import { CubeBoard } from './three/CubeBoard';
import { moveSelection, type ArrowKey, type CellRef } from './three/selection';
import { NumberPad } from './components/NumberPad';

/** 面の表示メタ (スタート画面のブランドマーク・正面 face バッジに使う)。 */
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
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [wrongCell, setWrongCell] = useState<CellRef | null>(null);
  // 正面 face (カメラに最も正対している面) とその正立角。CubeBoard のスナップ確定で更新。
  const [front, setFront] = useState<{ face: FaceId; deg: number }>({ face: 'F', deg: 0 });
  const [now, setNow] = useState<number>(() => Date.now());
  const [result, setResult] = useState<Result | null>(null);
  // session はミュータブル (inputCell が破壊的更新) なので、参照は変えず強制再描画で反映する。
  // version は CubeBoard へ渡して盤面テクスチャの再焼きトリガーにも使う。
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const wrongTimer = useRef<number | null>(null);
  const restartBtnRef = useRef<HTMLButtonElement>(null);

  const startGame = useCallback(() => {
    const seed = Math.floor(Math.random() * 2 ** 32);
    setSession(newGame(seed, Date.now()));
    setSelected(null);
    setWrongCell(null);
    setResult(null);
    setNow(Date.now());
    bump();
  }, []);

  // 経過タイム: playing 中だけ 250ms ごとに now を更新する。
  useEffect(() => {
    if (!session || session.status !== 'playing') return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [session, session?.status]);

  // アンマウント時に誤入力タイマーを掃除。
  useEffect(() => () => {
    if (wrongTimer.current) window.clearTimeout(wrongTimer.current);
  }, []);

  const flashWrong = useCallback((ref: CellRef) => {
    if (wrongTimer.current) window.clearTimeout(wrongTimer.current);
    setWrongCell(ref);
    wrongTimer.current = window.setTimeout(() => setWrongCell(null), 450);
  }, []);

  const handleInput = useCallback(
    (value: number) => {
      if (!session || session.status !== 'playing' || !selected) return;
      const res = inputCell(session, selected.face, selected.i, value);
      if (res.wrong) flashWrong(selected);
      bump();
      if (res.won) {
        const t = Date.now();
        setResult({ score: score(session, t), ms: elapsedMs(session, t), mistakes: session.mistakes });
      }
    },
    [session, selected, flashWrong],
  );

  const handleErase = useCallback(() => {
    if (!session || session.status !== 'playing' || !selected) return;
    eraseCell(session, selected.face, selected.i);
    bump();
  }, [session, selected]);

  const handleFrontFaceChange = useCallback((face: FaceId, deg: number) => {
    setFront({ face, deg });
  }, []);

  // キーボード操作 (数字入力・消去・矢印移動)。矢印は正面 face 内を画面方向で移動する。
  useEffect(() => {
    if (!session || session.status !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '9') {
        handleInput(Number(e.key));
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleErase();
      } else if (e.key.startsWith('Arrow')) {
        if (!selected || selected.face !== front.face) {
          // 未選択、または選択が正面以外の面にあるときは正面 face の中央から。
          setSelected({ face: front.face, i: 40 });
        } else {
          setSelected({
            face: front.face,
            i: moveSelection(front.face, selected.i, e.key as ArrowKey, front.deg),
          });
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, selected, front, handleInput, handleErase]);

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
          <p className="lede">立方体 6 面の数独。キューブを回して全面を解こう。</p>
          <button type="button" className="btn-primary" onClick={startGame}>
            ゲームを始める
          </button>
          <p className="hint-text">ドラッグで回転 / セルを選んで数字パッドか 1〜9 / ⌫ キーで入力</p>
        </div>
      </div>
    );
  }

  const won = session.status === 'won';
  const canInput = selected !== null && session.puzzle.givens[selected.face][selected.i] !== 1 && !won;

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
          <div className="stat" title="カメラに正対している面">
            <span className="stat-label">正面</span>
            <span className="stat-value front-face">
              <span className="face-dot" style={{ background: FACE_META[front.face].color }} />
              {front.face}
              <span className="front-face-jp">{FACE_META[front.face].jp}</span>
            </span>
          </div>
        </div>
        <button type="button" className="btn-ghost" onClick={startGame}>
          新しいゲーム
        </button>
      </header>

      <main className="cube-area" aria-label="3D 盤面">
        <CubeBoard
          board={session.board}
          selected={selected}
          wrongCell={wrongCell}
          boardVersion={version}
          onSelectCell={setSelected}
          onFrontFaceChange={handleFrontFaceChange}
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
