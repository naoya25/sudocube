// NumberPad: 1〜9 と消しゴム、候補メモのモードトグルを持つ純粋な presentational コンポーネント。
// レイアウト非依存。P2 で 3D キューブ UI に載せ替えても再利用できる。

export interface NumberPadProps {
  /** 数字ボタンが押されたとき (1..9)。 */
  onInput: (value: number) => void;
  /** 消しゴムが押されたとき。 */
  onErase: () => void;
  /** 入力不可 (未選択・勝利後など)。 */
  disabled?: boolean;
  /** メモモード (候補数字トグル入力) 中か。 */
  noteMode?: boolean;
  /** メモモードのトグルが押されたとき。省略時はトグルボタンを表示しない。 */
  onToggleNoteMode?: () => void;
  /** メモトグル自体の無効化 (勝利後・イントロ中)。数字と別管理 (未選択でも切替可)。 */
  noteToggleDisabled?: boolean;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function NumberPad({
  onInput,
  onErase,
  disabled = false,
  noteMode = false,
  onToggleNoteMode,
  noteToggleDisabled = false,
}: NumberPadProps) {
  return (
    <div className="numberpad" role="group" aria-label="数字パッド">
      {DIGITS.map((n) => (
        <button
          key={n}
          type="button"
          className="pad-key"
          disabled={disabled}
          onClick={() => onInput(n)}
          aria-label={noteMode ? `候補 ${n} をトグル` : `${n} を入力`}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className="pad-key pad-erase"
        disabled={disabled}
        onClick={onErase}
        aria-label={noteMode ? 'メモを全消去' : '消しゴム'}
      >
        <span aria-hidden="true">⌫</span>
      </button>
      {onToggleNoteMode && (
        <button
          type="button"
          className={`pad-key pad-note${noteMode ? ' active' : ''}`}
          disabled={noteToggleDisabled}
          onClick={onToggleNoteMode}
          aria-pressed={noteMode}
          aria-label="メモモード切替"
          title="メモモード (M キー / Shift+数字)"
        >
          <span aria-hidden="true">✎</span> メモ{noteMode ? ' ON' : ''}
        </button>
      )}
    </div>
  );
}
