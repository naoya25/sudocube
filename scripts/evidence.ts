// 生成ロジックの証拠収集: ヒント数分布 + 6面ダンプ。
// 実行: npx vite-node scripts/evidence.ts
import { performance } from 'node:perf_hooks';
import { generatePuzzle } from '../src/core/generator';
import { boardToStrings, FACES } from '../src/core/board';
import { countSolutions } from '../src/core/solver';

function dumpFace(s: string): string {
  let out = '';
  for (let r = 0; r < 9; r++) {
    out += '  ' + s.slice(r * 9, r * 9 + 9).split('').join(' ') + '\n';
  }
  return out;
}

const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const counts: number[] = [];
console.log('=== ヒント数分布 (givens / 486) ===');
for (const seed of seeds) {
  const t0 = performance.now();
  const { board, givenCount } = generatePuzzle(seed);
  const ms = (performance.now() - t0).toFixed(0);
  const unique = countSolutions(board, 2);
  counts.push(givenCount);
  console.log(`seed=${seed}\tgivens=${givenCount}/486\tunique=${unique === 1 ? 'YES' : 'NO(' + unique + ')'}\t${ms}ms`);
}
const min = Math.min(...counts);
const max = Math.max(...counts);
const avg = (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1);
console.log(`\nmin=${min}  max=${max}  avg=${avg}  (n=${counts.length})`);

console.log('\n=== 生成問題の6面ダンプ (seed=1) ===');
const { board, solution } = generatePuzzle(1);
const pz = boardToStrings(board);
const sol = boardToStrings(solution);
for (const f of FACES) {
  console.log(`--- 面 ${f} (問題) ---`);
  process.stdout.write(dumpFace(pz[f]));
}
console.log('\n=== 対応する完成盤面 (seed=1) ===');
for (const f of FACES) {
  console.log(`--- 面 ${f} (解) ---`);
  process.stdout.write(dumpFace(sol[f]));
}
