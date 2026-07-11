// FaceGrid: 1 面 9×9 を表示し、セルクリックを親に通知する純粋な presentational コンポーネント。
// レイアウト非依存 (props でデータとコールバックを受ける)。P2 で 3D キューブの正面に
// drei <Html> で載せ替えても、この I/F のまま再利用できるようにしてある。

export interface FaceGridProps {
  /** 現在の 1 面 81 マス (0 = 空、1..9 = 数字)。 */
  values: Uint8Array;
  /** 同じ 1 面の given フラグ (1 = ヒント = 編集不可)。 */
  givens: Uint8Array;
  /** 選択中セルの index (0..80) / 未選択なら null。 */
  selected: number | null;
  /** 誤入力エフェクトを出すセル index / 無ければ null。 */
  wrongCell: number | null;
  /** セルが押されたときのコールバック (index を渡す)。 */
  onSelectCell: (i: number) => void;
  /** 入力不可 (勝利後など)。 */
  disabled?: boolean;
}

export function FaceGrid({
  values,
  givens,
  selected,
  wrongCell,
  onSelectCell,
  disabled = false,
}: FaceGridProps) {
  const selRow = selected === null ? -1 : Math.floor(selected / 9);
  const selCol = selected === null ? -1 : selected % 9;
  const selVal = selected === null ? 0 : values[selected];

  return (
    <div className="facegrid" role="grid" aria-label="数独の面">
      {Array.from({ length: 81 }, (_, i) => {
        const r = Math.floor(i / 9);
        const c = i % 9;
        const v = values[i];
        const given = givens[i] === 1;
        const isSel = selected === i;
        const isWrong = wrongCell === i;
        // 選択中セルと同じ行・列、または同じ数字のマスを淡くハイライト (可読性補助)。
        const peer = !isSel && (r === selRow || c === selCol);
        const sameNum = !isSel && v !== 0 && v === selVal;

        const cls = [
          'cell',
          given ? 'given' : v !== 0 ? 'filled' : 'empty',
          isSel && 'selected',
          peer && 'peer',
          sameNum && 'same-num',
          isWrong && 'wrong',
          c % 3 === 2 && c !== 8 && 'block-r',
          r % 3 === 2 && r !== 8 && 'block-b',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={i}
            type="button"
            className={cls}
            role="gridcell"
            aria-label={`${r + 1}行${c + 1}列 ${v !== 0 ? v : '空'}`}
            aria-selected={isSel}
            disabled={disabled}
            onClick={() => onSelectCell(i)}
          >
            {v !== 0 ? v : ''}
          </button>
        );
      })}
    </div>
  );
}
