// セル選択・ハイライトの純粋ロジック (React / three シーン非依存)。
// - raycast uv → セル index 変換 (cellUV の逆写像。手書きマッピング禁止なので射影から導出)
// - 選択 / peers / same-number / 誤答の面ごとハイライトフラグ算出 (双子は両面同時)
// - 正立角を考慮した画面方向の矢印キー移動

import type { Board } from '../core/board';
import { FACES, peers, twins, type FaceId } from '../core/geometry';
import { cellUV } from './orientation';

// --- テクスチャ格子 (tx, ty) とセル index の相互写像 ---
// cellUV (facePoint 射影) から導出する。tx, ty は 0..8 のテクスチャ格子座標
// (tx: canvas 右方向, ty: canvas 下方向)。

interface TexMap {
  /** ty * 9 + tx → セル index i */
  texToCell: Int16Array;
  /** i → { tx, ty } */
  cellToTex: { tx: number; ty: number }[];
}

const TEX_MAPS: Record<FaceId, TexMap> = (() => {
  const maps = {} as Record<FaceId, TexMap>;
  for (const face of FACES) {
    const texToCell = new Int16Array(81).fill(-1);
    const cellToTex: { tx: number; ty: number }[] = [];
    for (let i = 0; i < 81; i++) {
      const uv = cellUV(face, Math.floor(i / 9), i % 9);
      // uv はセル中心 (t + 0.5) / 9 なので丸めで厳密に格子へ戻る。
      const tx = Math.round(uv.x * 9 - 0.5);
      const ty = Math.round(uv.y * 9 - 0.5);
      texToCell[ty * 9 + tx] = i;
      cellToTex.push({ tx, ty });
    }
    maps[face] = { texToCell, cellToTex };
  }
  return maps;
})();

/**
 * three の raycast 交点 uv (u 右, v 上, 0..1) → セル index。
 * canvas は y 下向きなので v を反転してから格子へ落とす。
 */
export function uvToCell(face: FaceId, u: number, v: number): number {
  const clamp8 = (t: number) => Math.min(8, Math.max(0, Math.floor(t)));
  const tx = clamp8(u * 9);
  const ty = clamp8((1 - v) * 9);
  return TEX_MAPS[face].texToCell[ty * 9 + tx];
}

/** セル index → テクスチャ格子座標 (描画レイヤーがハイライト矩形を引くのに使う)。 */
export function cellTexPos(face: FaceId, i: number): { tx: number; ty: number } {
  return TEX_MAPS[face].cellToTex[i];
}

// --- ハイライトフラグ ---

export const FLAG_SELECTED = 1;
export const FLAG_PEER = 2;
export const FLAG_SAME = 4;
export const FLAG_WRONG = 8;

export interface CellRef {
  face: FaceId;
  i: number;
}

/** そのセル自身 + 双子 (辺・頂点セルなら他面の同一セル)。 */
export function withTwins(ref: CellRef): CellRef[] {
  return [ref, ...twins(ref.face, ref.i).map(([face, i]) => ({ face, i }))];
}

/**
 * 面ごと 81 セルのハイライトフラグを算出する。
 * - selected: 選択セル + 双子に SELECTED / peers() に PEER / 盤面の同数字全セルに SAME
 * - wrong: 誤答セル + 双子に WRONG
 */
export function highlightFlags(
  board: Board,
  selected: CellRef | null,
  wrong: CellRef | null,
): Record<FaceId, Uint8Array> {
  const flags = {} as Record<FaceId, Uint8Array>;
  for (const f of FACES) flags[f] = new Uint8Array(81);

  if (selected) {
    for (const [pf, pi] of peers(selected.face, selected.i)) flags[pf][pi] |= FLAG_PEER;
    const value = board.faces[selected.face][selected.i];
    if (value > 0) {
      for (const f of FACES) {
        const arr = board.faces[f];
        for (let i = 0; i < 81; i++) if (arr[i] === value) flags[f][i] |= FLAG_SAME;
      }
    }
    for (const ref of withTwins(selected)) flags[ref.face][ref.i] |= FLAG_SELECTED;
  }

  if (wrong) {
    for (const ref of withTwins(wrong)) flags[ref.face][ref.i] |= FLAG_WRONG;
  }

  return flags;
}

// --- 画面方向の矢印キー移動 ---

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * 正立角 uprightDeg (orientation.ts の定義: グリフをこの角度回すと画面正立) の面内で、
 * 画面上の矢印方向へ 1 セル移動する。面端では clamp (面をまたがない)。
 *
 * 導出: 正立角 θ のとき、画面上方向は面基底 (texRight, up) 成分で (sinθ, cosθ)。
 * テクスチャ格子 (tx, ty) では texRight = (1, 0)、up = (0, -1) なので
 * 画面上 = (sinθ, -cosθ)、画面右 = 画面上を画面内で -90° 回して (cosθ, sinθ)。
 */
export function moveSelection(face: FaceId, i: number, key: ArrowKey, uprightDeg: number): number {
  const rad = (uprightDeg * Math.PI) / 180;
  const s = Math.round(Math.sin(rad));
  const c = Math.round(Math.cos(rad));
  const dirs: Record<ArrowKey, [number, number]> = {
    ArrowUp: [s, -c],
    ArrowDown: [-s, c],
    ArrowRight: [c, s],
    ArrowLeft: [-c, -s],
  };
  const [dx, dy] = dirs[key];
  const { tx, ty } = cellTexPos(face, i);
  const clamp8 = (t: number) => Math.min(8, Math.max(0, t));
  return TEX_MAPS[face].texToCell[clamp8(ty + dy) * 9 + clamp8(tx + dx)];
}
