// notes.ts (候補数字メモ) のテスト: トグル・双子共有・自動クリーンアップ。

import { describe, expect, it } from 'vitest';
import { emptyBoard } from './board';
import { peers, twins } from './geometry';
import {
  canonicalCellId,
  cleanupAfterInput,
  clearCellNotes,
  emptyNotes,
  faceNotes,
  faceNoteFillRate,
  faceNotesSignature,
  notesAt,
  toggleNote,
} from './notes';

describe('toggleNote', () => {
  it('候補を追加し、同じ値をもう一度トグルすると消える', () => {
    let notes = emptyNotes();
    notes = toggleNote(notes, 'F', 40, 3);
    expect([...(notesAt(notes, 'F', 40) ?? [])]).toEqual([3]);
    notes = toggleNote(notes, 'F', 40, 7);
    expect([...(notesAt(notes, 'F', 40) ?? [])].sort()).toEqual([3, 7]);
    notes = toggleNote(notes, 'F', 40, 3);
    expect([...(notesAt(notes, 'F', 40) ?? [])]).toEqual([7]);
  });

  it('集合が空になったらエントリごと削除される', () => {
    let notes = emptyNotes();
    notes = toggleNote(notes, 'F', 40, 5);
    notes = toggleNote(notes, 'F', 40, 5);
    expect(notes.size).toBe(0);
  });

  it('範囲外の値は no-op (同じ参照を返す)', () => {
    const notes = emptyNotes();
    expect(toggleNote(notes, 'F', 40, 0)).toBe(notes);
    expect(toggleNote(notes, 'F', 40, 10)).toBe(notes);
  });

  it('元の NotesMap を変更しない (immutable)', () => {
    const before = toggleNote(emptyNotes(), 'F', 40, 3);
    toggleNote(before, 'F', 40, 8);
    expect([...(notesAt(before, 'F', 40) ?? [])]).toEqual([3]);
  });
});

describe('双子共有 (canonical キー正規化)', () => {
  // F 面の上端行 (r=8) は U 面と辺を共有する。
  const face = 'F' as const;
  const i = 76; // r=8, c=4 の辺セル
  const twinList = twins(face, i);

  it('前提: 対象セルは双子を持つ', () => {
    expect(twinList.length).toBeGreaterThan(0);
  });

  it('canonicalCellId は双子同士で一致する', () => {
    for (const [tf, ti] of twinList) {
      expect(canonicalCellId(tf, ti)).toBe(canonicalCellId(face, i));
    }
  });

  it('片面に書いたメモが双子面からも見える', () => {
    const notes = toggleNote(emptyNotes(), face, i, 4);
    for (const [tf, ti] of twinList) {
      expect([...(notesAt(notes, tf, ti) ?? [])]).toEqual([4]);
    }
  });

  it('faceNotes で双子面にも同じ集合が現れる', () => {
    const notes = toggleNote(emptyNotes(), face, i, 9);
    const [tf, ti] = twinList[0];
    expect([...(faceNotes(notes, tf)[ti] ?? [])]).toEqual([9]);
  });
});

describe('clearCellNotes', () => {
  it('セルのメモを全消去する (双子側指定でも消える)', () => {
    let notes = toggleNote(emptyNotes(), 'F', 76, 1);
    notes = toggleNote(notes, 'F', 76, 2);
    const [tf, ti] = twins('F', 76)[0];
    notes = clearCellNotes(notes, tf, ti);
    expect(notesAt(notes, 'F', 76)).toBeUndefined();
  });

  it('メモが無ければ同じ参照を返す', () => {
    const notes = emptyNotes();
    expect(clearCellNotes(notes, 'F', 0)).toBe(notes);
  });
});

describe('cleanupAfterInput', () => {
  it('入力セル自身のメモを消す', () => {
    let notes = toggleNote(emptyNotes(), 'F', 40, 5);
    notes = cleanupAfterInput(notes, 'F', 40, 5);
    expect(notesAt(notes, 'F', 40)).toBeUndefined();
  });

  it('同一面の peer のメモから同じ数字だけ消える', () => {
    let notes = toggleNote(emptyNotes(), 'F', 36, 5); // F40 と同じ行
    notes = toggleNote(notes, 'F', 36, 6);
    notes = cleanupAfterInput(notes, 'F', 40, 5);
    expect([...(notesAt(notes, 'F', 36) ?? [])]).toEqual([6]);
  });

  it('面またぎの peer (双子経由含む) からも消える', () => {
    // F76 (r=8,c=4) の peers には U 面のセルが含まれる。
    const crossPeer = peers('F', 76).find(([pf]) => pf !== 'F');
    expect(crossPeer).toBeDefined();
    const [pf, pi] = crossPeer!;
    let notes = toggleNote(emptyNotes(), pf, pi, 8);
    notes = cleanupAfterInput(notes, 'F', 76, 8);
    expect(notesAt(notes, pf, pi)).toBeUndefined();
  });

  it('peer でも違う数字のメモは残る', () => {
    let notes = toggleNote(emptyNotes(), 'F', 36, 2);
    notes = cleanupAfterInput(notes, 'F', 40, 5);
    expect([...(notesAt(notes, 'F', 36) ?? [])]).toEqual([2]);
  });

  it('peer でないセルのメモは残る', () => {
    // F0 (r=0,c=0) と F40 (r=4,c=4) は行・列・箱いずれも共有しない。
    let notes = toggleNote(emptyNotes(), 'F', 0, 5);
    notes = cleanupAfterInput(notes, 'F', 40, 5);
    expect([...(notesAt(notes, 'F', 0) ?? [])]).toEqual([5]);
  });

  it('変化が無ければ同じ参照を返す', () => {
    const notes = toggleNote(emptyNotes(), 'F', 0, 5);
    expect(cleanupAfterInput(notes, 'F', 40, 9)).toBe(notes);
  });
});

describe('faceNotesSignature', () => {
  it('メモの変化でシグネチャが変わり、無関係な面は変わらない', () => {
    const empty = emptyNotes();
    const withNote = toggleNote(empty, 'F', 40, 3);
    expect(faceNotesSignature(withNote, 'F')).not.toBe(faceNotesSignature(empty, 'F'));
    expect(faceNotesSignature(withNote, 'B')).toBe(faceNotesSignature(empty, 'B'));
  });

  it('辺セルのメモは双子の両面のシグネチャに現れる', () => {
    const notes = toggleNote(emptyNotes(), 'F', 76, 4);
    const [tf] = twins('F', 76)[0];
    expect(faceNotesSignature(notes, tf)).not.toBe('');
  });
});

describe('faceNoteFillRate', () => {
  it('空セルが 0 の面は 0 を返す (全マス埋まった面)', () => {
    const board = emptyBoard();
    board.faces.F.fill(1);
    const notes = toggleNote(emptyNotes(), 'U', 40, 5); // 他面のメモは影響しない
    expect(faceNoteFillRate(board, notes, 'F')).toBe(0);
  });

  it('その面の空セルのうちメモありセルの割合を返す (双子面に書いたメモも数える)', () => {
    const board = emptyBoard();
    // F 面は 40 と 76 の 2 セルだけ空にする (残り 79 セルは埋める)。
    board.faces.F.fill(1);
    board.faces.F[40] = 0;
    board.faces.F[76] = 0;
    // F76 は辺セル。双子面側の座標でメモしても canonical キー共有で F 面の分子に入る。
    const [tf, ti] = twins('F', 76)[0];
    expect(canonicalCellId('F', 76)).toBe(canonicalCellId(tf, ti));
    const notes = toggleNote(emptyNotes(), tf, ti, 5);
    expect(faceNoteFillRate(board, notes, 'F')).toBe(1 / 2);
  });
});
