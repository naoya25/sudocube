import { describe, it, expect } from 'vitest';
import {
  createSession,
  inputCell,
  eraseCell,
  isComplete,
  elapsedMs,
  score,
  MISTAKE_RETENTION_SOFT,
  MISTAKE_RETENTION_HARD,
  MISTAKE_SOFT_LIMIT,
  TIME_DECAY_EXPONENT,
  type Session,
} from './session';
import type { GeneratedPuzzle } from './generator';
import { generateSolved } from './generator';
import { cloneBoard, FACES } from './board';
import { varCells, cellFace } from './geometry';

// --- テスト用 puzzle ビルダー -------------------------------------------------
// 重い generatePuzzle (solver ループ) を避け、軽い generateSolved で完成盤面を作り、
// 指定した変数 (双子で結ばれたマス群) を空にして「プレイヤーが埋めるマス」にする。
// 双子の一貫性を保つため、必ず変数単位 (varCells) で丸ごと空にする。
function makePuzzle(clearVars: number[]): GeneratedPuzzle {
  const solution = generateSolved(42);
  const board = cloneBoard(solution);
  for (const v of clearVars) {
    for (const cell of varCells[v]) {
      const [f, i] = cellFace(cell);
      board.faces[f][i] = 0;
      board.givens[f][i] = 0;
    }
  }
  let givenCount = 0;
  for (const f of FACES) for (let i = 0; i < 81; i++) if (board.givens[f][i]) givenCount++;
  return { board, solution, givenCount };
}

/** solution 上でのそのマスの正解値。 */
function correct(session: Session, cellId: number): number {
  const [f, i] = cellFace(cellId);
  return session.solution.faces[f][i];
}

// 双子を持つ変数 (varCells.length > 1) と、単独マスの変数を 1 つずつ拾う。
const twinVar = varCells.findIndex((cells) => cells.length > 1);
const soloVar = varCells.findIndex((cells) => cells.length === 1);

describe('session: 入力の受理と拒否', () => {
  it('ヒントのマスは入力を拒否し状態は不変', () => {
    const session = createSession(makePuzzle([soloVar]), 0);
    // ヒントのマスを 1 つ探す。
    let gf = FACES[0];
    let gi = 0;
    outer: for (const f of FACES) {
      for (let i = 0; i < 81; i++) {
        if (session.puzzle.givens[f][i] === 1) {
          gf = f;
          gi = i;
          break outer;
        }
      }
    }
    const before = session.board.faces[gf][gi];
    const res = inputCell(session, gf, gi, 5);
    expect(res.accepted).toBe(false);
    expect(res.wrong).toBe(false);
    expect(session.board.faces[gf][gi]).toBe(before); // 不変
    expect(session.mistakes).toBe(0);
  });

  it('正しい値は受理されマスが埋まる (双子マスも同時に埋まる)', () => {
    const session = createSession(makePuzzle([twinVar]), 0);
    const cells = varCells[twinVar];
    expect(cells.length).toBeGreaterThan(1); // 双子ありの変数
    const [f0, i0] = cellFace(cells[0]);
    const value = correct(session, cells[0]);

    // 入力前はこの変数のマスは全て空。
    for (const cell of cells) {
      const [f, i] = cellFace(cell);
      expect(session.board.faces[f][i]).toBe(0);
    }

    const res = inputCell(session, f0, i0, value);
    expect(res.accepted).toBe(true);
    expect(res.wrong).toBe(false);

    // 入力したマスも、双子マスも同じ値で埋まっている。
    for (const cell of cells) {
      const [f, i] = cellFace(cell);
      expect(session.board.faces[f][i]).toBe(value);
    }
  });

  it('誤った値は拒否され mistakes が 1 増え盤面は不変', () => {
    const session = createSession(makePuzzle([soloVar]), 0);
    const cell = varCells[soloVar][0];
    const [f, i] = cellFace(cell);
    const right = correct(session, cell);
    const wrong = right === 1 ? 2 : 1; // 正解と必ず異なる値

    const res = inputCell(session, f, i, wrong);
    expect(res.accepted).toBe(false);
    expect(res.wrong).toBe(true);
    expect(res.won).toBe(false);
    expect(session.mistakes).toBe(1);
    expect(session.board.faces[f][i]).toBe(0); // 間違いは盤面に入らない
  });

  it('誤入力は双子マスにも書き込まない', () => {
    const session = createSession(makePuzzle([twinVar]), 0);
    const cells = varCells[twinVar];
    const [f0, i0] = cellFace(cells[0]);
    const right = correct(session, cells[0]);
    inputCell(session, f0, i0, right === 1 ? 2 : 1); // 誤入力
    for (const cell of cells) {
      const [f, i] = cellFace(cell);
      expect(session.board.faces[f][i]).toBe(0); // 双子含め全て空のまま
    }
    expect(session.mistakes).toBe(1);
  });
});

describe('session: 勝利判定', () => {
  it('ヒント以外を全部正しく埋めると won になる', () => {
    const clearVars = [twinVar, soloVar, soloVar + 1, soloVar + 2].filter(
      (v, idx, a) => v >= 0 && a.indexOf(v) === idx,
    );
    const session = createSession(makePuzzle(clearVars), 0);
    expect(isComplete(session)).toBe(false);
    expect(session.status).toBe('playing');

    let lastWon = false;
    for (const v of clearVars) {
      const cell = varCells[v][0];
      const [f, i] = cellFace(cell);
      const res = inputCell(session, f, i, correct(session, cell));
      lastWon = res.won;
    }
    expect(lastWon).toBe(true);
    expect(session.status).toBe('won');
    expect(isComplete(session)).toBe(true);
  });

  it('勝利後は凍結: 誤入力しても mistakes/status/盤面が変わらない', () => {
    const clearVars = [twinVar, soloVar, soloVar + 1, soloVar + 2].filter(
      (v, idx, a) => v >= 0 && a.indexOf(v) === idx,
    );
    const session = createSession(makePuzzle(clearVars), 0);
    for (const v of clearVars) {
      const cell = varCells[v][0];
      const [f, i] = cellFace(cell);
      inputCell(session, f, i, correct(session, cell));
    }
    expect(session.status).toBe('won');

    const snapshot = FACES.map((f) => Array.from(session.board.faces[f]));
    // 勝利後に誤入力を試みる。
    const cell = varCells[soloVar][0];
    const [f, i] = cellFace(cell);
    const right = correct(session, cell);
    const res = inputCell(session, f, i, right === 1 ? 2 : 1);

    expect(res.won).toBe(true);
    expect(res.wrong).toBe(false);
    expect(session.mistakes).toBe(0); // 勝利後のミスはカウントされない
    expect(session.status).toBe('won');
    FACES.forEach((face, idx) => {
      expect(Array.from(session.board.faces[face])).toEqual(snapshot[idx]); // 盤面不変
    });
  });
});

describe('session: 消去 (eraseCell)', () => {
  it('埋めたマスを空に戻す (双子も同期・ミスにならない)', () => {
    // twinVar 以外も空けておく (twinVar だけだと埋めた瞬間に won で凍結するため)。
    const clearVars = [twinVar, soloVar, soloVar + 1].filter(
      (v, idx, a) => v >= 0 && a.indexOf(v) === idx,
    );
    const session = createSession(makePuzzle(clearVars), 0);
    const cells = varCells[twinVar];
    const [f0, i0] = cellFace(cells[0]);
    inputCell(session, f0, i0, correct(session, cells[0])); // 正解を埋める
    expect(session.status).toBe('playing'); // まだ勝っていない
    const res = eraseCell(session, f0, i0);
    expect(res.erased).toBe(true);
    for (const cell of cells) {
      const [f, i] = cellFace(cell);
      expect(session.board.faces[f][i]).toBe(0); // 双子含め空に戻る
    }
    expect(session.mistakes).toBe(0);
  });

  it('ヒントのマスは消せない (no-op)', () => {
    const session = createSession(makePuzzle([soloVar]), 0);
    let gf = FACES[0];
    let gi = 0;
    outer: for (const f of FACES) {
      for (let i = 0; i < 81; i++) {
        if (session.puzzle.givens[f][i] === 1) {
          gf = f;
          gi = i;
          break outer;
        }
      }
    }
    const before = session.board.faces[gf][gi];
    expect(eraseCell(session, gf, gi).erased).toBe(false);
    expect(session.board.faces[gf][gi]).toBe(before);
  });

  it('inputCell に 0 (範囲外) を渡してもミスにならず盤面不変', () => {
    const session = createSession(makePuzzle([soloVar]), 0);
    const cell = varCells[soloVar][0];
    const [f, i] = cellFace(cell);
    const res = inputCell(session, f, i, 0);
    expect(res.wrong).toBe(false);
    expect(res.accepted).toBe(false);
    expect(session.mistakes).toBe(0);
    expect(session.board.faces[f][i]).toBe(0);
  });
});

describe('session: elapsedMs', () => {
  it('渡した now から決定的に経過ミリ秒を計算する', () => {
    const session = createSession(makePuzzle([soloVar]), 1000);
    expect(elapsedMs(session, 1000)).toBe(0);
    expect(elapsedMs(session, 6000)).toBe(5000);
  });
});

describe('session: score', () => {
  const base = () => createSession(makePuzzle([soloVar]), 0);

  it('ノーミス & 経過 0 秒 = 100 (満点は経過 0 秒のみ)', () => {
    const s = base();
    expect(score(s, 0)).toBe(100);
  });

  it('タイムは経過 0 秒から効く (平坦ゾーンなし): 300 秒で ≈ 92.582', () => {
    const s = base();
    const v = score(s, 300_000);
    expect(v).toBeLessThan(100);
    expect(v).toBeCloseTo(100 * (1800 / 2100) ** TIME_DECAY_EXPONENT, 5); // (1800/2100)^0.5 ≈ 92.582
  });

  it('ミスが増えるとスコアは単調減少する (3 回までは 0.97^n の緩い減衰)', () => {
    const s = base();
    const s0 = score(s, 0);
    s.mistakes = 1;
    const s1 = score(s, 0);
    s.mistakes = 3;
    const s3 = score(s, 0);
    expect(s0).toBeGreaterThan(s1);
    expect(s1).toBeGreaterThan(s3);
    expect(s1).toBeCloseTo(100 * MISTAKE_RETENTION_SOFT, 5); // ミス 1 個 = 100 * 0.97 = 97
    expect(s3).toBeCloseTo(100 * MISTAKE_RETENTION_SOFT ** 3, 5); // ミス 3 個 = 100 * 0.97^3 ≈ 91.267
  });

  it('ミスは 2 段階: 4 回目からのペナルティ (-10%) は 3 回目まで (-3%) より重い', () => {
    const s = base();
    s.mistakes = 2;
    const s2 = score(s, 0);
    s.mistakes = 3;
    const s3 = score(s, 0);
    s.mistakes = 4;
    const s4 = score(s, 0);
    expect(s4).toBeCloseTo(
      100 * MISTAKE_RETENTION_SOFT ** MISTAKE_SOFT_LIMIT * MISTAKE_RETENTION_HARD,
      5,
    ); // 100 * 0.97^3 * 0.90 ≈ 82.141
    expect(s3 - s4).toBeGreaterThan(s2 - s3); // 3→4 の落差 > 2→3 の落差
  });

  it('タイムは凸カーブ: 序盤の 300 秒は終盤の 300 秒より高くつく', () => {
    const early = base();
    const drop0to300 = score(early, 0) - score(early, 300_000);
    const drop3600to3900 = score(early, 3_600_000) - score(early, 3_900_000);
    expect(drop0to300).toBeGreaterThan(drop3600to3900);
  });

  it('60 分経過で ≈ 57.735 (timeFactor = (1800/5400)^0.5)', () => {
    const s = base();
    const v = score(s, 3_600_000);
    expect(v).toBeCloseTo(100 * (1800 / 5400) ** TIME_DECAY_EXPONENT, 5); // ≈ 57.735
  });

  it('大量ミスでもスコアは 0 に丸められず、漸近的に 0 に近づくのみ (乗算減衰の性質)', () => {
    // 旧式 (減点方式) では mistakes >= 25 で 0 点にクランプされていたが、
    // 新式は乗算のため理論上 0 にならない。50 ミスでも > 0 を保証する。
    const s = base();
    s.mistakes = 50;
    const heavy = score(s, 0);
    expect(heavy).toBeGreaterThan(0);
    expect(heavy).toBeCloseTo(
      100 * MISTAKE_RETENTION_SOFT ** 3 * MISTAKE_RETENTION_HARD ** 47,
      5,
    ); // ≈ 0.643

    s.mistakes = 100;
    const veryHeavy = score(s, 0);
    expect(veryHeavy).toBeGreaterThanOrEqual(0.001); // clamp 下限

    // 大量ミス + 長時間を組み合わせても下限 0.001 でクランプされ、負にはならない。
    const extreme = score(s, 10_000_000);
    expect(extreme).toBeGreaterThanOrEqual(0.001);
    expect(extreme).toBeLessThanOrEqual(veryHeavy);
  });

  it('代表値: 3 ミス・60 分 ≈ 52.693 / 10 ミス・60 分 ≈ 25.203', () => {
    const threeMistakes = base();
    threeMistakes.mistakes = 3;
    expect(Math.abs(score(threeMistakes, 3_600_000) - 52.693)).toBeLessThan(0.001);

    const tenMistakes = base();
    tenMistakes.mistakes = 10;
    expect(Math.abs(score(tenMistakes, 3_600_000) - 25.203)).toBeLessThan(0.001);
  });

  it('timeScaleSeconds=0 でも NaN にならず 0.001〜100 を返す', () => {
    const s = base();
    const v = score(s, 0, 0);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0.001);
    expect(v).toBeLessThanOrEqual(100);
  });

  it('負の経過時間 (now < startedAt) でもスコアは 0.001〜100 に収まる', () => {
    const s = base();
    const v = score(s, -10_000);
    expect(v).toBeGreaterThanOrEqual(0.001);
    expect(v).toBeLessThanOrEqual(100);
  });
});
