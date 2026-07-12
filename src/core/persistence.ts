// 履歴保存のシリアライズ層。React / DOM 非依存 (localStorage は注入可能な Storage-like で扱う)。
// (A) 進行中ゲームのマルチスロットセーブ (`sudocube:saves`) と (B) クリア戦績 (`sudocube:records`) を担う。
// 旧 v1 単一セーブ (`sudocube:current`) は初回ロード時に saves へ移行する (migrateLegacyCurrentGame)。
// 壊れたデータ・旧/未知バージョンは例外を投げず null / [] で「安全に無視」する。
// 経過時間は「保存時点の elapsedMs」を持ち、復元時に startedAt を逆算する (離席中は加算しない)。

import { boardFromStrings, boardToStrings, FACES, type Board, type FaceId } from './board';
import type { NotesMap } from './notes';
import type { Session } from './session';

export const CURRENT_GAME_KEY = 'sudocube:current'; // legacy (v1 単一セーブ)。移行後は使わない
export const SAVES_KEY = 'sudocube:saves';
export const RECORDS_KEY = 'sudocube:records';
export const SCHEMA_VERSION = 1;
export const MAX_RECORDS = 50;
export const MAX_SAVES = 20;
/** 全マス数 (6 面 × 81)。進捗率の分母。 */
export const TOTAL_CELLS = 486;

/** localStorage 互換の最小インターフェース (テスト・モック用)。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 復元可能なセーブデータ (deserialize 済み・Session 再構築前の形)。 */
export interface SavedGame {
  puzzle: Board;
  solution: Board;
  board: Board;
  mistakes: number;
  elapsedMs: number; // 保存時点の経過ミリ秒
  seed: number | null;
  notes: NotesMap;
  savedAt: string; // ISO 8601
}

/** マルチスロットセーブの 1 エントリ (= SavedGame + 識別子)。 */
export interface SaveEntry extends SavedGame {
  id: string;
}

/** クリア戦績 1 件。 */
export interface ClearRecord {
  clearedAt: string; // ISO 8601
  timeMs: number;
  mistakes: number;
  score: number;
  seed: number | null;
}

// --- (A) 進行中ゲーム: serialize / deserialize ---

/** Session + NotesMap を v1 ペイロードのプレーンオブジェクトにする。now は elapsedMs 計算に使う。 */
export function gamePayload(
  session: Session,
  notes: NotesMap,
  seed: number | null,
  now: number,
): Record<string, unknown> {
  return {
    v: SCHEMA_VERSION,
    savedAt: new Date(now).toISOString(),
    seed,
    elapsedMs: Math.max(0, now - session.startedAt),
    mistakes: session.mistakes,
    puzzle: boardToStrings(session.puzzle),
    givens: givensToStrings(session.puzzle),
    solution: boardToStrings(session.solution),
    board: boardToStrings(session.board),
    notes: [...notes].map(([k, s]) => [k, [...s]]),
  };
}

/** Session + NotesMap を JSON 文字列にする。now は elapsedMs 計算に使う。 */
export function serializeGame(
  session: Session,
  notes: NotesMap,
  seed: number | null,
  now: number,
): string {
  return JSON.stringify(gamePayload(session, notes, seed, now));
}

/**
 * JSON 文字列から SavedGame を復元する。壊れたデータ・バージョン違い・
 * 整合性の取れない盤面 (solution と矛盾する入力等)・完成済み盤面は null。
 */
export function deserializeGame(raw: string | null | undefined): SavedGame | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return deserializeGameObject(data);
}

/** JSON.parse 済みのペイロードオブジェクトから SavedGame を復元する。不正は null。 */
export function deserializeGameObject(data: unknown): SavedGame | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.v !== SCHEMA_VERSION) return null;
  if (!isFiniteNonNegative(d.elapsedMs) || !isFiniteNonNegative(d.mistakes)) return null;
  if (typeof d.savedAt !== 'string') return null;
  const seed = typeof d.seed === 'number' && Number.isFinite(d.seed) ? d.seed : null;

  const puzzleFaces = readFaceStrings(d.puzzle, /^[.1-9]{81}$/);
  const givenFaces = readFaceStrings(d.givens, /^[01]{81}$/);
  const solutionFaces = readFaceStrings(d.solution, /^[1-9]{81}$/);
  const boardFaces = readFaceStrings(d.board, /^[.1-9]{81}$/);
  if (!puzzleFaces || !givenFaces || !solutionFaces || !boardFaces) return null;

  const puzzle = boardFromStrings(puzzleFaces);
  const solution = boardFromStrings(solutionFaces);
  const board = boardFromStrings(boardFaces);
  for (const f of FACES) {
    for (let i = 0; i < 81; i++) {
      const g = givenFaces[f][i] === '1' ? 1 : 0;
      puzzle.givens[f][i] = g;
      board.givens[f][i] = g;
      // 整合性チェック: given は puzzle=solution と一致、プレイヤーマスは 0 か solution のみ。
      if (g === 1) {
        if (puzzle.faces[f][i] !== solution.faces[f][i]) return null;
        if (board.faces[f][i] !== puzzle.faces[f][i]) return null;
      } else {
        if (puzzle.faces[f][i] !== 0) return null;
        const v = board.faces[f][i];
        if (v !== 0 && v !== solution.faces[f][i]) return null;
      }
    }
  }
  // 完成済み盤面のセーブは「進行中」ではないので無視する。
  if (isBoardComplete(board)) return null;

  const notes = readNotes(d.notes);
  if (notes === null) return null;

  return {
    puzzle,
    solution,
    board,
    mistakes: d.mistakes as number,
    elapsedMs: d.elapsedMs as number,
    seed,
    notes,
    savedAt: d.savedAt,
  };
}

/** SavedGame から Session を再構築する。startedAt = now - elapsedMs (離席中は加算しない)。 */
export function toSession(saved: SavedGame, now: number): Session {
  return {
    puzzle: saved.puzzle,
    solution: saved.solution,
    board: saved.board,
    mistakes: saved.mistakes,
    startedAt: now - saved.elapsedMs,
    status: 'playing',
  };
}

// --- (A') マルチスロットセーブ (`sudocube:saves`) ---
// 保存形式: v1 ペイロード + `id` のオブジェクト配列。savedAt 降順 (= 最終プレイが新しい順) を保つ。
// 書き込み系は raw オブジェクト配列のまま操作し (他エントリを壊さない)、読み出し時に厳密検証する。

/** セーブスロット用のランダム id。 */
export function newSaveId(): string {
  try {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // fallthrough
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 盤面の埋まっているマス数 (given 含む)。進捗表示 = countFilledCells / TOTAL_CELLS。 */
export function countFilledCells(board: Board): number {
  let n = 0;
  for (const f of FACES) {
    for (let i = 0; i < 81; i++) if (board.faces[f][i] !== 0) n++;
  }
  return n;
}

/** raw JSON 文字列 → 「id を持つオブジェクト」の配列 (中身は未検証)。壊れていれば []。 */
function parseRawSaves(raw: string | null | undefined): Record<string, unknown>[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const id = (item as Record<string, unknown>).id;
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(item as Record<string, unknown>);
  }
  return out;
}

/** savedAt (ISO 文字列) 降順ソート用の数値。不正は 0 (= 最古扱い)。 */
function savedAtMs(item: Record<string, unknown>): number {
  const t = typeof item.savedAt === 'string' ? Date.parse(item.savedAt) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * raw エントリ配列に 1 件 upsert する純関数。同 id は置き換え、savedAt 降順に並べ、
 * max 件を超えたら「最終プレイ (savedAt) が最も古いもの」から削除する。
 */
export function upsertRawSave(
  list: readonly Record<string, unknown>[],
  entry: Record<string, unknown>,
  max: number = MAX_SAVES,
): Record<string, unknown>[] {
  const rest = list.filter((it) => it.id !== entry.id);
  return [entry, ...rest].sort((a, b) => savedAtMs(b) - savedAtMs(a)).slice(0, max);
}

/** セーブ一覧を読み込む (厳密検証済み・savedAt 降順)。壊れたエントリは捨てる。 */
export function loadSaves(storage: StorageLike | null = defaultStorage()): SaveEntry[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(SAVES_KEY);
  } catch {
    return [];
  }
  const out: SaveEntry[] = [];
  for (const item of parseRawSaves(raw)) {
    const saved = deserializeGameObject(item);
    if (saved) out.push({ ...saved, id: item.id as string });
  }
  return out
    .sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0))
    .slice(0, MAX_SAVES);
}

/** 指定スロット id に進行中ゲームを保存する。失敗しても例外は投げない。 */
export function saveSlot(
  id: string,
  session: Session,
  notes: NotesMap,
  seed: number | null,
  now: number,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const list = parseRawSaves(storage.getItem(SAVES_KEY));
    const entry = { ...gamePayload(session, notes, seed, now), id };
    storage.setItem(SAVES_KEY, JSON.stringify(upsertRawSave(list, entry)));
  } catch {
    // quota 超過等は静かに無視 (自動セーブが死んでもゲームは続行できる)
  }
}

/** 指定スロット id のセーブを削除する。 */
export function deleteSave(id: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const list = parseRawSaves(storage.getItem(SAVES_KEY)).filter((it) => it.id !== id);
    storage.setItem(SAVES_KEY, JSON.stringify(list));
  } catch {
    // 無視
  }
}

/**
 * 旧 v1 単一セーブ (`sudocube:current`) が残っていれば saves の 1 エントリへ移行して旧キーを消す。
 * データは捨てない (壊れて復元不能な場合のみ旧キー削除だけ行う)。アプリ起動時に一度呼ぶ。冪等。
 */
export function migrateLegacyCurrentGame(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const raw = storage.getItem(CURRENT_GAME_KEY);
    if (raw === null) return;
    let data: unknown = null;
    try {
      data = JSON.parse(raw);
    } catch {
      // 壊れた旧データ: 移行せず削除のみ
    }
    if (deserializeGameObject(data) !== null) {
      const list = parseRawSaves(storage.getItem(SAVES_KEY));
      const entry = { ...(data as Record<string, unknown>), id: newSaveId() };
      storage.setItem(SAVES_KEY, JSON.stringify(upsertRawSave(list, entry)));
    }
    storage.removeItem(CURRENT_GAME_KEY);
  } catch {
    // 無視 (次回起動時に再試行される)
  }
}

// --- (B) クリア戦績: serialize / deserialize ---

/** 戦績配列を JSON 化する。 */
export function serializeRecords(records: readonly ClearRecord[]): string {
  return JSON.stringify(records);
}

/** JSON から戦績配列を復元する。壊れていれば []。不正なエントリは捨てる。 */
export function parseRecords(raw: string | null | undefined): ClearRecord[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: ClearRecord[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.clearedAt !== 'string') continue;
    if (!isFiniteNonNegative(r.timeMs) || !isFiniteNonNegative(r.mistakes)) continue;
    if (!isFiniteNonNegative(r.score)) continue;
    out.push({
      clearedAt: r.clearedAt,
      timeMs: r.timeMs as number,
      mistakes: r.mistakes as number,
      score: r.score as number,
      seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? r.seed : null,
    });
  }
  return out;
}

/** 新しい戦績を先頭に追加した配列を返す。MAX_RECORDS 超は古い順 (末尾) から削除。 */
export function appendRecord(
  records: readonly ClearRecord[],
  record: ClearRecord,
  max: number = MAX_RECORDS,
): ClearRecord[] {
  return [record, ...records].slice(0, max);
}

// --- storage 入出力 (localStorage が使えない環境でも例外で死なない) ---

/** 実行環境の localStorage。使えなければ null (プライベートブラウジング等)。 */
export function defaultStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    // アクセスできるか軽く確認 (Safari のプライベートモード等で setItem が投げる)。
    const probe = 'sudocube:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** 進行中ゲームを保存する。失敗しても例外は投げない。 */
export function saveCurrentGame(
  session: Session,
  notes: NotesMap,
  seed: number | null,
  now: number,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CURRENT_GAME_KEY, serializeGame(session, notes, seed, now));
  } catch {
    // quota 超過等は静かに無視 (自動セーブが死んでもゲームは続行できる)
  }
}

/** 進行中ゲームを読み込む。無効・破損は null。 */
export function loadCurrentGame(
  storage: StorageLike | null = defaultStorage(),
): SavedGame | null {
  if (!storage) return null;
  try {
    return deserializeGame(storage.getItem(CURRENT_GAME_KEY));
  } catch {
    return null;
  }
}

/** 進行中ゲームのセーブを削除する。 */
export function clearCurrentGame(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CURRENT_GAME_KEY);
  } catch {
    // 無視
  }
}

/** クリア戦績を読み込む。無効・破損は []。 */
export function loadRecords(storage: StorageLike | null = defaultStorage()): ClearRecord[] {
  if (!storage) return [];
  try {
    return parseRecords(storage.getItem(RECORDS_KEY));
  } catch {
    return [];
  }
}

/** クリア戦績を 1 件追記して保存し、保存後の配列を返す。 */
export function addRecord(
  record: ClearRecord,
  storage: StorageLike | null = defaultStorage(),
): ClearRecord[] {
  const next = appendRecord(loadRecords(storage), record);
  if (storage) {
    try {
      storage.setItem(RECORDS_KEY, serializeRecords(next));
    } catch {
      // 無視
    }
  }
  return next;
}

// --- 内部ヘルパー ---

function isFiniteNonNegative(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

/** Board.givens を面ごと 81 文字の '0'/'1' 文字列にする。 */
function givensToStrings(board: Board): Record<FaceId, string> {
  const out = {} as Record<FaceId, string>;
  for (const f of FACES) {
    let s = '';
    for (let i = 0; i < 81; i++) s += board.givens[f][i] === 1 ? '1' : '0';
    out[f] = s;
  }
  return out;
}

/** 6 面すべてが pattern に一致する文字列 Record か検証して返す。不正なら null。 */
function readFaceStrings(x: unknown, pattern: RegExp): Record<FaceId, string> | null {
  if (typeof x !== 'object' || x === null) return null;
  const rec = x as Record<string, unknown>;
  const out = {} as Record<FaceId, string>;
  for (const f of FACES) {
    const s = rec[f];
    if (typeof s !== 'string' || !pattern.test(s)) return null;
    out[f] = s;
  }
  return out;
}

/** notes の JSON 形 [key, values[]][] を NotesMap に復元する。形が不正なら null。 */
function readNotes(x: unknown): NotesMap | null {
  if (x === undefined) return new Map();
  if (!Array.isArray(x)) return null;
  const map = new Map<number, ReadonlySet<number>>();
  for (const entry of x) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [k, vals] = entry as [unknown, unknown];
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k > 485) return null;
    if (!Array.isArray(vals)) return null;
    const set = new Set<number>();
    for (const v of vals) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 9) return null;
      set.add(v);
    }
    if (set.size > 0) map.set(k, set);
  }
  return map;
}

function isBoardComplete(board: Board): boolean {
  for (const f of FACES) {
    for (let i = 0; i < 81; i++) if (board.faces[f][i] === 0) return false;
  }
  return true;
}
