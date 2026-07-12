// 候補数字メモ (鉛筆メモ) の純粋ロジック。React / DOM 非依存。
// メモは「canonical セル id (twins 内の最小 cellId) → 候補集合 (1..9)」の Map で持つ。
// 辺・頂点セルのメモは canonical キーに正規化して保存するため、双子面で自動的に共有される。
// クリア条件・スコアには一切影響しない表示専用の状態。UI 層 (App) が useState で保持する。

import { cellId, peers, twins, type FaceId } from './geometry';

/**
 * メモ状態。key = canonical cellId (0..485、twins 内の最小値)、value = 候補数字集合 (1..9)。
 * 空集合のエントリは持たない (削除する) 不変条件。
 * 履歴保存などでシリアライズする場合は [key, [...values]][] に落とせば JSON 化できる。
 */
export type NotesMap = ReadonlyMap<number, ReadonlySet<number>>;

/** 空のメモ状態。 */
export function emptyNotes(): NotesMap {
  return new Map();
}

/** (face, i) の canonical cellId = 自分と双子の cellId の最小値。 */
export function canonicalCellId(face: FaceId, i: number): number {
  let min = cellId(face, i);
  for (const [tf, ti] of twins(face, i)) {
    const id = cellId(tf, ti);
    if (id < min) min = id;
  }
  return min;
}

/** (face, i) のメモ集合。無ければ undefined。 */
export function notesAt(notes: NotesMap, face: FaceId, i: number): ReadonlySet<number> | undefined {
  return notes.get(canonicalCellId(face, i));
}

/**
 * (face, i) の候補 value (1..9) をトグルした新しい NotesMap を返す (元は不変)。
 * 範囲外の value は no-op。集合が空になったらエントリごと削除する。
 */
export function toggleNote(notes: NotesMap, face: FaceId, i: number, value: number): NotesMap {
  if (value < 1 || value > 9) return notes;
  const key = canonicalCellId(face, i);
  const next = new Map(notes);
  const cur = new Set(next.get(key) ?? []);
  if (cur.has(value)) cur.delete(value);
  else cur.add(value);
  if (cur.size === 0) next.delete(key);
  else next.set(key, cur);
  return next;
}

/** (face, i) のメモを全消去した新しい NotesMap を返す。無ければ同じ参照を返す。 */
export function clearCellNotes(notes: NotesMap, face: FaceId, i: number): NotesMap {
  const key = canonicalCellId(face, i);
  if (!notes.has(key)) return notes;
  const next = new Map(notes);
  next.delete(key);
  return next;
}

/**
 * 正解の value が (face, i) に入ったときの自動クリーンアップ。
 * (a) そのセル自身のメモを消す
 * (b) peers (面またぎ・双子経由含む) のメモから同じ value を消す
 * 変化が無ければ同じ参照を返す (再描画抑制のため)。
 */
export function cleanupAfterInput(
  notes: NotesMap,
  face: FaceId,
  i: number,
  value: number,
): NotesMap {
  let next: Map<number, ReadonlySet<number>> | null = null;
  const ensure = () => (next ??= new Map(notes));

  const selfKey = canonicalCellId(face, i);
  if (notes.has(selfKey)) ensure().delete(selfKey);

  // peers を canonical キーに正規化して重複処理を避ける。
  const peerKeys = new Set<number>();
  for (const [pf, pi] of peers(face, i)) peerKeys.add(canonicalCellId(pf, pi));
  peerKeys.delete(selfKey);
  for (const key of peerKeys) {
    const cur = (next ?? notes).get(key);
    if (!cur || !cur.has(value)) continue;
    const updated = new Set(cur);
    updated.delete(value);
    if (updated.size === 0) ensure().delete(key);
    else ensure().set(key, updated);
  }

  return next ?? notes;
}

/**
 * 1 面ぶん (81 セル) のメモ集合配列。描画層 (faceTexture) 用。
 * メモが無いセルは undefined。双子は canonical キー経由で同じ集合を返す。
 */
export function faceNotes(
  notes: NotesMap,
  face: FaceId,
): (ReadonlySet<number> | undefined)[] {
  const out: (ReadonlySet<number> | undefined)[] = new Array(81);
  for (let i = 0; i < 81; i++) out[i] = notes.get(canonicalCellId(face, i));
  return out;
}

/** 面ごとの再描画シグネチャ用ダイジェスト (メモが変わった面だけ焼き直すため)。 */
export function faceNotesSignature(notes: NotesMap, face: FaceId): string {
  let sig = '';
  for (let i = 0; i < 81; i++) {
    const set = notes.get(canonicalCellId(face, i));
    if (!set || set.size === 0) continue;
    sig += `${i}:${[...set].sort((a, b) => a - b).join('')};`;
  }
  return sig;
}
