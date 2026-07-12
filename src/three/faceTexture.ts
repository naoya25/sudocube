// 面テクスチャの CanvasTexture 描画 (React 非依存・DOM canvas 依存)。
// 9×9 グリッド・ハイライトレイヤー・数字 (given / プレイヤー入力) を描く。
// グリフは uprightDeg だけセル中心で回して「画面に対して正立」させる
// (角度は orientation.ts のテーブルから引く)。

import type { Board, FaceId } from '../core/board';
import { cellUV } from './orientation';
import { FLAG_SAME, FLAG_SELECTED, FLAG_WRONG } from './selection';

export const TEXTURE_SIZE = 1024;

// 面をパッと見分けるための淡い下地色 (index.css のトーンに合わせた淡色)。
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
const PLAYER_COLOR = '#2563eb'; // index.css --player (light)
const ACCENT = '#4f46e5'; // index.css --accent (light)

// ハイライトは面下地色の上に半透明オーバーレイで重ねる (優先度: WRONG > SELECTED > SAME > PEER)。
const OVERLAY_PEER = 'rgba(79, 70, 229, 0.10)';
const OVERLAY_SAME = 'rgba(79, 70, 229, 0.24)';
const OVERLAY_SELECTED = 'rgba(79, 70, 229, 0.32)';
const OVERLAY_WRONG = 'rgba(220, 38, 38, 0.42)';

export interface DrawFaceOptions {
  face: FaceId;
  board: Board;
  /** グリフ正立角 (度、時計回りに canvas 回転)。 */
  uprightDeg: number;
  /** selection.ts の highlightFlags が返す面ぶんのフラグ (81)。省略時はハイライトなし。 */
  flags?: Uint8Array;
  /** 左上に面ラベル (U/F/...) を描くか (デバッグ用)。 */
  label?: boolean;
}

/** 1 面ぶんのテクスチャを ctx (TEXTURE_SIZE 四方) に描画する。 */
export function drawFace(ctx: CanvasRenderingContext2D, opts: DrawFaceOptions): void {
  const { face, board, uprightDeg, flags } = opts;
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

  // ハイライト背景 (グリッド線より下に描く)。
  if (flags) {
    for (let i = 0; i < 81; i++) {
      const f = flags[i];
      if (f === 0) continue;
      const overlay =
        f & FLAG_WRONG
          ? OVERLAY_WRONG
          : f & FLAG_SELECTED
            ? OVERLAY_SELECTED
            : f & FLAG_SAME
              ? OVERLAY_SAME
              : OVERLAY_PEER;
      const { x, y } = centers[i];
      ctx.fillStyle = overlay;
      ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
    }
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

  // 選択セルの枠 (グリッド線より上)。
  if (flags) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 10;
    for (let i = 0; i < 81; i++) {
      if (!(flags[i] & FLAG_SELECTED)) continue;
      const { x, y } = centers[i];
      ctx.strokeRect(x - cellSize / 2 + 5, y - cellSize / 2 + 5, cellSize - 10, cellSize - 10);
    }
  }

  // 数字。セル中心で uprightDeg 回転して描く。given は濃色、プレイヤー入力は青。
  ctx.font = `600 ${Math.round(cellSize * 0.62)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rad = (uprightDeg * Math.PI) / 180;
  for (let i = 0; i < 81; i++) {
    const v = board.faces[face][i];
    if (v === 0) continue;
    ctx.fillStyle = board.givens[face][i] ? GIVEN_COLOR : PLAYER_COLOR;
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
