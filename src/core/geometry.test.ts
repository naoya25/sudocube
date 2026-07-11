import { describe, it, expect } from 'vitest';
import {
  FACES,
  TOTAL_CELLS,
  cellVar,
  varCells,
  varCount,
  varPeers,
  twins,
  peers,
  cellId,
} from './geometry';

describe('geometry: var 構造 (docs/geometry.md 検証済みの内訳)', () => {
  it('ユニーク変数は 386 個', () => {
    expect(varCount).toBe(386);
  });

  it('全 486 セルがちょうどどれかの var に属す', () => {
    expect(TOTAL_CELLS).toBe(486);
    const total = varCells.reduce((s, cells) => s + cells.length, 0);
    expect(total).toBe(486);
    // 各セルが 1 つの var にだけ属す (cellVar が全域を一意に覆う)
    const seen = new Set<number>();
    for (let v = 0; v < varCount; v++) for (const cell of varCells[v]) seen.add(cell);
    expect(seen.size).toBe(486);
  });

  it('内訳: 面内部 294 / 辺 84 / 頂点 8', () => {
    let interior = 0;
    let edge = 0;
    let vertex = 0;
    for (const cells of varCells) {
      if (cells.length === 1) interior++;
      else if (cells.length === 2) edge++;
      else if (cells.length === 3) vertex++;
      else throw new Error(`予期しない var サイズ: ${cells.length}`);
    }
    expect(interior).toBe(294);
    expect(edge).toBe(84);
    expect(vertex).toBe(8);
  });

  it('各頂点 var はちょうど 3 セル (合計 8 個)', () => {
    const vertices = varCells.filter((c) => c.length === 3);
    expect(vertices.length).toBe(8);
    for (const c of vertices) expect(c.length).toBe(3);
  });

  it('cellVar は全セルで有効な var を指す', () => {
    for (let id = 0; id < TOTAL_CELLS; id++) {
      expect(cellVar[id]).toBeGreaterThanOrEqual(0);
      expect(cellVar[id]).toBeLessThan(varCount);
    }
  });
});

describe('geometry: twins', () => {
  it('twins の個数は 0〜2 個', () => {
    for (const face of FACES) {
      for (let i = 0; i < 81; i++) {
        const t = twins(face, i);
        expect(t.length).toBeGreaterThanOrEqual(0);
        expect(t.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('twins は対称: a の twin に b が居れば b の twin に a が居る', () => {
    for (const face of FACES) {
      for (let i = 0; i < 81; i++) {
        for (const [tf, ti] of twins(face, i)) {
          const back = twins(tf, ti);
          const hasA = back.some(([bf, bi]) => bf === face && bi === i);
          expect(hasA).toBe(true);
        }
      }
    }
  });

  it('docs の頂点実例: [0,0,8] に U(0,0) / F(8,0) / L(8,0) が集まる', () => {
    const u00 = twins('U', 0); // (r=0,c=0)
    const set = new Set(u00.map(([f, i]) => `${f}:${i}`));
    expect(set.has(`F:${8 * 9 + 0}`)).toBe(true);
    expect(set.has(`L:${8 * 9 + 0}`)).toBe(true);
    expect(u00.length).toBe(2);
  });
});

describe('geometry: peers', () => {
  it('自分自身と双子は peers に含まれない', () => {
    for (const face of FACES) {
      for (let i = 0; i < 81; i++) {
        const ps = peers(face, i);
        const twinSet = new Set(twins(face, i).map(([f, ti]) => cellId(f, ti)));
        twinSet.add(cellId(face, i));
        for (const [pf, pi] of ps) {
          expect(twinSet.has(cellId(pf, pi))).toBe(false);
        }
      }
    }
  });

  it('変数レベルの peers (varPeers) は対称 = 制約が双方向', () => {
    // 制約 (a≠b) は本来対称。cell レベルの peers() は「自分+双子の行/列/箱」定義ゆえ
    // 生セルでは非対称になりうる (逆向き制約は双子セル=同一変数が担う) が、
    // ソルバが使う変数レベル varPeers は対称でなければならない。
    for (let v = 0; v < varPeers.length; v++) {
      for (const pv of varPeers[v]) {
        expect(varPeers[pv]).toContain(v);
      }
    }
  });
});
