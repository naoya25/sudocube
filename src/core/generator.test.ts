import { describe, it, expect } from 'vitest';
import { FACES } from './board';
import { generatePuzzle } from './generator';
import { countSolutions } from './solver';

describe('generator: generatePuzzle', () => {
  it('出力はユニーク解 (countSolutions === 1)', () => {
    for (const seed of [1, 7, 42]) {
      const { board } = generatePuzzle(seed);
      expect(countSolutions(board, 2)).toBe(1);
    }
  });

  it('givens のマスは完成盤と一致し、値が入っている', () => {
    const { board, solution } = generatePuzzle(2024);
    for (const f of FACES) {
      for (let i = 0; i < 81; i++) {
        if (board.givens[f][i]) {
          expect(board.faces[f][i]).toBe(solution.faces[f][i]);
          expect(board.faces[f][i]).not.toBe(0);
        } else {
          // 掘ったマスは空
          expect(board.faces[f][i]).toBe(0);
        }
      }
    }
  });

  it('掘った結果ヒントは全マスより少ない (実際に掘れている)', () => {
    const { givenCount } = generatePuzzle(555);
    expect(givenCount).toBeGreaterThan(0);
    expect(givenCount).toBeLessThan(486);
  });

  it('同じシードは決定的 (再現性)', () => {
    const a = generatePuzzle(77);
    const b = generatePuzzle(77);
    expect(a.givenCount).toBe(b.givenCount);
    for (const f of FACES) {
      expect(Array.from(a.board.faces[f])).toEqual(Array.from(b.board.faces[f]));
    }
  });
});
