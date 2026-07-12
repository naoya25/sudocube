import { describe, expect, it } from 'vitest';
import { FACES } from './board';
import { emptyNotes, toggleNote, type NotesMap } from './notes';
import { inputCell, newGame, type Session } from './session';
import {
  addRecord,
  appendRecord,
  clearCurrentGame,
  CURRENT_GAME_KEY,
  deserializeGame,
  loadCurrentGame,
  loadRecords,
  MAX_RECORDS,
  parseRecords,
  RECORDS_KEY,
  saveCurrentGame,
  SCHEMA_VERSION,
  serializeGame,
  serializeRecords,
  toSession,
  type ClearRecord,
  type StorageLike,
} from './persistence';

/** テスト用インメモリ storage。 */
function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** 常に例外を投げる storage (プライベートブラウジング等の再現)。 */
function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
}

/** 進行途中のセッションを作る (正解入力 2 つ + ミス 1 つ + メモ)。 */
function playedSession(): { session: Session; notes: NotesMap } {
  const session = newGame(42, 1_000_000);
  // 空マスを 2 つ見つけて正解を入れる
  let filled = 0;
  outer: for (const f of FACES) {
    for (let i = 0; i < 81; i++) {
      if (session.board.faces[f][i] === 0) {
        inputCell(session, f, i, session.solution.faces[f][i]);
        if (++filled >= 2) break outer;
      }
    }
  }
  // わざと 1 ミス (空マスに間違った値)
  outer2: for (const f of FACES) {
    for (let i = 0; i < 81; i++) {
      if (session.board.faces[f][i] === 0) {
        const wrong = (session.solution.faces[f][i] % 9) + 1;
        inputCell(session, f, i, wrong);
        break outer2;
      }
    }
  }
  let notes = emptyNotes();
  // 空マスにメモを付ける
  outer3: for (const f of FACES) {
    for (let i = 0; i < 81; i++) {
      if (session.board.faces[f][i] === 0) {
        notes = toggleNote(notes, f, i, 3);
        notes = toggleNote(notes, f, i, 7);
        break outer3;
      }
    }
  }
  return { session, notes };
}

describe('persistence: serializeGame / deserializeGame round-trip', () => {
  it('盤面・メモ・ミス・経過時間・seed が往復で一致する', () => {
    const { session, notes } = playedSession();
    const savedNow = session.startedAt + 90_000; // 90 秒経過時点で保存
    const json = serializeGame(session, notes, 42, savedNow);

    const saved = deserializeGame(json);
    expect(saved).not.toBeNull();
    if (!saved) return;

    expect(saved.seed).toBe(42);
    expect(saved.mistakes).toBe(session.mistakes);
    expect(saved.elapsedMs).toBe(90_000);
    for (const f of FACES) {
      expect([...saved.board.faces[f]]).toEqual([...session.board.faces[f]]);
      expect([...saved.puzzle.faces[f]]).toEqual([...session.puzzle.faces[f]]);
      expect([...saved.puzzle.givens[f]]).toEqual([...session.puzzle.givens[f]]);
      expect([...saved.solution.faces[f]]).toEqual([...session.solution.faces[f]]);
    }
    // NotesMap の中身が一致
    expect(saved.notes.size).toBe(notes.size);
    for (const [k, set] of notes) {
      const restored = saved.notes.get(k);
      expect(restored).toBeDefined();
      expect([...(restored ?? [])].sort()).toEqual([...set].sort());
    }
  });

  it('toSession は startedAt を逆算する (離席中は加算しない)', () => {
    const { session, notes } = playedSession();
    const json = serializeGame(session, notes, 42, session.startedAt + 90_000);
    const saved = deserializeGame(json);
    expect(saved).not.toBeNull();
    if (!saved) return;
    const resumeNow = 5_000_000; // 保存からずっと後に再開
    const restored = toSession(saved, resumeNow);
    expect(restored.status).toBe('playing');
    expect(resumeNow - restored.startedAt).toBe(90_000); // 経過 = 保存時点のまま
  });

  it('復元後の Session で続きをプレイできる', () => {
    const { session, notes } = playedSession();
    const saved = deserializeGame(serializeGame(session, notes, 42, session.startedAt + 1000));
    if (!saved) throw new Error('deserialize failed');
    const restored = toSession(saved, Date.now());
    // 空マスに正解を入れられる
    outer: for (const f of FACES) {
      for (let i = 0; i < 81; i++) {
        if (restored.board.faces[f][i] === 0) {
          const res = inputCell(restored, f, i, restored.solution.faces[f][i]);
          expect(res.accepted).toBe(true);
          break outer;
        }
      }
    }
  });
});

describe('persistence: 破損データ・バージョン違い', () => {
  it('壊れた JSON は null', () => {
    expect(deserializeGame('{oops')).toBeNull();
    expect(deserializeGame('')).toBeNull();
    expect(deserializeGame(null)).toBeNull();
    expect(deserializeGame(undefined)).toBeNull();
    expect(deserializeGame('42')).toBeNull();
    expect(deserializeGame('"str"')).toBeNull();
    expect(deserializeGame('[]')).toBeNull();
  });

  it('バージョン違い・欠落は null', () => {
    const { session, notes } = playedSession();
    const obj = JSON.parse(serializeGame(session, notes, 42, session.startedAt + 1000));
    expect(deserializeGame(JSON.stringify({ ...obj, v: 2 }))).toBeNull();
    expect(deserializeGame(JSON.stringify({ ...obj, v: undefined }))).toBeNull();
    expect(deserializeGame(JSON.stringify({ ...obj, solution: undefined }))).toBeNull();
    expect(deserializeGame(JSON.stringify({ ...obj, elapsedMs: 'abc' }))).toBeNull();
    expect(deserializeGame(JSON.stringify({ ...obj, mistakes: -1 }))).toBeNull();
  });

  it('盤面の整合性が壊れているデータ (solution と矛盾する入力) は null', () => {
    const { session, notes } = playedSession();
    const obj = JSON.parse(serializeGame(session, notes, 42, session.startedAt + 1000));
    // 空マスに solution と違う値を直書きする改ざん
    const faceStr: string = obj.board.U;
    const emptyIdx = faceStr.indexOf('.');
    if (emptyIdx >= 0) {
      const sol = Number(obj.solution.U[emptyIdx]);
      const wrong = String((sol % 9) + 1);
      obj.board.U = faceStr.slice(0, emptyIdx) + wrong + faceStr.slice(emptyIdx + 1);
      expect(deserializeGame(JSON.stringify(obj))).toBeNull();
    }
  });

  it('不正な notes は null', () => {
    const { session, notes } = playedSession();
    const obj = JSON.parse(serializeGame(session, notes, 42, session.startedAt + 1000));
    expect(deserializeGame(JSON.stringify({ ...obj, notes: [[999, [1]]] }))).toBeNull();
    expect(deserializeGame(JSON.stringify({ ...obj, notes: [[0, [0]]] }))).toBeNull();
    expect(deserializeGame(JSON.stringify({ ...obj, notes: 'bad' }))).toBeNull();
  });

  it('SCHEMA_VERSION は 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe('persistence: クリア戦績 (records)', () => {
  const rec = (i: number): ClearRecord => ({
    clearedAt: `2026-07-12T00:00:${String(i).padStart(2, '0')}.000Z`,
    timeMs: 60_000 + i,
    mistakes: i,
    score: 100 - i,
    seed: i,
  });

  it('serialize / parse の往復', () => {
    const records = [rec(1), rec(2)];
    expect(parseRecords(serializeRecords(records))).toEqual(records);
  });

  it('壊れたデータは []・不正エントリはスキップ', () => {
    expect(parseRecords('{bad')).toEqual([]);
    expect(parseRecords(null)).toEqual([]);
    expect(parseRecords('{"a":1}')).toEqual([]);
    const mixed = JSON.stringify([rec(1), { clearedAt: 5 }, 'junk', rec(2)]);
    expect(parseRecords(mixed)).toEqual([rec(1), rec(2)]);
  });

  it('appendRecord は先頭に追加し MAX_RECORDS で古い順に切り捨てる', () => {
    let records: ClearRecord[] = [];
    for (let i = 0; i < MAX_RECORDS + 5; i++) records = appendRecord(records, rec(i));
    expect(records).toHaveLength(MAX_RECORDS);
    expect(records[0]).toEqual(rec(MAX_RECORDS + 4)); // 最新が先頭
    expect(records[MAX_RECORDS - 1]).toEqual(rec(5)); // 一番古い 5 件が消えた
  });
});

describe('persistence: storage 入出力', () => {
  it('save → load → clear のライフサイクル', () => {
    const storage = memoryStorage();
    const { session, notes } = playedSession();
    saveCurrentGame(session, notes, 42, session.startedAt + 1000, storage);
    expect(storage.map.has(CURRENT_GAME_KEY)).toBe(true);

    const saved = loadCurrentGame(storage);
    expect(saved).not.toBeNull();
    expect(saved?.seed).toBe(42);

    clearCurrentGame(storage);
    expect(storage.map.has(CURRENT_GAME_KEY)).toBe(false);
    expect(loadCurrentGame(storage)).toBeNull();
  });

  it('addRecord は保存して保存後の配列を返す', () => {
    const storage = memoryStorage();
    const r: ClearRecord = {
      clearedAt: '2026-07-12T00:00:00.000Z',
      timeMs: 123_000,
      mistakes: 2,
      score: 88,
      seed: 7,
    };
    const after = addRecord(r, storage);
    expect(after).toEqual([r]);
    expect(loadRecords(storage)).toEqual([r]);
    expect(storage.map.has(RECORDS_KEY)).toBe(true);
  });

  it('storage が例外を投げても死なない', () => {
    const storage = throwingStorage();
    const { session, notes } = playedSession();
    expect(() => saveCurrentGame(session, notes, 42, Date.now(), storage)).not.toThrow();
    expect(loadCurrentGame(storage)).toBeNull();
    expect(() => clearCurrentGame(storage)).not.toThrow();
    expect(loadRecords(storage)).toEqual([]);
    expect(() => addRecord(rec0(), storage)).not.toThrow();
  });

  it('storage が null (localStorage 不可) でも死なない', () => {
    const { session, notes } = playedSession();
    expect(() => saveCurrentGame(session, notes, 42, Date.now(), null)).not.toThrow();
    expect(loadCurrentGame(null)).toBeNull();
    expect(() => clearCurrentGame(null)).not.toThrow();
    expect(loadRecords(null)).toEqual([]);
    expect(addRecord(rec0(), null)).toEqual([rec0()]);
  });

  function rec0(): ClearRecord {
    return { clearedAt: '2026-07-12T00:00:00.000Z', timeMs: 1000, mistakes: 0, score: 100, seed: null };
  }
});
