// 3D キューブ盤面 (POC の PocApp を本実装化)。
// - 面ごと PlaneMesh 6 枚 + CanvasTexture(1024, anisotropy)
// - ドラッグ回転はターンテーブル式 ({yaw, pitch} の 2 角度のみ、roll は構造的に発生しない)
//   表示 quaternion は q = rotX(pitch) * rotY(yaw) を毎回導出。pitch は ±90° に clamp
// - pointerup で yaw を最寄り 90° 倍数・pitch を {-90,0,+90} へ tween 吸着 →
//   完了時に nearestPoseIndex で 24 姿勢へ確定 (正立テーブル等の既存フローは不変)
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

// カメラを少しオフセットして、スナップ姿勢でも正面 + 上/横の 2〜3 面が見えるようにする。
const CAMERA_POSITION: [number, number, number] = [6, 5, 18];

const DRAG_SPEED = 0.008;
const SNAP_RATE = 12; // 吸着 tween の速度 (1/s)
const SNAP_DONE_RAD = 0.004;
const CLICK_MAX_PX = 6; // pointerdown→up の移動量がこれ以下ならクリック (セル選択) 扱い

const HALF_PI = Math.PI / 2;
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

/** {yaw, pitch} → 表示 quaternion。q = rotX(pitch) * rotY(yaw) (world 軸基準)。 */
function composeYawPitch(out: Quaternion, yaw: number, pitch: number, tmp: Quaternion): Quaternion {
  out.setFromAxisAngle(X_AXIS, pitch);
  tmp.setFromAxisAngle(Y_AXIS, yaw);
  return out.multiply(tmp);
}

/**
 * quaternion → {yaw, pitch} (roll は切り捨て)。
 * setPose 等で外部から roll 付き姿勢が与えられた場合のドラッグ開始時の丸めに使う。
 * pitch はキューブの up ベクトルから、yaw は pitch を除去した残差の forward から取る。
 */
function yawPitchFromQuaternion(q: Quaternion): { yaw: number; pitch: number } {
  const up = new Vector3(0, 1, 0).applyQuaternion(q);
  const pitch = Math.min(HALF_PI, Math.max(-HALF_PI, Math.atan2(up.z, up.y)));
  // 残差 rotX(-pitch) * q ≈ rotY(yaw) (* roll)。roll は (0,0,1) を動かさないので yaw だけ取れる。
  const residual = new Quaternion().setFromAxisAngle(X_AXIS, -pitch).multiply(q);
  const fwd = new Vector3(0, 0, 1).applyQuaternion(residual);
  const yaw = Math.atan2(fwd.x, fwd.z);
  return { yaw, pitch };
}

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
  // 描画に使う「確定済み」姿勢。回転中 (poseIndex = -1) でも直前のスナップ姿勢を保持する。
  const snappedPoseRef = useRef(IDENTITY_POSE_INDEX);
  // ターンテーブル姿勢 {yaw, pitch} (rad)。表示 quaternion はここから毎回導出する。
  const anglesRef = useRef({ yaw: 0, pitch: 0 });
  const snapTargetRef = useRef<{ yaw: number; pitch: number } | null>(null);
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

  // ドラッグ回転 (ターンテーブル式: 横 → yaw、縦 → pitch。roll は発生しない)。
  useEffect(() => {
    const el = gl.domElement;
    let lastX = 0;
    let lastY = 0;
    const tmp = new Quaternion();

    const onDown = (e: PointerEvent) => {
      draggingRef.current = true;
      snapTargetRef.current = null;
      lastX = e.clientX;
      lastY = e.clientY;
      // setPose 等で外部から与えられた姿勢 (roll 含む可能性) を yaw/pitch 表現へ丸めて続行する。
      const group = groupRef.current;
      if (group) anglesRef.current = yawPitchFromQuaternion(group.quaternion);
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
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const a = anglesRef.current;
      a.yaw += dx * DRAG_SPEED;
      a.pitch = Math.min(HALF_PI, Math.max(-HALF_PI, a.pitch + dy * DRAG_SPEED));
      composeYawPitch(group.quaternion, a.yaw, a.pitch, tmp);
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
      const a = anglesRef.current;
      // yaw は最寄りの 90° 倍数、pitch は {-90, 0, +90} の最寄りへ吸着する。
      const targetYaw = Math.round(a.yaw / HALF_PI) * HALF_PI;
      const targetPitch = Math.max(-1, Math.min(1, Math.round(a.pitch / HALF_PI))) * HALF_PI;
      snapTargetRef.current = { yaw: targetYaw, pitch: targetPitch };
      composeYawPitch(tmp, targetYaw, targetPitch, new Quaternion());
      poseIndexRef.current = nearestPoseIndex(tmp);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl]);

  // スナップアニメーション (yaw/pitch を指数 easing で target へ tween)。
  const tweenTmpRef = useRef(new Quaternion());
  useFrame((_, dt) => {
    const group = groupRef.current;
    const target = snapTargetRef.current;
    if (!group || !target || draggingRef.current) return;
    const a = anglesRef.current;
    const k = 1 - Math.exp(-SNAP_RATE * dt);
    a.yaw += (target.yaw - a.yaw) * k;
    a.pitch += (target.pitch - a.pitch) * k;
    if (Math.abs(target.yaw - a.yaw) + Math.abs(target.pitch - a.pitch) < SNAP_DONE_RAD) {
      // yaw を正規化して無限に膨らまないようにする ((-π, π] 相当へ)。
      a.yaw = target.yaw - Math.round(target.yaw / (2 * Math.PI)) * 2 * Math.PI;
      a.pitch = target.pitch;
      snapTargetRef.current = null;
      // スナップ後の quaternion は 24 姿勢のいずれかと一致するはず。正準 POSES 側へ確定
      // させることで、正立テーブル・正面 face 検出の既存フローをそのまま使う。
      group.quaternion.copy(POSES[poseIndexRef.current]);
      snappedPoseRef.current = poseIndexRef.current;
      redraw();
      notifyFront();
      return;
    }
    composeYawPitch(group.quaternion, a.yaw, a.pitch, tweenTmpRef.current);
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
        // yaw/pitch 表現も同期しておく (roll 付き姿勢は次のドラッグ開始時に丸められる)。
        anglesRef.current = yawPitchFromQuaternion(group.quaternion);
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
