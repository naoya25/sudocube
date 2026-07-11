import { describe, it, expect } from 'vitest';
import { FACES, type Board, type FaceId } from './board';
import { solve, countSolutions } from './solver';
import { generateSolved } from './generator';
import { twins } from './geometry';

/** 1 面の全行・全列・全 3×3 ブロックが {1..9} か。 */
function faceIsValid(arr: Uint8Array): boolean {
  const setEq = (vals: number[]) => {
    const s = new Set(vals);
    if (s.size !== 9) return false;
    for (let d = 1; d <= 9; d++) if (!s.has(d)) return false;
    return true;
  };
  for (let r = 0; r < 9; r++) {
    const row: number[] = [];
    for (let c = 0; c < 9; c++) row.push(arr[r * 9 + c]);
    if (!setEq(row)) return false;
  }
  for (let c = 0; c < 9; c++) {
    const col: number[] = [];
    for (let r = 0; r < 9; r++) col.push(arr[r * 9 + c]);
    if (!setEq(col)) return false;
  }
  for (let br = 0; br < 9; br += 3) {
    for (let bc = 0; bc < 9; bc += 3) {
      const box: number[] = [];
      for (let dr = 0; dr < 3; dr++)
        for (let dc = 0; dc < 3; dc++) box.push(arr[(br + dr) * 9 + (bc + dc)]);
      if (!setEq(box)) return false;
    }
  }
  return true;
}

function allTwinsEqual(board: Board): boolean {
  for (const face of FACES) {
    for (let i = 0; i < 81; i++) {
      for (const [tf, ti] of twins(face as FaceId, i)) {
        if (board.faces[face][i] !== board.faces[tf][ti]) return false;
      }
    }
  }
  return true;
}

describe('solver: 完成盤面の妥当性', () => {
  const solved = generateSolved(12345);

  it('全面の全行・全列・全 3×3 ブロックが {1..9}', () => {
    for (const f of FACES) {
      expect(faceIsValid(solved.faces[f])).toBe(true);
    }
  });

  it('全 twins ペアが同値', () => {
    expect(allTwinsEqual(solved)).toBe(true);
  });

  it('完成盤面は countSolutions === 1 (唯一解)', () => {
    expect(countSolutions(solved, 2)).toBe(1);
  });
});

describe('solver: solve()', () => {
  it('完成盤面を solve するとその盤面自身が返る', () => {
    const solved = generateSolved(999);
    const result = solve(solved);
    expect(result).not.toBeNull();
    for (const f of FACES) {
      expect(Array.from(result!.faces[f])).toEqual(Array.from(solved.faces[f]));
    }
  });

  it('複数シードで安定して完成盤面が得られる', () => {
    for (const seed of [1, 2, 3, 42, 100]) {
      const solved = generateSolved(seed);
      for (const f of FACES) expect(faceIsValid(solved.faces[f])).toBe(true);
      expect(allTwinsEqual(solved)).toBe(true);
    }
  });
});
