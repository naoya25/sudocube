import { describe, it, expect } from 'vitest';
import {
  emptyBoard,
  cloneBoard,
  setCell,
  faceCompletion,
  faceToString,
  faceFromString,
  boardToStrings,
  boardFromStrings,
  FACES,
} from './board';
import { twins } from './geometry';

describe('board: 基本操作', () => {
  it('emptyBoard は全マス 0', () => {
    const b = emptyBoard();
    for (const f of FACES) {
      expect(b.faces[f].length).toBe(81);
      expect(b.faces[f].every((x) => x === 0)).toBe(true);
      expect(b.givens[f].every((x) => x === 0)).toBe(true);
    }
  });

  it('cloneBoard は独立コピー (元を汚さない)', () => {
    const b = emptyBoard();
    b.faces.U[0] = 5;
    const c = cloneBoard(b);
    c.faces.U[0] = 9;
    expect(b.faces.U[0]).toBe(5);
    expect(c.faces.U[0]).toBe(9);
  });
});

describe('board: setCell は双子も更新する', () => {
  it('辺のマスに書くと双子面にも同じ値が入る', () => {
    const b = emptyBoard();
    // U(0,0) は頂点 (双子 2 個)。
    setCell(b, 'U', 0, 7);
    expect(b.faces.U[0]).toBe(7);
    for (const [tf, ti] of twins('U', 0)) {
      expect(b.faces[tf][ti]).toBe(7);
    }
  });

  it('内部マス (双子なし) は自分だけ更新', () => {
    const b = emptyBoard();
    const center = 4 * 9 + 4; // (4,4) 面中央、双子なし
    expect(twins('F', center).length).toBe(0);
    setCell(b, 'F', center, 3);
    expect(b.faces.F[center]).toBe(3);
  });
});

describe('board: 文字列相互変換の round-trip', () => {
  it('faceToString / faceFromString が往復する', () => {
    const arr = new Uint8Array(81);
    for (let i = 0; i < 81; i++) arr[i] = (i % 9) + 1; // 1..9 の繰り返し
    arr[10] = 0; // 空マスも混ぜる
    const s = faceToString(arr);
    expect(s.length).toBe(81);
    expect(s[10]).toBe('.');
    const back = faceFromString(s);
    expect(Array.from(back)).toEqual(Array.from(arr));
  });

  it('Board 全体の round-trip', () => {
    const b = emptyBoard();
    let k = 1;
    for (const f of FACES) {
      for (let i = 0; i < 81; i++) {
        b.faces[f][i] = k % 10; // 0..9
        k++;
      }
    }
    const strings = boardToStrings(b);
    const restored = boardFromStrings(strings);
    for (const f of FACES) {
      expect(Array.from(restored.faces[f])).toEqual(Array.from(b.faces[f]));
    }
  });

  it("'0' も空として parse できる", () => {
    const arr = faceFromString('0'.repeat(81));
    expect(arr.every((x) => x === 0)).toBe(true);
  });
});

describe('board: faceCompletion', () => {
  it('空の面は 0', () => {
    const b = emptyBoard();
    expect(faceCompletion(b, 'F')).toBe(0);
  });

  it('全マス埋まった面は 1', () => {
    const b = emptyBoard();
    for (let i = 0; i < 81; i++) b.faces.F[i] = (i % 9) + 1;
    expect(faceCompletion(b, 'F')).toBe(1);
  });

  it('一部だけ埋まっていれば非ゼロセル数 / 81', () => {
    const b = emptyBoard();
    for (let i = 0; i < 10; i++) b.faces.U[i] = 1;
    expect(faceCompletion(b, 'U')).toBeCloseTo(10 / 81);
  });
});
