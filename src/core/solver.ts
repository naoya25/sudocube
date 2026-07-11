// ソルバ: DFS バックトラック + MRV。docs/generation.md が正本。
// 内部では共有マスを 1 変数に畳んだ 386 変数モデル (geometry.ts) 上で解く。
// 制約 (peers) だけが通常の数独と違い、アルゴリズム本体は同じ。

import { FACES, type Board } from './board';
import { cellVar, varCells, varCount, varPeers } from './geometry';

// values[v]: 変数 v の値 (0 = 未確定、1..9 = 確定)。
type VarValues = Int8Array;

/** Board の faces から変数値配列を作る。矛盾があっても検出はしない (前提: 整合済み)。 */
function boardToVars(board: Board): VarValues {
  const values = new Int8Array(varCount);
  let g = 0;
  for (const f of FACES) {
    const arr = board.faces[f];
    for (let i = 0; i < 81; i++, g++) {
      if (arr[i] !== 0) values[cellVar[g]] = arr[i];
    }
  }
  return values;
}

/** 変数値配列を Board に書き戻す (全セル)。 */
function varsToBoard(values: VarValues, out: Board): void {
  for (let v = 0; v < varCount; v++) {
    const val = values[v];
    for (const cell of varCells[v]) {
      const faceIdx = Math.floor(cell / 81);
      const i = cell % 81;
      out.faces[FACES[faceIdx]][i] = val;
    }
  }
}

// bit 1..9 を使うマスク。bit 0 は未使用。
const ALL = 0x3fe; // 0b11_1111_1110

/** popcount (0..9)。 */
function bitCount(m: number): number {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

/**
 * DFS 本体 (インクリメンタル候補ビットマスク方式)。
 *
 * 各変数の候補集合 cand[v] を保持し、割り当てのたびに peers の候補から差分更新する。
 * これで MRV は候補数の popcount 走査だけ (peers 再走査不要) になり、
 * スパースな盤面でのユニーク性証明も高速に済む。undo は変更の trail 巻き戻しで行う。
 *
 * 見つかった解数 (cap で頭打ち) を返す。
 */
function search(
  givens: VarValues,
  cap: number,
  onSolution: (v: Int8Array) => void,
  nodeBudget = Infinity,
): { found: number; exceeded: boolean } {
  const value = new Int8Array(varCount); // 0 = 未割り当て
  const cand = new Int32Array(varCount).fill(ALL); // 各変数の候補ビット集合
  const trail: number[] = []; // 候補除去の記録: v*16 + d (undo で bit を戻す)
  let found = 0;
  let nodes = 0; // 探索ノード数 (予算超過の打ち切り用)
  let exceeded = false; // nodeBudget を超えて打ち切ったか

  // peer p から数字 d を候補除去。矛盾 (候補が空) なら false。
  const removeCand = (p: number, d: number): boolean => {
    if (value[p] !== 0) return true;
    const bit = 1 << d;
    if (cand[p] & bit) {
      cand[p] &= ~bit;
      trail.push(p * 16 + d);
      if (cand[p] === 0) return false;
    }
    return true;
  };

  // v に d を割り当て、peers の候補を更新。矛盾なら false (呼び出し側で undo)。
  const assign = (v: number, d: number): boolean => {
    value[v] = d;
    const ps = varPeers[v];
    for (let k = 0; k < ps.length; k++) {
      if (!removeCand(ps[k], d)) return false;
    }
    return true;
  };

  // 与えられたヒントを恒久ベースとして適用 (undo しない)。矛盾があれば解なし。
  for (let v = 0; v < varCount; v++) {
    const d = givens[v];
    if (d === 0) continue;
    if (value[v] === d) continue;
    if (value[v] !== 0) return { found: 0, exceeded: false }; // 既に別の値 (双子同士の食い違い)
    if ((cand[v] & (1 << d)) === 0) return { found: 0, exceeded: false }; // ヒントが peers と矛盾
    if (!assign(v, d)) return { found: 0, exceeded: false };
  }

  const dfs = (): boolean => {
    // 予算超過なら打ち切り (true を返して即 unwind)。
    if (++nodes > nodeBudget) {
      exceeded = true;
      return true;
    }
    // MRV: 候補が最少の未割り当て変数を選ぶ (popcount 走査のみ)。
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let v = 0; v < varCount; v++) {
      if (value[v] !== 0) continue;
      const cnt = bitCount(cand[v]);
      if (cnt === 0) return false; // 死に分岐
      if (cnt < bestCount) {
        bestCount = cnt;
        bestMask = cand[v];
        best = v;
        if (cnt === 1) break;
      }
    }

    if (best === -1) {
      onSolution(value);
      found++;
      return found >= cap;
    }

    for (let d = 1; d <= 9; d++) {
      if ((bestMask & (1 << d)) === 0) continue;
      const mark = trail.length;
      const ok = assign(best, d);
      if (ok && dfs()) return true;
      // undo: この分岐で除去した候補を戻し、割り当てを解除。
      while (trail.length > mark) {
        const e = trail.pop()!;
        cand[e >> 4] |= 1 << (e & 15);
      }
      value[best] = 0;
    }
    return false;
  };

  dfs();
  return { found, exceeded };
}

/**
 * 1 解を返す。解が無ければ null。
 * 入力 board は変更しない (新しい Board を返す)。
 */
export function solve(board: Board): Board | null {
  const values = boardToVars(board);
  let solution: Int8Array | null = null;
  search(values, 1, (v) => {
    solution = Int8Array.from(v);
  });
  if (solution === null) return null;
  // varsToBoard 用に空 Board を用意。
  const out: Board = {
    faces: Object.fromEntries(FACES.map((f) => [f, new Uint8Array(81)])) as Board['faces'],
    givens: Object.fromEntries(FACES.map((f) => [f, new Uint8Array(81)])) as Board['givens'],
  };
  varsToBoard(solution, out);
  return out;
}

/**
 * 解を cap 個見つけたら打ち切り、見つかった個数を返す。
 * 一意性判定には cap = 2 を使う (=== 1 なら唯一解)。
 */
export function countSolutions(board: Board, cap: number, nodeBudget = Infinity): number {
  const values = boardToVars(board);
  const { found, exceeded } = search(values, cap, () => {}, nodeBudget);
  // 予算内に cap 個も見つからず打ち切った = 一意性を判定できなかった。-1 を返す。
  if (exceeded && found < cap) return -1;
  return found;
}
