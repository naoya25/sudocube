// 3D 表示の姿勢まわりの純粋ロジック (React 非依存)。
// - core 座標系 (0..8 格子) → three ワールド座標系の変換
// - 面ごとのテクスチャ基底 (texRight / texDown / normal)
// - 24 スナップ姿勢 (6 面 × 面内 4 roll) の quaternion 群
// - 「姿勢 × 面 → グリフ正立角」テーブルの precompute
//
// 正立角の定義: カメラ空間で画面上方向 (0,1,0) を面内へ射影した d について
// θ = atan2(dot(d, r_c), dot(d, u_c)) を 90° 単位にスナップしたもの。
// テクスチャ描画時にグリフをセル中心で θ だけ回すと画面に対して正立する。

import { Matrix4, Quaternion, Vector3 } from 'three';
import { FACES, facePoint, type FaceId } from '../core/geometry';

/** キューブの半サイズ (ワールド単位)。core の 0..8 格子が [-HALF, +HALF] に写る。 */
export const CUBE_HALF = 4;

/** core 格子座標 (0..8, x右/y奥/z上) → three ワールド座標 (x右/y上/z手前)。 */
export function coreToWorld(p: readonly [number, number, number]): Vector3 {
  return new Vector3(p[0] - CUBE_HALF, p[2] - CUBE_HALF, CUBE_HALF - p[1]);
}

export interface FaceBasis {
  /** 面中心 (ワールド、キューブ姿勢 = 恒等のとき)。 */
  center: Vector3;
  /** 外向き法線。 */
  normal: Vector3;
  /** テクスチャ +x (canvas 右) に対応するワールド方向。 */
  texRight: Vector3;
  /** テクスチャ +y (canvas 下) に対応するワールド方向。 */
  texDown: Vector3;
  /** グリフの素の上方向 = -texDown。 */
  up: Vector3;
}

function basis(normal: [number, number, number], texRight: [number, number, number], texDown: [number, number, number]): FaceBasis {
  const n = new Vector3(...normal);
  const r = new Vector3(...texRight);
  const d = new Vector3(...texDown);
  // 右手系チェック: texRight × up = normal でなければ定義ミス。
  const check = r.clone().cross(d.clone().negate());
  if (check.distanceTo(n) > 1e-9) throw new Error('face basis is not right-handed');
  return { center: n.clone().multiplyScalar(CUBE_HALF), normal: n, texRight: r, texDown: d, up: d.clone().negate() };
}

/** FACES 順 (U,D,F,B,L,R) の面基底。 */
export const FACE_BASES: Record<FaceId, FaceBasis> = {
  U: basis([0, 1, 0], [1, 0, 0], [0, 0, 1]),
  D: basis([0, -1, 0], [1, 0, 0], [0, 0, -1]),
  F: basis([0, 0, 1], [1, 0, 0], [0, -1, 0]),
  B: basis([0, 0, -1], [-1, 0, 0], [0, -1, 0]),
  L: basis([-1, 0, 0], [0, 0, 1], [0, -1, 0]),
  R: basis([1, 0, 0], [0, 0, -1], [0, -1, 0]),
};

/** PlaneGeometry (ローカル +x/+y/+z) を面基底 (texRight / up / normal) に合わせる姿勢。 */
export function faceMeshQuaternion(face: FaceId): Quaternion {
  const b = FACE_BASES[face];
  const m = new Matrix4().makeBasis(b.texRight, b.up, b.normal);
  return new Quaternion().setFromRotationMatrix(m);
}

/**
 * セル (r, c) のテクスチャ座標 (0..1)。
 * core の格子点をワールドへ写し、面基底へ射影して canvas 位置に対応させる。
 * 面テクスチャは 9×9 グリッドを面内に収める (辺セルは両面に重複して描かれる)。
 */
export function cellUV(face: FaceId, r: number, c: number): { x: number; y: number } {
  const b = FACE_BASES[face];
  const p = coreToWorld(facePoint(face, r, c)).sub(b.center);
  // 格子座標 0..8 を取り出し、セル 9 個のグリッドの中心位置 (t+0.5)/9 に写す。
  const tx = p.dot(b.texRight) + CUBE_HALF;
  const ty = p.dot(b.texDown) + CUBE_HALF;
  return { x: (tx + 0.5) / 9, y: (ty + 0.5) / 9 };
}

// --- 24 スナップ姿勢 ---

const AXIS_DIRS: readonly Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

function buildPoses(): Quaternion[] {
  const poses: Quaternion[] = [];
  for (const x of AXIS_DIRS) {
    for (const y of AXIS_DIRS) {
      if (Math.abs(x.dot(y)) > 1e-9) continue;
      const z = x.clone().cross(y); // det = +1 になる右手系のみ生成される
      const m = new Matrix4().makeBasis(x, y, z);
      poses.push(new Quaternion().setFromRotationMatrix(m));
    }
  }
  return poses;
}

/** 回転群としての 24 スナップ姿勢 (順序は決定的)。 */
export const POSES: readonly Quaternion[] = buildPoses();

/** 恒等姿勢の index。 */
export const IDENTITY_POSE_INDEX = POSES.findIndex((q) => Math.abs(q.dot(new Quaternion())) > 1 - 1e-9);

/** q に最も近いスナップ姿勢の index (quaternion 内積の絶対値が最大)。 */
export function nearestPoseIndex(q: Quaternion): number {
  let best = 0;
  let bestDot = -1;
  for (let i = 0; i < POSES.length; i++) {
    const d = Math.abs(q.dot(POSES[i]));
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

// --- 正立角 ---

export interface UprightInfo {
  /** スナップ前の生の角度 (度)。面がほぼ真横 or 射影が退化した場合は 0。 */
  rawDeg: number;
  /** 90° スナップ後 {0, 90, 180, 270}。 */
  deg: number;
  /** カメラから見て表を向いているか (n_c.z > 0.05)。 */
  visible: boolean;
}

const SCREEN_UP = new Vector3(0, 1, 0);

/**
 * 姿勢 pose・カメラ姿勢 cameraQuat のときの face のグリフ正立角。
 * カメラ空間で計算する (カメラは -z を向く three の慣習)。
 */
export function uprightInfo(pose: Quaternion, cameraQuat: Quaternion, face: FaceId): UprightInfo {
  const b = FACE_BASES[face];
  const camInv = cameraQuat.clone().invert();
  const toCam = (v: Vector3) => v.clone().applyQuaternion(pose).applyQuaternion(camInv);
  const n = toCam(b.normal);
  const r = toCam(b.texRight);
  const u = toCam(b.up);
  const visible = n.z > 0.05;
  const d = SCREEN_UP.clone().sub(n.clone().multiplyScalar(SCREEN_UP.dot(n)));
  if (d.lengthSq() < 1e-9) return { rawDeg: 0, deg: 0, visible };
  const rawDeg = (Math.atan2(d.dot(r), d.dot(u)) * 180) / Math.PI;
  return { rawDeg, deg: snapTo90(rawDeg), visible };
}

/** 角度 (度) を最寄りの 90° 倍数へスナップし {0,90,180,270} に正規化。 */
export function snapTo90(deg: number): number {
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

export interface UprightTable {
  /** [poseIndex][faceIndex] (FACES 順) のスナップ済み正立角 (度)。 */
  angles: number[][];
  /** [poseIndex][faceIndex] の可視フラグ。 */
  visible: boolean[][];
}

/** 24 姿勢 × 6 面の正立角テーブルを precompute する。 */
export function computeUprightTable(cameraQuat: Quaternion): UprightTable {
  const angles: number[][] = [];
  const visible: boolean[][] = [];
  for (const pose of POSES) {
    const row: number[] = [];
    const vis: boolean[] = [];
    for (const face of FACES) {
      const info = uprightInfo(pose, cameraQuat, face);
      row.push(info.deg);
      vis.push(info.visible);
    }
    angles.push(row);
    visible.push(vis);
  }
  return { angles, visible };
}
