// 面テクスチャの CanvasTexture 描画 (React 非依存・DOM canvas 依存)。
// 9×9 グリッド・ハイライトレイヤー・数字 (given / プレイヤー入力) を描く。
// グリフは uprightDeg だけセル中心で回して「画面に対して正立」させる
// (角度は orientation.ts のテーブルから引く)。
//
// ビジュアル: エセリアル・すりガラス — 闇に浮かぶ白く発光するフロストガラス。
// 面は中心がわずかに明るい白のラジアルグラデ + 辺への白にじみで「内側から光る」印象。
// 色はモノクローム基調、機能色は氷青 (選択系) と柔らかい赤 (誤答) の 2 つだけ。

import type { Board, FaceId } from '../core/board';
import { cellUV } from './orientation';
import { FLAG_SAME, FLAG_SELECTED, FLAG_WRONG } from './selection';

export const TEXTURE_SIZE = 1024;

// すりガラスの下地 (中心 → 縁)。ごくわずかに青みの入った白。
const GLASS_CENTER = '#f4f7fc';
const GLASS_EDGE = '#dfe5ee';

// グリッドは低コントラストのグレー (数字より必ず弱く)。
const GRID_COLOR = 'rgba(96, 108, 130, 0.26)';
const BOX_COLOR = 'rgba(58, 68, 88, 0.58)';

// 数字インク: given は濃色、プレイヤー入力は青系インク (可読性最優先)。
const GIVEN_COLOR = '#1e232d';
const PLAYER_COLOR = '#2f6398';

// 選択枠 = 氷青 (desaturated ice blue)。
const ACCENT = '#5a8fc4';

// 候補メモ (鉛筆メモ): エセリアル基調に合わせた淡いグレー。数字より必ず弱く。
const NOTE_COLOR = 'rgba(74, 86, 108, 0.62)';

// ハイライトは下地の上に半透明オーバーレイ (優先度: WRONG > SELECTED > SAME > PEER)。
// 選択系は氷青、誤答は柔らかい赤。
const OVERLAY_PEER = 'rgba(122, 160, 204, 0.14)';
const OVERLAY_SAME = 'rgba(122, 160, 204, 0.30)';
const OVERLAY_SELECTED = 'rgba(122, 160, 204, 0.38)';
const OVERLAY_WRONG = 'rgba(224, 108, 112, 0.45)';

export interface DrawFaceOptions {
  face: FaceId;
  board: Board;
  /** グリフ正立角 (度、時計回りに canvas 回転)。 */
  uprightDeg: number;
  /** selection.ts の highlightFlags が返す面ぶんのフラグ (81)。省略時はハイライトなし。 */
  flags?: Uint8Array;
  /** 左上に面ラベル (U/F/...) を描くか (デバッグ用)。 */
  label?: boolean;
  /** 面ぶん (81) の候補メモ集合。省略時はメモなし。値が入っているセルは描かない。 */
  notes?: (ReadonlySet<number> | undefined)[];
  /** メモモード中か。選択枠を破線にしてモードを視覚化する。 */
  noteMode?: boolean;
}

/** 1 面ぶんのテクスチャを ctx (TEXTURE_SIZE 四方) に描画する。 */
export function drawFace(ctx: CanvasRenderingContext2D, opts: DrawFaceOptions): void {
  const { face, board, uprightDeg, flags, notes, noteMode } = opts;
  const S = TEXTURE_SIZE;
  const cellSize = S / 9;

  ctx.resetTransform();

  // 下地: 中心がわずかに明るいラジアルグラデ (内側から光っている印象)。
  const base = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
  base.addColorStop(0, GLASS_CENTER);
  base.addColorStop(1, GLASS_EDGE);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  // 辺への白にじみ: 4 辺から内側へ溶ける白のグラデ (フロストガラスの光の縁)。
  const bloom = S * 0.05;
  const edges: [number, number, number, number][] = [
    [0, 0, 0, bloom], // top
    [0, S, 0, S - bloom], // bottom
    [0, 0, bloom, 0], // left
    [S, 0, S - bloom, 0], // right
  ];
  for (const [x0, y0, x1, y1] of edges) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

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
    ctx.lineWidth = isBox ? 6 : 2;
    const t = (k / 9) * S;
    ctx.beginPath();
    ctx.moveTo(t, 0);
    ctx.lineTo(t, S);
    ctx.moveTo(0, t);
    ctx.lineTo(S, t);
    ctx.stroke();
  }

  // 選択セルの枠 (グリッド線より上)。氷青。メモモード中は破線でモードを示す。
  if (flags) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 10;
    if (noteMode) ctx.setLineDash([cellSize * 0.16, cellSize * 0.1]);
    for (let i = 0; i < 81; i++) {
      if (!(flags[i] & FLAG_SELECTED)) continue;
      const { x, y } = centers[i];
      ctx.strokeRect(x - cellSize / 2 + 5, y - cellSize / 2 + 5, cellSize - 10, cellSize - 10);
    }
    ctx.setLineDash([]);
  }

  // 数字。セル中心で uprightDeg 回転して描く。given は濃色インク、プレイヤー入力は青インク。
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

  // 候補メモ: 空セルに 3×3 ミニグリッド (1=左上 … 9=右下) で小さく描く。
  // セル中心で uprightDeg 回転してから相対座標に置くので、ミニグリッドごと画面正立する。
  if (notes) {
    ctx.font = `500 ${Math.round(cellSize * 0.24)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = NOTE_COLOR;
    const step = cellSize * 0.29; // ミニグリッドの間隔
    for (let i = 0; i < 81; i++) {
      const set = notes[i];
      if (!set || set.size === 0) continue;
      if (board.faces[face][i] !== 0) continue; // 値が入ったセルには描かない
      const { x, y } = centers[i];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rad);
      for (const n of set) {
        const col = (n - 1) % 3;
        const row = Math.floor((n - 1) / 3);
        ctx.fillText(String(n), (col - 1) * step, (row - 1) * step + cellSize * 0.02);
      }
      ctx.restore();
    }
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
