import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { FACES, peers, twins, type FaceId } from '../core/geometry';
import { generatePuzzle } from '../core/generator';
import { cellUV, computeFrontFaces, IDENTITY_POSE_INDEX, POSES } from './orientation';
import {
  cellTexPos,
  FLAG_PEER,
  FLAG_SAME,
  FLAG_SELECTED,
  FLAG_WRONG,
  highlightFlags,
  moveSelection,
  uvToCell,
  withTwins,
} from './selection';

/** POC 基準カメラ ([6,5,18] から原点を見る) の姿勢 quaternion。 */
function offsetCameraQuat(): Quaternion {
  const m = new Matrix4().lookAt(new Vector3(6, 5, 18), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  return new Quaternion().setFromRotationMatrix(m);
}

describe('uvToCell (cellUV の逆写像)', () => {
  it('全 6 面 × 81 セルでラウンドトリップする (セル中心の uv → 同じセル index)', () => {
    for (const face of FACES) {
      for (let i = 0; i < 81; i++) {
        const uv = cellUV(face, Math.floor(i / 9), i % 9);
        // three の raycast uv は v が上向き。canvas y (下向き) から反転する。
        expect(uvToCell(face, uv.x, 1 - uv.y)).toBe(i);
      }
    }
  });

  it('セル内の中心以外の点でも同じセルに落ちる', () => {
    const uv = cellUV('F', 4, 4);
    const d = 0.4 / 9; // セル半幅より内側
    expect(uvToCell('F', uv.x + d, 1 - uv.y + d)).toBe(40);
    expect(uvToCell('F', uv.x - d, 1 - uv.y - d)).toBe(40);
  });

  it('uv の端 (0, 1) でも範囲外にならない', () => {
    for (const face of FACES) {
      expect(uvToCell(face, 0, 0)).toBeGreaterThanOrEqual(0);
      expect(uvToCell(face, 1, 1)).toBeGreaterThanOrEqual(0);
      expect(uvToCell(face, 0, 0)).toBeLessThan(81);
      expect(uvToCell(face, 1, 1)).toBeLessThan(81);
    }
  });
});

describe('highlightFlags (双子ハイライトは両面同時)', () => {
  const { board } = generatePuzzle(1);

  // 辺セル (双子が 1 個以上あるセル) を F 面から探す。
  const edgeCell = (() => {
    for (let i = 0; i < 81; i++) {
      if (twins('F', i).length > 0) return i;
    }
    throw new Error('no edge cell found');
  })();

  it('辺セル選択時、双子側の面でも SELECTED が立つ', () => {
    const flags = highlightFlags(board, { face: 'F', i: edgeCell }, null);
    expect(flags.F[edgeCell] & FLAG_SELECTED).toBeTruthy();
    const tw = twins('F', edgeCell);
    expect(tw.length).toBeGreaterThan(0);
    for (const [tf, ti] of tw) {
      expect(flags[tf][ti] & FLAG_SELECTED).toBeTruthy();
    }
  });

  it('peers() の全セル (面またぎ含む) に PEER が立つ', () => {
    const flags = highlightFlags(board, { face: 'F', i: edgeCell }, null);
    const ps = peers('F', edgeCell);
    // 辺セルの peers は双子面のユニットも含むので複数面にまたがる。
    expect(new Set(ps.map(([f]) => f)).size).toBeGreaterThan(1);
    for (const [pf, pi] of ps) {
      expect(flags[pf][pi] & FLAG_PEER).toBeTruthy();
    }
  });

  it('same-number: 選択セルに値があれば全面の同数字セルに SAME が立つ', () => {
    // given のセルを選ぶ (必ず値がある)。
    let sel: { face: FaceId; i: number } | null = null;
    outer: for (const f of FACES) {
      for (let i = 0; i < 81; i++) {
        if (board.givens[f][i]) {
          sel = { face: f, i };
          break outer;
        }
      }
    }
    if (!sel) throw new Error('no given found');
    const value = board.faces[sel.face][sel.i];
    const flags = highlightFlags(board, sel, null);
    for (const f of FACES) {
      for (let i = 0; i < 81; i++) {
        const has = (flags[f][i] & FLAG_SAME) !== 0;
        expect(has).toBe(board.faces[f][i] === value);
      }
    }
  });

  it('空セル選択時は SAME が 1 つも立たない', () => {
    let empty: { face: FaceId; i: number } | null = null;
    for (let i = 0; i < 81 && !empty; i++) {
      if (board.faces.F[i] === 0) empty = { face: 'F', i };
    }
    if (!empty) throw new Error('no empty cell');
    const flags = highlightFlags(board, empty, null);
    for (const f of FACES) {
      for (let i = 0; i < 81; i++) expect(flags[f][i] & FLAG_SAME).toBe(0);
    }
  });

  it('誤答フラッシュ: WRONG も双子の両面に立つ', () => {
    const flags = highlightFlags(board, null, { face: 'F', i: edgeCell });
    for (const ref of withTwins({ face: 'F', i: edgeCell })) {
      expect(flags[ref.face][ref.i] & FLAG_WRONG).toBeTruthy();
    }
  });

  it('selected も wrong もなければ全フラグ 0', () => {
    const flags = highlightFlags(board, null, null);
    for (const f of FACES) {
      expect(flags[f].every((x) => x === 0)).toBe(true);
    }
  });
});

describe('moveSelection (画面方向の矢印移動)', () => {
  it('正立角 0° では ArrowUp でテクスチャ上方向 (ty-1) へ動く', () => {
    const from = 40; // F 面中央
    const { tx, ty } = cellTexPos('F', from);
    const up = moveSelection('F', from, 'ArrowUp', 0);
    const pos = cellTexPos('F', up);
    expect(pos.tx).toBe(tx);
    expect(pos.ty).toBe(ty - 1);
  });

  it('正立角 0° の 4 方向が互いに逆・直交になる', () => {
    const from = 40;
    const { tx, ty } = cellTexPos('F', from);
    expect(cellTexPos('F', moveSelection('F', from, 'ArrowDown', 0))).toEqual({ tx, ty: ty + 1 });
    expect(cellTexPos('F', moveSelection('F', from, 'ArrowRight', 0))).toEqual({ tx: tx + 1, ty });
    expect(cellTexPos('F', moveSelection('F', from, 'ArrowLeft', 0))).toEqual({ tx: tx - 1, ty });
  });

  it('正立角 180° では ArrowUp が ty+1 (テクスチャ下) へ動く (画面上=テクスチャ下)', () => {
    const from = 40;
    const { tx, ty } = cellTexPos('F', from);
    expect(cellTexPos('F', moveSelection('F', from, 'ArrowUp', 180))).toEqual({ tx, ty: ty + 1 });
  });

  it('正立角 90° では ArrowUp が tx 方向へ動く', () => {
    const from = 40;
    const { tx, ty } = cellTexPos('F', from);
    expect(cellTexPos('F', moveSelection('F', from, 'ArrowUp', 90))).toEqual({ tx: tx + 1, ty });
  });

  it('面端では clamp して面をまたがない', () => {
    // F 面のテクスチャ左上 (tx=0, ty=0) のセルからさらに上/左へは動かない。
    let corner = -1;
    for (let i = 0; i < 81; i++) {
      const p = cellTexPos('F', i);
      if (p.tx === 0 && p.ty === 0) corner = i;
    }
    expect(corner).toBeGreaterThanOrEqual(0);
    expect(moveSelection('F', corner, 'ArrowUp', 0)).toBe(corner);
    expect(moveSelection('F', corner, 'ArrowLeft', 0)).toBe(corner);
  });
});

describe('computeFrontFaces (正面 face の導出)', () => {
  it('恒等カメラ + 恒等姿勢の正面は F', () => {
    const fronts = computeFrontFaces(new Quaternion());
    expect(FACES[fronts[IDENTITY_POSE_INDEX]]).toBe('F');
  });

  it('オフセットカメラ ([6,5,18]) でも恒等姿勢の正面は F (最も正対する面)', () => {
    const fronts = computeFrontFaces(offsetCameraQuat());
    expect(FACES[fronts[IDENTITY_POSE_INDEX]]).toBe('F');
  });

  it('オフセットカメラで全 24 姿勢に正面 face が定まり、6 面がそれぞれ 4 姿勢ずつ正面になる', () => {
    const fronts = computeFrontFaces(offsetCameraQuat());
    expect(fronts.length).toBe(POSES.length);
    const count = new Map<number, number>();
    for (const fi of fronts) count.set(fi, (count.get(fi) ?? 0) + 1);
    // 24 姿勢 = 6 面 × 面内 4 roll なので各面ちょうど 4 回。
    expect([...count.values()]).toEqual([4, 4, 4, 4, 4, 4]);
  });
});
