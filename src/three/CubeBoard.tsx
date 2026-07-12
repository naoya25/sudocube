// 3D キューブ盤面 (POC の PocApp を本実装化)。
// - 面ごと PlaneMesh 6 枚 + CanvasTexture(1024, anisotropy)
// - ドラッグ回転 → pointerup で最寄りの 24 姿勢へ slerp 吸着
//   (強フリック時はロック軸のまま慣性回転 → 減速後に進行方向の最寄り姿勢へ吸着)
// - クリック (移動量閾値以下の pointerup) で raycast uv → セル選択
// - ハイライト (選択 / peers / same-number / 誤答) はテクスチャに焼き、
//   状態シグネチャが変わった面だけ再描画する

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, Quaternion, SRGBColorSpace, Vector3, type Group } from 'three';
import { FACES, type FaceId } from '../core/geometry';
import type { Board } from '../core/board';
import { faceNotes, faceNotesSignature, notesAt, type NotesMap } from '../core/notes';
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

// --- フリック慣性回転のパラメータ (調整はここ) ---
const FLICK_WINDOW_MS = 80; // リリース時の角速度推定に使う直近移動サンプルの窓
const FLICK_MIN_RAD_S = 2.5; // この角速度以上でリリースしたら慣性フェーズへ (未満は即スナップ)
const INERTIA_FRICTION = 1.3; // 指数減衰率 (1/s)。ω *= exp(-friction*dt)。小さいほど長く回る
const INERTIA_STOP_RAD_S = 1.2; // 角速度がこれを割ったら慣性を終えてスナップへ遷移
const MAX_SPIN_RAD_S = Math.PI * 6; // 角速度上限 (~3回転/s)。合成イベント等の暴走防止
const SNAP_AHEAD_RAD = Math.PI / 4; // スナップ先選定時に進行方向へ先読みする角度 (通過直後へ戻さない)

// --- イントロ回転演出のパラメータ (調整はここ) ---
// ゲーム開始時にキューブを斜めの姿勢から大きくタンブル回転させ、
// ease-out で減速しながら正面姿勢 (pose 0) に着地させる。
// 残り回転角 = 総回転角 × (1 - easeOutCubic(p)) で計算するため、端数 (OFFSET) が
// そのまま開始時の「斜め」姿勢になり、終端 (p=1) では厳密に恒等 = 正面になる。
const INTRO_DURATION_MS = 1800; // 演出の長さ
const INTRO_YAW_RAD = Math.PI * 4 + 0.55; // yaw 総回転量 (720° + 斜めオフセット)
const INTRO_PITCH_RAD = Math.PI * 2 + 0.42; // pitch 総回転量 (360° + 斜めオフセット)

/** ease-out cubic。回り始めが速く、着地に向けて滑らかに減速する。 */
function easeOutCubic(p: number): number {
  const q = 1 - p;
  return 1 - q * q * q;
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
      getNotes: (face: FaceId, i: number) => number[];
      debug: () => {
        dragging: boolean;
        poseIndex: number;
        snapped: number;
        hasSnapTarget: boolean;
        inertia: { omega: number; traveledRad: number } | null;
        intro: { elapsedMs: number; progress: number; remainingYawRad: number } | null;
      };
    };
  }
}

export interface CubeBoardProps {
  board: Board;
  selected: CellRef | null;
  wrongCell: CellRef | null;
  /** 候補メモ (canonical cellId → 候補集合)。immutable 更新なので参照変化 = 内容変化。 */
  notes: NotesMap;
  /** メモモード中か (選択枠を破線で描く)。 */
  noteMode: boolean;
  /** board のミュータブル更新を検知するためのバージョン番号 (App の bump カウンタ)。 */
  boardVersion: number;
  onSelectCell: (ref: CellRef) => void;
  /** スナップ確定時に正面 face とその正立角を通知する (矢印移動・HUD 用)。 */
  onFrontFaceChange: (face: FaceId, uprightDeg: number) => void;
  /** ゲーム開始ごとに増えるカウンタ。変化するたびイントロ回転演出を再生する (0 は再生しない)。 */
  introNonce: number;
  /** イントロ演出の開始/終了 (完了・中断・reduced-motion スキップ) を通知する。 */
  onIntroStateChange: (active: boolean) => void;
}

function CubeScene(props: CubeBoardProps) {
  const {
    board,
    selected,
    wrongCell,
    notes,
    noteMode,
    boardVersion,
    onSelectCell,
    onFrontFaceChange,
    introNonce,
    onIntroStateChange,
  } = props;
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
  // フリック慣性の状態。axis はロック軸のワールドベクトル、omega は符号付き角速度 (rad/s)。
  const inertiaRef = useRef<{ axis: Vector3; omega: number; traveledRad: number } | null>(null);
  // 慣性中の pointerdown は「回転を掴んで止める」操作なので、直後の click をセル選択にしない。
  const suppressClickRef = useRef(false);
  const spinDqRef = useRef(new Quaternion());
  const aheadQRef = useRef(new Quaternion());
  // イントロ回転演出の状態。null なら演出なし。
  const introRef = useRef<{ elapsedMs: number } | null>(null);
  const introYawQRef = useRef(new Quaternion());
  const introPitchQRef = useRef(new Quaternion());
  const introAxisYRef = useRef(new Vector3(0, 1, 0));
  const introAxisXRef = useRef(new Vector3(1, 0, 0));
  // ドラッグイベントリスナ (deps: gl/camera) から最新のコールバックを呼ぶための ref。
  const onIntroStateChangeRef = useRef(onIntroStateChange);
  onIntroStateChangeRef.current = onIntroStateChange;

  // props を ref 経由で参照する (redraw をイベント/フレームから呼ぶため)。
  const stateRef = useRef({ board, selected, wrongCell, notes, noteMode });
  stateRef.current = { board, selected, wrongCell, notes, noteMode };

  const redraw = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    const { board, selected, wrongCell, notes, noteMode } = stateRef.current;
    const pose = snappedPoseRef.current;
    const flags = highlightFlags(board, selected, wrongCell);
    // same-number 強調中の数字 (selection.ts の FLAG_SAME と同じ発動条件: 値セル選択時のみ)。
    const sameDigit = selected ? board.faces[selected.face][selected.i] : 0;
    FACES.forEach((face: FaceId, fi) => {
      const deg = table.angles[pose][fi];
      // 変更があった面だけ再描画: 正立角 + 盤面値 + ハイライト + メモ + メモモード +
      // メモ強調数字のシグネチャで判定。
      // noteMode を全面のシグネチャに含めるためモード切替時は 6 面焼き直しになるが、
      // 切替はユーザー操作 (低頻度) なので単純さを優先する。
      const noteSig = faceNotesSignature(notes, face);
      const fNotes = faceNotes(notes, face);
      // メモ強調はこの面に sameDigit を含む可視メモ (空セル) があるときだけ見た目が変わるので、
      // その場合のみ数字をシグネチャに乗せる (全面戻し忘れ・過剰再描画のどちらも避ける)。
      const noteHl =
        sameDigit > 0 &&
        fNotes.some((set, i) => set?.has(sameDigit) === true && board.faces[face][i] === 0)
          ? sameDigit
          : 0;
      const sig = `${deg}|${board.faces[face].join('')}|${flags[face].join('')}|${noteSig}|${noteMode ? 1 : 0}|${noteHl}`;
      if (lastSigRef.current[fi] === sig) return;
      const ctx = canvases[fi].getContext('2d');
      if (!ctx) return;
      drawFace(ctx, {
        face,
        board,
        uprightDeg: deg,
        flags: flags[face],
        notes: fNotes,
        noteMode,
        sameDigit,
      });
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

  // 盤面・選択・誤答・メモの変化で再描画 (シグネチャ比較で実際に変わった面のみ焼き直す)。
  useEffect(() => {
    redraw();
  }, [boardVersion, selected, wrongCell, notes, noteMode, redraw]);

  // イントロ回転演出: introNonce が増えるたび再生する (初回開始・「新しいゲーム」共通)。
  // テクスチャは正面姿勢 (pose 0) の正立角のまま回すので、回転中も 6 面の数字が
  // 描かれたまま流れて見える (= キューブだと分かる演出)。
  useEffect(() => {
    if (introNonce <= 0) return;
    const group = groupRef.current;
    // 着地先 = 正面姿勢 (pose 0)。再スタート時に別姿勢でも必ず正面へ戻す。
    snappedPoseRef.current = IDENTITY_POSE_INDEX;
    snapTargetRef.current = null;
    inertiaRef.current = null;
    redraw();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // reduce 指定時は演出を省略して最初から正面静止。
      introRef.current = null;
      if (group) group.quaternion.copy(POSES[IDENTITY_POSE_INDEX]);
      poseIndexRef.current = IDENTITY_POSE_INDEX;
      notifyFront();
      onIntroStateChange(false);
      return;
    }
    introRef.current = { elapsedMs: 0 };
    poseIndexRef.current = -1; // 自由回転中扱い
    notifyFront();
    onIntroStateChange(true);
  }, [introNonce, redraw, notifyFront, onIntroStateChange]);

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
    // 直近の移動サンプル (適用した回転角と時刻)。リリース時の角速度推定に使う。
    let samples: { t: number; rad: number }[] = [];
    const camRight = new Vector3();
    const camUp = new Vector3();
    const dq = new Quaternion();

    const onDown = (e: PointerEvent) => {
      // 慣性中・イントロ中に掴んだら即停止して通常ドラッグへ引き継ぐ。
      // その pointerup 由来の click はセル選択にしない (誤発火防止)。
      suppressClickRef.current = inertiaRef.current !== null || introRef.current !== null;
      if (introRef.current !== null) {
        introRef.current = null;
        onIntroStateChangeRef.current(false);
      }
      inertiaRef.current = null;
      draggingRef.current = true;
      snapTargetRef.current = null;
      samples = [];
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
      const rad = (axisLock === 'h' ? dx : dy) * DRAG_SPEED;
      if (axisLock === 'h') {
        camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        dq.setFromAxisAngle(camUp, rad);
      } else {
        camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        dq.setFromAxisAngle(camRight, rad);
      }
      group.quaternion.premultiply(dq);
      poseIndexRef.current = -1;
      samples.push({ t: performance.now(), rad });
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
      // リリース時の角速度推定: 直近 FLICK_WINDOW_MS の移動サンプルの平均
      // (最後の1フレームだけだとノイズるので短い窓で均す)。
      const now = performance.now();
      const recent = samples.filter((s) => now - s.t <= FLICK_WINDOW_MS);
      let omega = 0;
      if (axisLock !== null && recent.length > 0) {
        const spanMs = Math.max(now - recent[0].t, 1);
        const totalRad = recent.reduce((acc, s) => acc + s.rad, 0);
        omega = (totalRad / spanMs) * 1000;
      }
      omega = Math.max(-MAX_SPIN_RAD_S, Math.min(MAX_SPIN_RAD_S, omega));
      if (axisLock !== null && Math.abs(omega) >= FLICK_MIN_RAD_S) {
        // 慣性フェーズへ: ロック軸のまま角速度で回し続ける (useFrame 側で減衰)。
        const axis = new Vector3();
        if (axisLock === 'h') axis.set(0, 1, 0).applyQuaternion(camera.quaternion);
        else axis.set(1, 0, 0).applyQuaternion(camera.quaternion);
        inertiaRef.current = { axis, omega, traveledRad: 0 };
        snapTargetRef.current = null;
        return;
      }
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

  // イントロ演出 + 慣性回転 + スナップアニメーション。
  useFrame((_, dt) => {
    const group = groupRef.current;
    if (!group || draggingRef.current) return;
    // イントロフェーズ: 残り回転角 = 総回転角 × (1 - easeOutCubic(p))。
    // p=1 で残り 0 = 恒等 (pose 0) に厳密着地するので継ぎ目のスナップが不要。
    const intro = introRef.current;
    if (intro) {
      intro.elapsedMs += dt * 1000;
      const p = Math.min(intro.elapsedMs / INTRO_DURATION_MS, 1);
      const remain = 1 - easeOutCubic(p);
      introYawQRef.current.setFromAxisAngle(introAxisYRef.current, INTRO_YAW_RAD * remain);
      introPitchQRef.current.setFromAxisAngle(introAxisXRef.current, INTRO_PITCH_RAD * remain);
      // world 軸で yaw → pitch の順に合成 (タンブル感)。
      group.quaternion.copy(introYawQRef.current).premultiply(introPitchQRef.current);
      if (p >= 1) {
        group.quaternion.copy(POSES[IDENTITY_POSE_INDEX]);
        introRef.current = null;
        poseIndexRef.current = IDENTITY_POSE_INDEX;
        snappedPoseRef.current = IDENTITY_POSE_INDEX;
        redraw();
        notifyFront();
        onIntroStateChangeRef.current(false);
      }
      return;
    }
    // 慣性フェーズ: ロック軸まわりに角速度で回転継続、指数減衰。
    const inertia = inertiaRef.current;
    if (inertia) {
      const step = inertia.omega * dt;
      spinDqRef.current.setFromAxisAngle(inertia.axis, step);
      group.quaternion.premultiply(spinDqRef.current);
      inertia.traveledRad += Math.abs(step);
      inertia.omega *= Math.exp(-INERTIA_FRICTION * dt);
      if (Math.abs(inertia.omega) < INERTIA_STOP_RAD_S) {
        // 進行方向へ SNAP_AHEAD_RAD 先読みした姿勢の最寄りを選ぶことで、
        // 通り過ぎた直後の姿勢へ巻き戻る「カクッ」を防ぐ。
        spinDqRef.current.setFromAxisAngle(inertia.axis, Math.sign(inertia.omega) * SNAP_AHEAD_RAD);
        aheadQRef.current.copy(group.quaternion).premultiply(spinDqRef.current);
        const i = nearestPoseIndex(aheadQRef.current);
        snapTargetRef.current = POSES[i].clone();
        poseIndexRef.current = i;
        inertiaRef.current = null;
      }
      return;
    }
    const target = snapTargetRef.current;
    if (!target) return;
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
      // 慣性を掴んで止めたタップはセル選択として扱わない (誤発火防止)。
      if (suppressClickRef.current) return;
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
        inertiaRef.current = null;
        if (introRef.current !== null) {
          introRef.current = null;
          onIntroStateChangeRef.current(false);
        }
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
      getNotes: (face: FaceId, i: number) =>
        [...(notesAt(stateRef.current.notes, face, i) ?? [])].sort((a, b) => a - b),
      debug: () => {
        const intro = introRef.current;
        return {
          dragging: draggingRef.current,
          poseIndex: poseIndexRef.current,
          snapped: snappedPoseRef.current,
          hasSnapTarget: snapTargetRef.current !== null,
          inertia: inertiaRef.current
            ? { omega: inertiaRef.current.omega, traveledRad: inertiaRef.current.traveledRad }
            : null,
          intro: intro
            ? {
                elapsedMs: intro.elapsedMs,
                progress: Math.min(intro.elapsedMs / INTRO_DURATION_MS, 1),
                remainingYawRad:
                  INTRO_YAW_RAD * (1 - easeOutCubic(Math.min(intro.elapsedMs / INTRO_DURATION_MS, 1))),
              }
            : null,
        };
      },
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
