// 3D UI 検証スパイク (POC)。
// - 面ごと PlaneMesh 6 枚 + CanvasTexture(1024, anisotropy)
// - ドラッグ回転 → pointerup で最寄りの 24 姿勢へ slerp 吸着
// - 吸着完了時に正立角テーブルを引き、必要な面だけグリフを回して再描画
// - window.__poc に検証用フックを生やす

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, Euler, Quaternion, SRGBColorSpace, Vector3, type Group } from 'three';
import { FACES, type FaceId } from '../core/geometry';
import { generatePuzzle } from '../core/generator';
import { drawFace, TEXTURE_SIZE } from './faceTexture';
import {
  computeUprightTable,
  FACE_BASES,
  faceMeshQuaternion,
  IDENTITY_POSE_INDEX,
  nearestPoseIndex,
  POSES,
  type UprightTable,
} from './orientation';

// カメラを少しオフセットして、スナップ姿勢でも正面 + 上/横の 2〜3 面が見えるようにする。
const CAMERA_POSITION: [number, number, number] = [6, 5, 18];

declare global {
  interface Window {
    __poc?: {
      setPose: (i: number) => void;
      getPose: () => number;
      getUprightTable: () => UprightTable | null;
      /** デバッグ用: 任意のオイラー角 (度) の自由姿勢にする (スナップしない)。 */
      setFreePose: (xDeg: number, yDeg: number, zDeg: number) => void;
    };
  }
}

const DRAG_SPEED = 0.008;
const SNAP_RATE = 12; // slerp の吸着速度 (1/s)
const SNAP_DONE_RAD = 0.004;

function CubeScene() {
  const { gl, camera } = useThree();
  const groupRef = useRef<Group>(null);
  const puzzle = useMemo(() => generatePuzzle(1), []);

  // 面ごとの canvas / texture (FACES 順)。
  const canvases = useMemo(
    () =>
      FACES.map(() => {
        const c = document.createElement('canvas');
        c.width = TEXTURE_SIZE;
        c.height = TEXTURE_SIZE;
        return c;
      }),
    [],
  );
  const textures = useMemo(
    () =>
      canvases.map((c) => {
        const t = new CanvasTexture(c);
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = gl.capabilities.getMaxAnisotropy();
        return t;
      }),
    [canvases, gl],
  );
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  // 正立角テーブル: カメラ姿勢が確定してから 1 回だけ precompute。
  const tableRef = useRef<UprightTable | null>(null);
  const lastDrawnDeg = useRef<number[]>(FACES.map(() => Number.NaN));
  const poseIndexRef = useRef(IDENTITY_POSE_INDEX);
  const snapTargetRef = useRef<Quaternion | null>(null);
  const draggingRef = useRef(false);

  const redrawForPose = (poseIndex: number) => {
    const table = tableRef.current;
    if (!table) return;
    FACES.forEach((face: FaceId, fi) => {
      const deg = table.angles[poseIndex][fi];
      // 必要な面だけ再描画: 角度が前回描画から変わった面のみ。
      if (lastDrawnDeg.current[fi] === deg) return;
      const ctx = canvases[fi].getContext('2d');
      if (!ctx) return;
      drawFace(ctx, { face, board: puzzle.board, uprightDeg: deg, label: true });
      textures[fi].needsUpdate = true;
      lastDrawnDeg.current[fi] = deg;
    });
  };

  // 初期化: カメラを原点に向けてからテーブル計算 → 初期姿勢で描画。
  useEffect(() => {
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    tableRef.current = computeUprightTable(camera.quaternion);
    lastDrawnDeg.current = FACES.map(() => Number.NaN);
    const group = groupRef.current;
    if (group) group.quaternion.copy(POSES[IDENTITY_POSE_INDEX]);
    poseIndexRef.current = IDENTITY_POSE_INDEX;
    redrawForPose(IDENTITY_POSE_INDEX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  // ドラッグ回転。
  useEffect(() => {
    const el = gl.domElement;
    let lastX = 0;
    let lastY = 0;
    const camRight = new Vector3();
    const camUp = new Vector3();
    const dq = new Quaternion();

    const onDown = (e: PointerEvent) => {
      draggingRef.current = true;
      snapTargetRef.current = null;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const group = groupRef.current;
      if (!group) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      dq.setFromAxisAngle(camUp, dx * DRAG_SPEED);
      group.quaternion.premultiply(dq);
      dq.setFromAxisAngle(camRight, dy * DRAG_SPEED);
      group.quaternion.premultiply(dq);
      poseIndexRef.current = -1;
    };
    const onUp = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      el.releasePointerCapture(e.pointerId);
      const group = groupRef.current;
      if (!group) return;
      const i = nearestPoseIndex(group.quaternion);
      snapTargetRef.current = POSES[i].clone();
      poseIndexRef.current = i;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera]);

  // スナップアニメーション。
  useFrame((_, dt) => {
    const group = groupRef.current;
    const target = snapTargetRef.current;
    if (!group || !target || draggingRef.current) return;
    // quaternion の符号が逆だと遠回りに slerp するので近い側に揃える。
    if (group.quaternion.dot(target) < 0) {
      target.set(-target.x, -target.y, -target.z, -target.w);
    }
    group.quaternion.slerp(target, 1 - Math.exp(-SNAP_RATE * dt));
    if (group.quaternion.angleTo(target) < SNAP_DONE_RAD) {
      group.quaternion.copy(target);
      snapTargetRef.current = null;
      redrawForPose(poseIndexRef.current);
    }
  });

  // 検証用フック。
  useEffect(() => {
    window.__poc = {
      setPose: (i: number) => {
        const group = groupRef.current;
        if (!group || i < 0 || i >= POSES.length) return;
        snapTargetRef.current = null;
        group.quaternion.copy(POSES[i]);
        poseIndexRef.current = i;
        redrawForPose(i);
      },
      getPose: () => poseIndexRef.current,
      getUprightTable: () => tableRef.current,
      setFreePose: (xDeg: number, yDeg: number, zDeg: number) => {
        const group = groupRef.current;
        if (!group) return;
        snapTargetRef.current = null;
        poseIndexRef.current = -1;
        const toRad = Math.PI / 180;
        group.quaternion.setFromEuler(new Euler(xDeg * toRad, yDeg * toRad, zDeg * toRad, 'XYZ'));
      },
    };
    return () => {
      delete window.__poc;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group ref={groupRef}>
      {FACES.map((face, fi) => (
        <mesh key={face} position={FACE_BASES[face].center} quaternion={faceMeshQuaternion(face)}>
          <planeGeometry args={[8, 8]} />
          <meshBasicMaterial map={textures[fi]} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export default function PocApp() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#23252b', touchAction: 'none' }}>
      <Canvas camera={{ position: CAMERA_POSITION, fov: 40 }} dpr={[1, 2]}>
        <CubeScene />
      </Canvas>
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 10,
          color: '#9aa0ab',
          font: '12px/1.6 system-ui, sans-serif',
          pointerEvents: 'none',
        }}
      >
        3D POC — ドラッグで回転 / 離すと24姿勢スナップ / window.__poc で姿勢操作
      </div>
    </div>
  );
}
