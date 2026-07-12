// Sudocube ゲーム UI (P2: 3D キューブ盤面)。
// ゲームロジックは src/core/session.ts をそのまま使う (再実装しない)。
// 盤面ビューは 3D キューブ (CubeBoard) が唯一。面切替タブは廃止し、
// ドラッグ回転 + 24 姿勢スナップで見る面を変える。

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { FaceId } from './core/board';
import { eraseCell, elapsedMs, inputCell, newGame, score } from './core/session';
import type { Session } from './core/session';
import {
  cleanupAfterInput,
  clearCellNotes,
  emptyNotes,
  toggleNote,
  type NotesMap,
} from './core/notes';
import {
  addRecord,
  clearCurrentGame,
  loadCurrentGame,
  loadRecords,
  saveCurrentGame,
  toSession,
  type ClearRecord,
  type SavedGame,
} from './core/persistence';
import { CubeBoard } from './three/CubeBoard';
import { moveSelection, type ArrowKey, type CellRef } from './three/selection';
import { NumberPad } from './components/NumberPad';

/** 面の表示メタ (正面 face バッジに使う)。モノクローム方針のため色は持たない。 */
const FACE_META: Record<FaceId, { jp: string }> = {
  U: { jp: '上' },
  D: { jp: '下' },
  F: { jp: '前' },
  B: { jp: '後' },
  L: { jp: '左' },
  R: { jp: '右' },
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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [wrongCell, setWrongCell] = useState<CellRef | null>(null);
  // 候補数字メモ (鉛筆メモ)。canonical cellId → 候補集合。表示専用でクリア判定に影響しない。
  const [notes, setNotes] = useState<NotesMap>(() => emptyNotes());
  const [noteMode, setNoteMode] = useState(false);
  // 正面 face (カメラに最も正対している面) とその正立角。CubeBoard のスナップ確定で更新。
  const [front, setFront] = useState<{ face: FaceId; deg: number }>({ face: 'F', deg: 0 });
  const [now, setNow] = useState<number>(() => Date.now());
  const [result, setResult] = useState<Result | null>(null);
  // session はミュータブル (inputCell が破壊的更新) なので、参照は変えず強制再描画で反映する。
  // version は CubeBoard へ渡して盤面テクスチャの再焼きトリガーにも使う。
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  // イントロ回転演出: ゲーム開始ごとに nonce を増やして CubeBoard に再生を指示する。
  // introActive 中はセル選択・数字入力を無効化する (ドラッグでの中断は CubeBoard 側)。
  const [introNonce, bumpIntro] = useReducer((x: number) => x + 1, 0);
  const [introActive, setIntroActive] = useState(false);
  const wrongTimer = useRef<number | null>(null);
  const restartBtnRef = useRef<HTMLButtonElement>(null);
  // 履歴保存: スタート画面表示時に一度だけ localStorage から読む (壊れたデータは null / [])。
  const [savedGame, setSavedGame] = useState<SavedGame | null>(() => loadCurrentGame());
  const [records, setRecords] = useState<ClearRecord[]>(() => loadRecords());
  // 現在のゲームの seed (戦績記録用)。復元時はセーブから引き継ぐ。
  const seedRef = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  const startGame = useCallback(() => {
    const seed = Math.floor(Math.random() * 2 ** 32);
    seedRef.current = seed;
    setSavedGame(null); // 古いセーブは新ゲームの初回自動セーブで上書きされる
    setSession(newGame(seed, Date.now()));
    setSelected(null);
    setWrongCell(null);
    setNotes(emptyNotes());
    setNoteMode(false);
    setResult(null);
    setNow(Date.now());
    setIntroActive(true);
    bumpIntro();
    bump();
  }, []);

  // 「続きから」: セーブから Session を再構築。startedAt は逆算 (離席中の時間は加算しない)。
  const continueGame = useCallback(() => {
    if (!savedGame) return;
    const t = Date.now();
    seedRef.current = savedGame.seed;
    setSavedGame(null);
    setSession(toSession(savedGame, t));
    setSelected(null);
    setWrongCell(null);
    setNotes(savedGame.notes);
    setNoteMode(false);
    setResult(null);
    setNow(t);
    setIntroActive(true);
    bumpIntro();
    bump();
  }, [savedGame]);

  // 自動セーブ: 盤面 (version)・メモ・ミスが変わるたび 1s debounce で保存。
  useEffect(() => {
    if (!session || session.status !== 'playing') return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveCurrentGame(session, notes, seedRef.current, Date.now());
    }, 1000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [session, version, notes]);

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

  // 候補メモのトグル (メモモードの数字 / Shift+数字)。given・値の入ったセルには書けない。
  const handleNoteToggle = useCallback(
    (value: number) => {
      if (!session || session.status !== 'playing' || !selected || introActive) return;
      if (session.puzzle.givens[selected.face][selected.i] === 1) return;
      if (session.board.faces[selected.face][selected.i] !== 0) return;
      setNotes((prev) => toggleNote(prev, selected.face, selected.i, value));
    },
    [session, selected, introActive],
  );

  const handleInput = useCallback(
    (value: number) => {
      if (!session || session.status !== 'playing' || !selected || introActive) return;
      if (noteMode) {
        handleNoteToggle(value);
        return;
      }
      const res = inputCell(session, selected.face, selected.i, value);
      if (res.wrong) flashWrong(selected);
      if (res.accepted) {
        // 正解確定: そのセルのメモを消し、peers (面またぎ含む) のメモから同じ数字を消す。
        setNotes((prev) => cleanupAfterInput(prev, selected.face, selected.i, value));
      }
      bump();
      if (res.won) {
        const t = Date.now();
        setResult({ score: score(session, t), ms: elapsedMs(session, t), mistakes: session.mistakes });
        // クリア: 戦績に記録してから進行中セーブを削除する (順序が正本)。
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        setRecords(
          addRecord({
            clearedAt: new Date(t).toISOString(),
            timeMs: elapsedMs(session, t),
            mistakes: session.mistakes,
            score: score(session, t),
            seed: seedRef.current,
          }),
        );
        clearCurrentGame();
      }
    },
    [session, selected, flashWrong, introActive, noteMode, handleNoteToggle],
  );

  const handleErase = useCallback(() => {
    if (!session || session.status !== 'playing' || !selected || introActive) return;
    if (noteMode) {
      // メモモード中の ⌫ は選択セルのメモ全消去。
      setNotes((prev) => clearCellNotes(prev, selected.face, selected.i));
      return;
    }
    eraseCell(session, selected.face, selected.i);
    bump();
  }, [session, selected, introActive, noteMode]);

  const handleFrontFaceChange = useCallback((face: FaceId, deg: number) => {
    setFront({ face, deg });
  }, []);

  const handleIntroStateChange = useCallback((active: boolean) => {
    setIntroActive(active);
  }, []);

  // キーボード操作 (数字入力・消去・矢印移動・メモ)。矢印は正面 face 内を画面方向で移動する。
  // M でメモモード切替、Shift+数字はモードに関わらず候補トグル。
  useEffect(() => {
    if (!session || session.status !== 'playing' || introActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'm' || e.key === 'M') && !e.shiftKey) {
        setNoteMode((v) => !v);
      } else if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        // Shift+数字は記号キーになる (例: Shift+1 = '!') ので e.code で判定する。
        handleNoteToggle(Number(e.code.slice(5)));
      } else if (e.key >= '1' && e.key <= '9') {
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
  }, [session, selected, front, handleInput, handleErase, handleNoteToggle, introActive]);

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
    const bestTimeMs = records.length > 0 ? Math.min(...records.map((r) => r.timeMs)) : null;
    const bestIdx = bestTimeMs === null ? -1 : records.findIndex((r) => r.timeMs === bestTimeMs);
    return (
      <div className="app start">
        <div className="start-card">
          <div className="brand-mark" aria-hidden="true">
            <span className="mark-face" />
          </div>
          <h1 className="title">SUDOCUBE</h1>
          <p className="lede">立方体 6 面の数独。キューブを回して全面を解こう。</p>
          {savedGame && (
            <button type="button" className="btn-primary" onClick={continueGame}>
              続きから
              <span className="btn-sub mono">
                {fmtTime(savedGame.elapsedMs)}・ミス {savedGame.mistakes}
              </span>
            </button>
          )}
          <button
            type="button"
            className={savedGame ? 'btn-secondary' : 'btn-primary'}
            onClick={startGame}
          >
            {savedGame ? '新しいゲーム' : 'ゲームを始める'}
          </button>
          <p className="hint-text">
            ドラッグで回転 / セルを選んで数字パッドか 1〜9 / ⌫ キーで入力 / M でメモモード
          </p>
        </div>
        {records.length > 0 && (
          <section className="records-card" aria-label="クリア戦績">
            <h2 className="records-title">戦績</h2>
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
                  <span className="rec-score mono">{r.score}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    );
  }

  const won = session.status === 'won';
  const canInput =
    selected !== null && session.puzzle.givens[selected.face][selected.i] !== 1 && !won && !introActive;

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
          notes={notes}
          noteMode={noteMode}
          boardVersion={version}
          onSelectCell={setSelected}
          onFrontFaceChange={handleFrontFaceChange}
          introNonce={introNonce}
          onIntroStateChange={handleIntroStateChange}
        />
      </main>

      <NumberPad
        onInput={handleInput}
        onErase={handleErase}
        disabled={!canInput}
        noteMode={noteMode}
        onToggleNoteMode={() => setNoteMode((v) => !v)}
        noteToggleDisabled={won || introActive}
      />

      {result && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="結果">
          <div className="result-card">
            <div className="result-badge" aria-hidden="true" />
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
