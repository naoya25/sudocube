// NumberPad: 1〜9 と消しゴムのボタンだけを持つ純粋な presentational コンポーネント。
// レイアウト非依存。P2 で 3D キューブ UI に載せ替えても再利用できる。

export interface NumberPadProps {
  /** 数字ボタンが押されたとき (1..9)。 */
  onInput: (value: number) => void;
  /** 消しゴムが押されたとき。 */
  onErase: () => void;
  /** 入力不可 (未選択・勝利後など)。 */
  disabled?: boolean;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function NumberPad({ onInput, onErase, disabled = false }: NumberPadProps) {
  return (
    <div className="numberpad" role="group" aria-label="数字パッド">
      {DIGITS.map((n) => (
        <button
          key={n}
          type="button"
          className="pad-key"
          disabled={disabled}
          onClick={() => onInput(n)}
          aria-label={`${n} を入力`}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className="pad-key pad-erase"
        disabled={disabled}
        onClick={onErase}
        aria-label="消しゴム"
      >
        <span aria-hidden="true">⌫</span>
      </button>
    </div>
  );
}
