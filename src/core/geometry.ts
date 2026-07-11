// 立方体の幾何: GEO 定義から 3D 座標一致で辺・頂点の共有を構築する。
// docs/geometry.md が正本。twins() / peers() を公開し、varId / union-find は内部実装に留める。

export type FaceId = 'U' | 'D' | 'F' | 'B' | 'L' | 'R';

// グローバルセル id の順序を固定する (faceIdx * 81 + i)。
export const FACES: readonly FaceId[] = ['U', 'D', 'F', 'B', 'L', 'R'];

type Vec3 = readonly [number, number, number];
interface FaceGeo {
  origin: Vec3;
  rowDir: Vec3;
  colDir: Vec3;
}

// docs/geometry.md の検証済み GEO 定義。
const GEO: Record<FaceId, FaceGeo> = {
  U: { origin: [0, 0, 8], rowDir: [0, 1, 0], colDir: [1, 0, 0] },
  D: { origin: [0, 0, 0], rowDir: [0, 1, 0], colDir: [1, 0, 0] },
  F: { origin: [0, 0, 0], rowDir: [0, 0, 1], colDir: [1, 0, 0] },
  B: { origin: [0, 8, 0], rowDir: [0, 0, 1], colDir: [1, 0, 0] },
  L: { origin: [0, 0, 0], rowDir: [0, 0, 1], colDir: [0, 1, 0] },
  R: { origin: [8, 0, 0], rowDir: [0, 0, 1], colDir: [0, 1, 0] },
};

export const CELLS_PER_FACE = 81;
export const TOTAL_CELLS = FACES.length * CELLS_PER_FACE; // 486

const FACE_INDEX: Record<FaceId, number> = { U: 0, D: 1, F: 2, B: 3, L: 4, R: 5 };

/** (face, i) -> グローバルセル id (0..485) */
export function cellId(face: FaceId, i: number): number {
  return FACE_INDEX[face] * CELLS_PER_FACE + i;
}

/** グローバルセル id -> (face, i) */
export function cellFace(id: number): [FaceId, number] {
  return [FACES[Math.floor(id / CELLS_PER_FACE)], id % CELLS_PER_FACE];
}

// --- 3D 座標一致による var 構築 ---
// GEO の各ベクトルは整数軸方向、r,c も整数なので座標は厳密な整数になる。
// ゆえに誤差 < 1e-6 の判定は文字列キーの完全一致で安全に行える。
function pointOf(face: FaceId, r: number, c: number): Vec3 {
  const g = GEO[face];
  return [
    g.origin[0] + r * g.rowDir[0] + c * g.colDir[0],
    g.origin[1] + r * g.rowDir[1] + c * g.colDir[1],
    g.origin[2] + r * g.rowDir[2] + c * g.colDir[2],
  ];
}

// 念のため誤差込みで一致を取る union-find (実際には整数なので厳密一致)。
const EPS = 1e-6;
function coordKey(p: Vec3): string {
  // 1e-6 未満を同一視するため 1e6 グリッドに丸める。
  const q = (v: number) => Math.round(v / EPS);
  return `${q(p[0])},${q(p[1])},${q(p[2])}`;
}

// union-find (内部実装)。
const parent = new Int32Array(TOTAL_CELLS);
for (let i = 0; i < TOTAL_CELLS; i++) parent[i] = i;
function find(x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]];
    x = parent[x];
  }
  return x;
}
function union(a: number, b: number): void {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
}

// 座標キー -> 代表セル で同一座標のセルを union。
{
  const byKey = new Map<string, number>();
  for (const face of FACES) {
    for (let i = 0; i < CELLS_PER_FACE; i++) {
      const r = Math.floor(i / 9);
      const c = i % 9;
      const key = coordKey(pointOf(face, r, c));
      const id = cellId(face, i);
      const prev = byKey.get(key);
      if (prev === undefined) byKey.set(key, id);
      else union(prev, id);
    }
  }
}

// 各セルの varId を 0..(varCount-1) に採番。
export const cellVar = new Int16Array(TOTAL_CELLS);
export const varCells: number[][] = [];
{
  const rootToVar = new Map<number, number>();
  for (let id = 0; id < TOTAL_CELLS; id++) {
    const root = find(id);
    let v = rootToVar.get(root);
    if (v === undefined) {
      v = varCells.length;
      rootToVar.set(root, v);
      varCells.push([]);
    }
    cellVar[id] = v;
    varCells[v].push(id);
  }
}
export const varCount = varCells.length; // 386 のはず

// --- twins ---
// あるセルと同じ var (同一 3D 座標) に属する別のセル群。
const twinsByCell: [FaceId, number][][] = [];
for (let id = 0; id < TOTAL_CELLS; id++) {
  const v = cellVar[id];
  const others = varCells[v].filter((o) => o !== id).map((o) => cellFace(o));
  twinsByCell.push(others);
}

/** そのマスにくっついている双子マス (0〜2 個)。 */
export function twins(face: FaceId, i: number): [FaceId, number][] {
  return twinsByCell[cellId(face, i)];
}

// --- peers ---
// 同一面内の row / col / box メンバー (グローバル id) を集める。
function unitMembers(face: FaceId, i: number): number[] {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const out: number[] = [];
  for (let cc = 0; cc < 9; cc++) out.push(cellId(face, r * 9 + cc)); // 行
  for (let rr = 0; rr < 9; rr++) out.push(cellId(face, rr * 9 + c)); // 列
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++)
    for (let dc = 0; dc < 3; dc++) out.push(cellId(face, (br + dr) * 9 + (bc + dc))); // 箱
  return out;
}

// peers を precompute (グローバル id 集合)。自分と双子は除外する。
const peersByCell: [FaceId, number][][] = [];
for (let id = 0; id < TOTAL_CELLS; id++) {
  const v = cellVar[id];
  const exclude = new Set(varCells[v]); // 自分 + 双子
  const set = new Set<number>();
  // 自分と各双子の面について、その面の row/col/box を集める。
  for (const memberId of varCells[v]) {
    const [mf, mi] = cellFace(memberId);
    for (const p of unitMembers(mf, mi)) {
      if (!exclude.has(p)) set.add(p);
    }
  }
  peersByCell.push([...set].map((p) => cellFace(p)));
}

/** そのマスと同じ数字になってはいけない相手すべて。 */
export function peers(face: FaceId, i: number): [FaceId, number][] {
  return peersByCell[cellId(face, i)];
}

// --- 変数レベルの peers (solver 用の内部モデル) ---
// var v の全セルの peer セルが属する var の集合 (自分自身は除く)。
export const varPeers: number[][] = [];
for (let v = 0; v < varCount; v++) {
  const set = new Set<number>();
  for (const id of varCells[v]) {
    for (const [pf, pi] of peersByCell[id]) {
      const pv = cellVar[cellId(pf, pi)];
      if (pv !== v) set.add(pv);
    }
  }
  varPeers.push([...set]);
}
