// 面テクスチャの CanvasTexture 描画 (React 非依存・DOM canvas 依存)。
// 9×9 グリッドと givens の数字を描く。グリフは uprightDeg だけセル中心で回して
// 「画面に対して正立」させる (角度は orientation.ts のテーブルから引く)。

import type { Board, FaceId } from '../core/board';
import { cellUV } from './orientation';

export const TEXTURE_SIZE = 1024;

// 面をパッと見分けるための淡い下地色 (検証用途)。
const FACE_TINT: Record<FaceId, string> = {
  U: '#f3f6e8',
  D: '#ece8f6',
  F: '#f6f2e4',
  B: '#e4eef6',
  L: '#f6e8e8',
  R: '#e8f6ef',
};

const GRID_COLOR = '#8a8577';
const BOX_COLOR = '#3d3a30';
const GIVEN_COLOR = '#1d1b16';

export interface DrawFaceOptions {
  face: FaceId;
  board: Board;
  /** グリフ正立角 (度、時計回りに canvas 回転)。 */
  uprightDeg: number;
  /** 左上に面ラベル (U/F/...) を描くか (デバッグ用)。 */
  label?: boolean;
}

/** 1 面ぶんのテクスチャを ctx (TEXTURE_SIZE 四方) に描画する。 */
export function drawFace(ctx: CanvasRenderingContext2D, opts: DrawFaceOptions): void {
  const { face, board, uprightDeg } = opts;
  const S = TEXTURE_SIZE;
  const cellSize = S / 9;

  ctx.resetTransform();
  ctx.fillStyle = FACE_TINT[face];
  ctx.fillRect(0, 0, S, S);

  // セル位置は cellUV (core 幾何の射影) から引く。グリッド線はセル中心の中間に引くため
  // まず 81 セルの中心を求め、テクスチャの向きは cellUV に任せる。
  const centers: { x: number; y: number }[] = [];
  for (let i = 0; i < 81; i++) {
    const uv = cellUV(face, Math.floor(i / 9), i % 9);
    centers.push({ x: uv.x * S, y: uv.y * S });
  }

  // グリッド線: 9 等分の直交グリッド (cellUV は 90° 回転/反転しか起きないので直交で正しい)。
  for (let k = 0; k <= 9; k++) {
    const isBox = k % 3 === 0;
    ctx.strokeStyle = isBox ? BOX_COLOR : GRID_COLOR;
    ctx.lineWidth = isBox ? 8 : 2;
    const t = (k / 9) * S;
    ctx.beginPath();
    ctx.moveTo(t, 0);
    ctx.lineTo(t, S);
    ctx.moveTo(0, t);
    ctx.lineTo(S, t);
    ctx.stroke();
  }

  // givens の数字。セル中心で uprightDeg 回転して描く。
  ctx.fillStyle = GIVEN_COLOR;
  ctx.font = `600 ${Math.round(cellSize * 0.62)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rad = (uprightDeg * Math.PI) / 180;
  for (let i = 0; i < 81; i++) {
    if (!board.givens[face][i]) continue;
    const v = board.faces[face][i];
    if (v === 0) continue;
    const { x, y } = centers[i];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rad);
    // middle ベースラインの光学的ズレを少し補正。
    ctx.fillText(String(v), 0, cellSize * 0.04);
    ctx.restore();
  }

  if (opts.label) {
    ctx.save();
    ctx.translate(cellSize * 0.5, cellSize * 0.5);
    ctx.rotate(rad);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = `700 ${Math.round(cellSize * 0.4)}px Arial, sans-serif`;
    ctx.fillText(face, 0, 0);
    ctx.restore();
  }
}
