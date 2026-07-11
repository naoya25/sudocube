// 盤面データ構造。docs/data-structure.md が正本。
// 立方体の複雑さは geometry.ts の twins() / peers() に閉じ込め、盤面はただの数字にする。

import { FACES, twins } from './geometry';
import type { FaceId } from './geometry';

export type { FaceId };
export { FACES };

export type Board = {
  faces: Record<FaceId, Uint8Array>; // 各面 81 マス、0 = 空
  givens: Record<FaceId, Uint8Array>; // 初期ヒントかどうか (1 = ヒント、0 = 非ヒント)
};

function emptyFaceRecord(): Record<FaceId, Uint8Array> {
  const rec = {} as Record<FaceId, Uint8Array>;
  for (const f of FACES) rec[f] = new Uint8Array(81);
  return rec;
}

/** 全マス 0・givens 全 0 の空 Board。 */
export function emptyBoard(): Board {
  return { faces: emptyFaceRecord(), givens: emptyFaceRecord() };
}

/** ディープコピー (Uint8Array も複製)。 */
export function cloneBoard(board: Board): Board {
  const faces = {} as Record<FaceId, Uint8Array>;
  const givens = {} as Record<FaceId, Uint8Array>;
  for (const f of FACES) {
    faces[f] = Uint8Array.from(board.faces[f]);
    givens[f] = Uint8Array.from(board.givens[f]);
  }
  return { faces, givens };
}

/**
 * マスに値を書き込む同期版。辺のマスなら双子にも同じ値を書き込む。
 * givens には触れない (docs/data-structure.md の setCell 仕様どおり)。
 */
export function setCell(board: Board, face: FaceId, i: number, value: number): void {
  board.faces[face][i] = value;
  for (const [tf, ti] of twins(face, i)) board.faces[tf][ti] = value;
}

// --- 面ごと 81 文字文字列との相互変換 ---
// 空 = '.'、値 1..9 = その数字。保存・共有・デバッグ用の人間可読形式。

/** 1 面 (Uint8Array 81) -> 81 文字文字列。 */
export function faceToString(arr: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 81; i++) s += arr[i] === 0 ? '.' : String(arr[i]);
  return s;
}

/** 81 文字文字列 -> 1 面 (Uint8Array 81)。'.' または '0' を空とみなす。 */
export function faceFromString(s: string): Uint8Array {
  if (s.length !== 81) throw new Error(`face string must be 81 chars, got ${s.length}`);
  const arr = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = s[i];
    arr[i] = ch === '.' || ch === '0' ? 0 : Number(ch);
  }
  return arr;
}

/** Board の faces を面ごと文字列に。 */
export function boardToStrings(board: Board): Record<FaceId, string> {
  const out = {} as Record<FaceId, string>;
  for (const f of FACES) out[f] = faceToString(board.faces[f]);
  return out;
}

/** 面ごと文字列から Board を復元 (givens は全 0)。 */
export function boardFromStrings(faces: Record<FaceId, string>): Board {
  const board = emptyBoard();
  for (const f of FACES) board.faces[f] = faceFromString(faces[f]);
  return board;
}
