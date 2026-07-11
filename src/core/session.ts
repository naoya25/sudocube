// ゲームセッション: 「1 回のプレイ」を表す純粋ロジック。React / DOM / vite 非依存。
// プレイヤーがマスに数字を入れて解く体験を、UI から切り離して実装する。
// 判定は generator の solution を正本に行い、盤面操作は board の setCell (双子同期) を使う。

import { cloneBoard, setCell, type Board, type FaceId, FACES } from './board';
import { generatePuzzle, type GeneratedPuzzle } from './generator';

/** スコア式のチューニング定数 (難易度別に差し替え可能)。 */
export const TARGET_SECONDS_DEFAULT = 600; // 目標秒 T0。この時間内に解けば時間係数 1.0。
export const MISTAKE_PENALTY = 4; // ミス 1 個ごとの減点。

export type SessionStatus = 'playing' | 'won';

export interface Session {
  puzzle: Board; // 出題盤面 (ヒント入り・不変。givens が正本)
  solution: Board; // 完成解。入力の正誤判定に使う
  board: Board; // 現在の盤面 = ヒント + プレイヤー入力
  mistakes: number; // ミス回数 (累積・上限なし)
  startedAt: number; // 基準時刻 (ms)。経過時間はここからの差分
  status: SessionStatus;
}

/** inputCell の結果。UI がエフェクト分岐に使う。 */
export interface InputResult {
  accepted: boolean; // マスが埋まったか (正解入力)
  wrong: boolean; // 誤入力だったか (mistakes++ 済み)
  won: boolean; // この入力で勝利したか / 既に勝利済みか
}

/**
 * 固定 puzzle を注入してセッションを初期化する (テストで generator を回さないため)。
 * startedAt は UI 側が現在時刻を渡す (テスト可能性のため Date.now を内部で呼ばない)。
 */
export function createSession(puzzle: GeneratedPuzzle, startedAt: number = Date.now()): Session {
  return {
    puzzle: puzzle.board,
    solution: puzzle.solution,
    board: cloneBoard(puzzle.board), // givens + 空マス。プレイヤー入力はここに書く
    mistakes: 0,
    startedAt,
    status: 'playing',
  };
}

/** generatePuzzle(seed) で問題を作りセッションを初期化する。 */
export function newGame(seed?: number, startedAt: number = Date.now()): Session {
  return createSession(generatePuzzle(seed), startedAt);
}

/** ヒント (given) のマスか。 */
function isGiven(session: Session, face: FaceId, i: number): boolean {
  return session.puzzle.givens[face][i] === 1;
}

/**
 * プレイヤーがマスに値を入れる。
 * - given なら拒否 (盤面不変)
 * - solution と一致 → 受理し setCell で埋める (双子も同期)
 * - 不一致 → 拒否 + mistakes++ (盤面不変 = 間違いは盤面に入らない)
 * 間違いが盤面に入らないので、全マスが埋まった時点で必ず正解 = won。
 */
export function inputCell(
  session: Session,
  face: FaceId,
  i: number,
  value: number,
): InputResult {
  // 勝利後は凍結: 盤面も mistakes も一切変えない (UI に依存せずロジック層で保証)。
  if (session.status === 'won') {
    return { accepted: false, wrong: false, won: true };
  }

  // 1〜9 以外 (消しゴムの 0 等) は誤入力にせず no-op。マスを空にするのは eraseCell。
  if (value < 1 || value > 9) {
    return { accepted: false, wrong: false, won: false };
  }

  if (isGiven(session, face, i)) {
    return { accepted: false, wrong: false, won: false };
  }

  if (value === session.solution.faces[face][i]) {
    setCell(session.board, face, i, value);
    const won = isComplete(session);
    if (won) session.status = 'won';
    return { accepted: true, wrong: false, won };
  }

  session.mistakes += 1;
  return { accepted: false, wrong: true, won: false };
}

/**
 * プレイヤーが埋めたマスを空に戻す (消しゴム)。given / 勝利後 / 元々空 は no-op。
 * 双子も同期して空にする。ミスにはならない。
 */
export function eraseCell(session: Session, face: FaceId, i: number): { erased: boolean } {
  if (session.status === 'won') return { erased: false };
  if (isGiven(session, face, i)) return { erased: false };
  if (session.board.faces[face][i] === 0) return { erased: false };
  setCell(session.board, face, i, 0); // 双子も 0 に
  return { erased: true };
}

/**
 * ヒント以外の全マスが埋まったか。間違いは盤面に入らないので complete ⟹ won。
 * (given は常に埋まっているので、空マス 0 が 1 つも無ければ完成。)
 */
export function isComplete(session: Session): boolean {
  for (const f of FACES) {
    const arr = session.board.faces[f];
    for (let i = 0; i < 81; i++) if (arr[i] === 0) return false;
  }
  return true;
}

/** 経過ミリ秒。now は UI 側が渡す (決定的にするため Date.now を内部で呼ばない)。 */
export function elapsedMs(session: Session, now: number): number {
  return now - session.startedAt;
}

function clamp(min: number, max: number, x: number): number {
  return x < min ? min : x > max ? max : x;
}

/**
 * 0〜100 の整数スコア。
 *   timeMultiplier = T0 / (T0 + max(0, elapsedSec - T0))  // 目標内なら 1.0、超過で減衰
 *   raw = (100 - mistakes * MISTAKE_PENALTY) * timeMultiplier
 *   score = clamp(0, 100, round(raw))
 * ノーミス & 目標時間内 = 100。ミス 1 個ごと約 -4 点、超過時間で逓減。
 */
export function score(
  session: Session,
  now: number,
  targetSeconds: number = TARGET_SECONDS_DEFAULT,
): number {
  const t0 = Math.max(1, targetSeconds); // 0 以下だと 0/0=NaN になるため下限クランプ
  const elapsedSec = Math.max(0, elapsedMs(session, now)) / 1000;
  const overage = Math.max(0, elapsedSec - t0);
  const timeMultiplier = t0 / (t0 + overage);
  const raw = (100 - session.mistakes * MISTAKE_PENALTY) * timeMultiplier;
  return clamp(0, 100, Math.round(raw));
}
