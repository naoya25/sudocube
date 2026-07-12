import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { FACES, twins } from '../core/geometry';
import { generatePuzzle } from '../core/generator';
import {
  computeUprightTable,
  IDENTITY_POSE_INDEX,
  nearestPoseIndex,
  POSES,
  uprightInfo,
} from './orientation';

const IDENTITY_CAM = new Quaternion();

describe('24 スナップ姿勢', () => {
  it('ちょうど 24 個ある', () => {
    expect(POSES.length).toBe(24);
  });

  it('回転群としてすべて distinct (|dot| < 1 - ε)', () => {
    for (let i = 0; i < POSES.length; i++) {
      for (let j = i + 1; j < POSES.length; j++) {
        // 同一回転なら q と ±q で |dot| = 1。distinct なら 1 から離れる。
        expect(Math.abs(POSES[i].dot(POSES[j]))).toBeLessThan(1 - 1e-6);
      }
    }
  });

  it('恒等姿勢が含まれ、nearestPoseIndex が恒等近傍を恒等に吸着する', () => {
    expect(IDENTITY_POSE_INDEX).toBeGreaterThanOrEqual(0);
    const near = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1);
    expect(nearestPoseIndex(near)).toBe(IDENTITY_POSE_INDEX);
  });
});

describe('正立角テーブル (カメラ = 恒等)', () => {
  const table = computeUprightTable(IDENTITY_CAM);

  it('全 24 姿勢 × 可視面で正立角が {0, 90, 180, 270} に正規化される', () => {
    for (let p = 0; p < POSES.length; p++) {
      for (let f = 0; f < FACES.length; f++) {
        if (!table.visible[p][f]) continue;
        expect([0, 90, 180, 270]).toContain(table.angles[p][f]);
      }
    }
  });

  it('スナップ姿勢では生の角度が 90° 倍数に厳密一致する (スナップが恒等変換)', () => {
    for (let p = 0; p < POSES.length; p++) {
      for (const face of FACES) {
        const info = uprightInfo(POSES[p], IDENTITY_CAM, face);
        if (!info.visible) continue;
        const mod = ((info.rawDeg % 90) + 90) % 90;
        expect(Math.min(mod, 90 - mod)).toBeLessThan(1e-6);
      }
    }
  });

  it('恒等姿勢で正面 (F 面) の正立角が 0°', () => {
    const fIdx = FACES.indexOf('F');
    expect(table.visible[IDENTITY_POSE_INDEX][fIdx]).toBe(true);
    expect(table.angles[IDENTITY_POSE_INDEX][fIdx]).toBe(0);
  });

  it('各スナップ姿勢でちょうど 1 面が正面 (可視) になる', () => {
    for (let p = 0; p < POSES.length; p++) {
      const count = table.visible[p].filter(Boolean).length;
      expect(count).toBe(1);
    }
  });
});

describe('辺マスの双子同期 (core 再確認)', () => {
  it('generatePuzzle(1) の盤面で twins 対応セルの値が両面で一致する', () => {
    const { board, solution } = generatePuzzle(1);
    for (const face of FACES) {
      for (let i = 0; i < 81; i++) {
        for (const [tf, ti] of twins(face, i)) {
          expect(board.faces[tf][ti]).toBe(board.faces[face][i]);
          expect(solution.faces[tf][ti]).toBe(solution.faces[face][i]);
          expect(board.givens[tf][ti]).toBe(board.givens[face][i]);
        }
      }
    }
  });
});
