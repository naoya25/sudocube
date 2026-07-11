// 生成した問題を読める形でファイル保存する。
// 実行: npx vite-node scripts/save-sample.ts [seed]
import { mkdirSync, writeFileSync } from 'node:fs';
import { generatePuzzle } from '../src/core/generator';
import { boardToStrings, FACES } from '../src/core/board';

const seed = Number(process.argv[2] ?? 1);
const { board, solution, givenCount } = generatePuzzle(seed);
const pz = boardToStrings(board);
const sol = boardToStrings(solution);

// 9x9 を 3x3 ブロック区切りで整形。空マスは '.'。
function grid(s: string): string {
  let out = '';
  for (let r = 0; r < 9; r++) {
    const cells = s.slice(r * 9, r * 9 + 9).split('').map((c) => (c === '0' ? '.' : c));
    out += '    ' + cells.slice(0, 3).join(' ') + ' | ' + cells.slice(3, 6).join(' ') + ' | ' + cells.slice(6, 9).join(' ') + '\n';
    if (r === 2 || r === 5) out += '    ------+-------+------\n';
  }
  return out;
}

let txt = `Sudocube 生成問題サンプル\n`;
txt += `seed=${seed}  ヒント数=${givenCount}/486 (${((givenCount / 486) * 100).toFixed(1)}%)\n`;
txt += `${'='.repeat(40)}\n\n### 問題 (. = 空マス)\n\n`;
for (const f of FACES) txt += `--- 面 ${f} ---\n${grid(pz[f])}\n`;
txt += `\n${'='.repeat(40)}\n\n### 完成解\n\n`;
for (const f of FACES) txt += `--- 面 ${f} ---\n${grid(sol[f])}\n`;

// JSON でも保存 (面ごと81文字。プログラムから読み込める形)。
const json = {
  seed,
  givenCount,
  puzzle: pz,
  solution: sol,
};

mkdirSync('samples', { recursive: true });
writeFileSync(`samples/puzzle-seed${seed}.txt`, txt);
writeFileSync(`samples/puzzle-seed${seed}.json`, JSON.stringify(json, null, 2));
console.log(`保存した: samples/puzzle-seed${seed}.txt / .json  (ヒント ${givenCount}/486)`);
