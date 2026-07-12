// 3D キューブ盤面 (POC の PocApp を本実装化)。
// - 面ごと PlaneMesh 6 枚 + CanvasTexture(1024, anisotropy)
// - ドラッグ回転 → pointerup で最寄りの 24 姿勢へ slerp 吸着
// - クリック (移動量閾値以下の pointerup) で raycast uv → セル選択
// - ハイライト (選択 / peers / same-number / 誤答) はテクスチャに焼き、
//   状態シグネチャが変わった面だけ再描画する

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, Quaternion, SRGBColorSpace, Vector3, type Group } from 'three';
import { FACES, type FaceId } from '../core/geometry';
import type { Board } from '../core/board';
import { drawFace, TEXTURE_SIZE } from './faceTexture';
import {
  computeFrontFaces,
  computeUprightTable,
  FACE_BASES,
  faceMeshQuaternion,
  IDENTITY_POSE_INDEX,
  nearestPoseIndex,
  POSES,
  type UprightTable,
} from './orientation';
import { highlightFlags, uvToCell, type CellRef } from './selection';

// カメラは真正面 (lookAt 原点で quaternion = 恒等)。スナップ静止時に正面の面が
// 歪みなく完全に正対して見える。側面はドラッグ回転中にのみ見える。
// 注: orientation.ts の正立角テーブルはこの恒等カメラでテスト済み
// (edge-on 面の射影退化は uprightInfo 内の lengthSq ガードで 0° にフォールバック)。
const CAMERA_POSITION: [number, number, number] = [0, 0, 18];

const DRAG_SPEED = 0.008;
const SNAP_RATE = 12; // slerp の吸着速度 (1/s)
const SNAP_DONE_RAD = 0.004;
const CLICK_MAX_PX = 6; // pointerdown→up の移動量がこれ以下ならクリック (セル選択) 扱い
const AXIS_LOCK_PX = 8; // 累積移動量がこれを超えた時点でドラッグ軸 (横/縦) をロックする

declare global {
  interface Window {
    /** 実機検証用フック。 */
    __cube?: {
      setPose: (i: number) => void;
      getPose: () => number;
      getFrontFace: () => FaceId;
      select: (face: FaceId, i: number) => void;
      getCell: (face: FaceId, i: number) => { value: number; given: boolean };
      debug: () => { dragging: boolean; poseIndex: number; snapped: number; hasSnapTarget: boolean };
    };
  }
}

export interface CubeBoardProps {
  board: Board;
  selected: CellRef | null;
  wrongCell: CellRef | null;
  /** board のミュータブル更新を検知するためのバージョン番号 (App の bump カウンタ)。 */
  boardVersion: number;
  onSelectCell: (ref: CellRef) => void;
  /** スナップ確定時に正面 face とその正立角を通知する (矢印移動・HUD 用)。 */
  onFrontFaceChange: (face: FaceId, uprightDeg: number) => void;
}

function CubeScene(props: CubeBoardProps) {
  const { board, selected, wrongCell, boardVersion, onSelectCell, onFrontFaceChange } = props;
  const { gl, camera } = useThree();
  const groupRef = useRef<Group>(null);

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

  // 正立角テーブル・正面 face テーブル: カメラ姿勢確定後に 1 回だけ precompute。
  const tableRef = useRef<UprightTable | null>(null);
  const frontFacesRef = useRef<number[] | null>(null);
  const lastSigRef = useRef<string[]>(FACES.map(() => ''));
  const poseIndexRef = useRef(IDENTITY_POSE_INDEX);
  // 描画に使う「確定済み」姿勢。自由回転中 (poseIndex = -1) でも直前のスナップ姿勢を保持する。
  const snappedPoseRef = useRef(IDENTITY_POSE_INDEX);
  const snapTargetRef = useRef<Quaternion | null>(null);
  const draggingRef = useRef(false);

  // props を ref 経由で参照する (redraw をイベント/フレームから呼ぶため)。
  const stateRef = useRef({ board, selected, wrongCell });
  stateRef.current = { board, selected, wrongCell };

  const redraw = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    const { board, selected, wrongCell } = stateRef.current;
    const pose = snappedPoseRef.current;
    const flags = highlightFlags(board, selected, wrongCell);
    FACES.forEach((face: FaceId, fi) => {
      const deg = table.angles[pose][fi];
      // 変更があった面だけ再描画: 正立角 + 盤面値 + ハイライトのシグネチャで判定。
      const sig = `${deg}|${board.faces[face].join('')}|${flags[face].join('')}`;
      if (lastSigRef.current[fi] === sig) return;
      const ctx = canvases[fi].getContext('2d');
      if (!ctx) return;
      drawFace(ctx, { face, board, uprightDeg: deg, flags: flags[face] });
      textures[fi].needsUpdate = true;
      lastSigRef.current[fi] = sig;
    });
  }, [canvases, textures]);

  const notifyFront = useCallback(() => {
    const table = tableRef.current;
    const fronts = frontFacesRef.current;
    if (!table || !fronts) return;
    const pose = snappedPoseRef.current;
    const fi = fronts[pose];
    onFrontFaceChange(FACES[fi], table.angles[pose][fi]);
  }, [onFrontFaceChange]);

  // 初期化: カメラを原点に向けてからテーブル計算 → 初期姿勢で描画。
  useEffect(() => {
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    tableRef.current = computeUprightTable(camera.quaternion);
    frontFacesRef.current = computeFrontFaces(camera.quaternion);
    lastSigRef.current = FACES.map(() => '');
    const group = groupRef.current;
    if (group) group.quaternion.copy(POSES[snappedPoseRef.current]);
    poseIndexRef.current = snappedPoseRef.current;
    redraw();
    notifyFront();
  }, [camera, redraw, notifyFront]);

  // 盤面・選択・誤答の変化で再描画 (シグネチャ比較で実際に変わった面のみ焼き直す)。
  useEffect(() => {
    redraw();
  }, [boardVersion, selected, wrongCell, redraw]);

  // ドラッグ回転 (軸ロック式)。
  // 累積移動量が AXIS_LOCK_PX を超えた時点で |dx|>|dy| なら横・そうでなければ縦に
  // ロックし、そのドラッグ中はスクリーン単軸 (カメラ up / right) まわりのみ回す。
  useEffect(() => {
    const el = gl.domElement;
    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;
    let axisLock: 'h' | 'v' | null = null;
    const camRight = new Vector3();
    const camUp = new Vector3();
    const dq = new Quaternion();

    const onDown = (e: PointerEvent) => {
      draggingRef.current = true;
      snapTargetRef.current = null;
      lastX = e.clientX;
      lastY = e.clientY;
      startX = e.clientX;
      startY = e.clientY;
      axisLock = null;
      // 合成イベントや既に離れたポインタでは InvalidPointerId を投げるので握りつぶす。
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const group = groupRef.current;
      if (!group) return;
      let dx = e.clientX - lastX;
      let dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (axisLock === null) {
        // 軸未確定: 累積移動量が閾値を超えるまで回転しない (クリック判定とも整合)。
        const tdx = e.clientX - startX;
        const tdy = e.clientY - startY;
        if (Math.max(Math.abs(tdx), Math.abs(tdy)) <= AXIS_LOCK_PX) return;
        axisLock = Math.abs(tdx) > Math.abs(tdy) ? 'h' : 'v';
        // ロック確定フレームは累積分をまとめて適用し、取りこぼしをなくす。
        dx = tdx;
        dy = tdy;
      }
      if (axisLock === 'h') {
        camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        dq.setFromAxisAngle(camUp, dx * DRAG_SPEED);
      } else {
        camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        dq.setFromAxisAngle(camRight, dy * DRAG_SPEED);
      }
      group.quaternion.premultiply(dq);
      poseIndexRef.current = -1;
    };
    const onUp = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
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
      snappedPoseRef.current = poseIndexRef.current;
      redraw();
      notifyFront();
    }
  });

  // クリック選択: R3F の click は pointerdown→up の移動距離 (delta) を持つので閾値で
  // ドラッグ回転と区別する。raycast は material.side = FrontSide なので表向きの面のみ当たる。
  const handleClick = useCallback(
    (face: FaceId) => (e: ThreeEvent<MouseEvent>) => {
      if (e.delta > CLICK_MAX_PX || !e.uv) return;
      e.stopPropagation(); // 最前面の交点のみ採用
      onSelectCell({ face, i: uvToCell(face, e.uv.x, e.uv.y) });
    },
    [onSelectCell],
  );

  // 実機検証用フック。
  useEffect(() => {
    window.__cube = {
      setPose: (i: number) => {
        const group = groupRef.current;
        if (!group || i < 0 || i >= POSES.length) return;
        snapTargetRef.current = null;
        group.quaternion.copy(POSES[i]);
        poseIndexRef.current = i;
        snappedPoseRef.current = i;
        redraw();
        notifyFront();
      },
      getPose: () => poseIndexRef.current,
      getFrontFace: () => FACES[frontFacesRef.current?.[snappedPoseRef.current] ?? 2],
      select: (face: FaceId, i: number) => onSelectCell({ face, i }),
      getCell: (face: FaceId, i: number) => ({
        value: stateRef.current.board.faces[face][i],
        given: stateRef.current.board.givens[face][i] === 1,
      }),
      debug: () => ({
        dragging: draggingRef.current,
        poseIndex: poseIndexRef.current,
        snapped: snappedPoseRef.current,
        hasSnapTarget: snapTargetRef.current !== null,
      }),
    };
    return () => {
      delete window.__cube;
    };
  }, [redraw, notifyFront, onSelectCell]);

  return (
    <group ref={groupRef}>
      {FACES.map((face, fi) => (
        <mesh
          key={face}
          position={FACE_BASES[face].center}
          quaternion={faceMeshQuaternion(face)}
          onClick={handleClick(face)}
        >
          <planeGeometry args={[8, 8]} />
          <meshBasicMaterial map={textures[fi]} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function CubeBoard(props: CubeBoardProps) {
  return (
    <Canvas camera={{ position: CAMERA_POSITION, fov: 40 }} dpr={[1, 2]}>
      <CubeScene {...props} />
    </Canvas>
  );
}
