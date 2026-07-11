// 問題生成: 完成盤面を作り、ユニーク解を保つ限りマスを掘る。docs/generation.md が正本。
// ランダム性はシード可能 (テスト再現のため決定的)。

import { cloneBoard, FACES, type Board } from './board';
import { varCells, varCount, varPeers } from './geometry';
import { countSolutions } from './solver';

// --- seeded RNG (mulberry32) ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ALL = 0x3fe; // bit 1..9

// 掘るときの一意性チェックのノード予算。この数を超えたら「証明できない」とみなし、
// そのマスは抜かず残す。指数爆発を有限時間で打ち切るための上限 (数学的な最適性は捨てる)。
// 値は速度と掘れ具合のトレードオフ。generatePuzzle の引数で上書きできる。
const UNIQUENESS_NODE_BUDGET = 4_000;

function candidateMask(values: Int8Array, v: number): number {
  let used = 0;
  const ps = varPeers[v];
  for (let k = 0; k < ps.length; k++) {
    const pv = values[ps[k]];
    if (pv !== 0) used |= 1 << pv;
  }
  return ALL & ~used;
}

function bitCount(m: number): number {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

/**
 * seed なし DFS で完成盤面を生成する (docs/generation.md: seed は使わない)。
 * MRV + シード可能なランダム数字順で、決定的に完成盤面を 1 個返す。
 */
export function generateSolved(seed = Date.now()): Board {
  const rng = mulberry32(seed);
  const values = new Int8Array(varCount);

  const dfs = (): boolean => {
    // MRV
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let v = 0; v < varCount; v++) {
      if (values[v] !== 0) continue;
      const mask = candidateMask(values, v);
      const cnt = bitCount(mask);
      if (cnt === 0) return false;
      if (cnt < bestCount) {
        bestCount = cnt;
        bestMask = mask;
        best = v;
        if (cnt === 1) break;
      }
    }
    if (best === -1) return true; // 全変数確定 = 完成

    // 候補数字をランダム順に試す。
    const digits: number[] = [];
    for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
    shuffle(digits, rng);
    for (const d of digits) {
      values[best] = d;
      if (dfs()) return true;
      values[best] = 0;
    }
    return false;
  };

  if (!dfs()) throw new Error('generateSolved: 完成盤面が見つからない (制約が過剰)');

  // 変数値を Board に書き戻す。givens は全 1 (全マスが既知)。
  const board: Board = {
    faces: Object.fromEntries(FACES.map((f) => [f, new Uint8Array(81)])) as Board['faces'],
    givens: Object.fromEntries(FACES.map((f) => [f, new Uint8Array(81).fill(1)])) as Board['givens'],
  };
  for (let v = 0; v < varCount; v++) {
    for (const cell of varCells[v]) {
      board.faces[FACES[Math.floor(cell / 81)]][cell % 81] = values[v];
    }
  }
  return board;
}

export interface GeneratedPuzzle {
  board: Board; // 掘ったあとの問題 (空マス = 0、givens = ヒントフラグ)
  solution: Board; // 完成盤面
  givenCount: number; // ヒントとして残ったマス数 (0..486)
}

/**
 * 完成盤面からマスをシャッフル順に掘る。countSolutions(board, 2) === 1 を保つ限り削る。
 * 掘る単位は「変数」= 双子で結ばれたマス群 (1〜3 マス)。1 つがダメでも別を試し尽くす。
 * seed 固定で決定的。
 */
export function generatePuzzle(
  seed = Date.now(),
  nodeBudget = UNIQUENESS_NODE_BUDGET,
): GeneratedPuzzle {
  const solution = generateSolved(seed);
  const board = cloneBoard(solution); // faces = 完成盤、givens 全 1
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  const order = shuffle(
    Array.from({ length: varCount }, (_, v) => v),
    rng,
  );

  for (const v of order) {
    const cells = varCells[v];
    // この変数のマスを退避してから空にする。
    const saved = cells.map((cell) => board.faces[FACES[Math.floor(cell / 81)]][cell % 81]);
    for (const cell of cells) {
      const f = FACES[Math.floor(cell / 81)];
      const i = cell % 81;
      board.faces[f][i] = 0;
      board.givens[f][i] = 0;
    }
    // ユニーク解が「予算内で」保たれると証明できなければ元に戻す。
    // countSolutions は 2 個見つかれば 2、唯一解を証明できれば 1、予算超過で判定不能なら -1。
    // 1 のときだけ安全に抜ける (-1/0/2 は残す)。
    if (countSolutions(board, 2, nodeBudget) !== 1) {
      cells.forEach((cell, k) => {
        const f = FACES[Math.floor(cell / 81)];
        const i = cell % 81;
        board.faces[f][i] = saved[k];
        board.givens[f][i] = 1;
      });
    }
  }

  let givenCount = 0;
  for (const f of FACES) for (let i = 0; i < 81; i++) if (board.givens[f][i]) givenCount++;

  return { board, solution, givenCount };
}
