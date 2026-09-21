/**
 * The shared per-model image-input declaration, used by both adapter-owned
 * catalog editors. The checkbox writes an explicit modality list into the
 * adapter's own field (`input` for the pi-ai family, `inputModalities` for the
 * direct DeepSeek adapter); nothing infers capability from model identity. A
 * row whose endpoint-reported capacities were adopted arrives pre-checked; an
 * undeclared row reads unchecked, which the adapters treat as text-only.
 */
import type { ReactNode } from 'react'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Whether one model explicitly declares image input in the adapter-owned field. */
export function imageInputEnabled(model: DeepSeekModelDraft, field: string): boolean {
  const modalities = model[field]
  return Array.isArray(modalities) && modalities.includes('image')
}

/** The explicit modality list written by the binary image-input control. */
export function imageInputModalities(enabled: boolean): string[] {
  return enabled ? ['text', 'image'] : ['text']
}

/** Props of {@link ModelImageInputToggle}. */
export interface ModelImageInputToggleProps {
  /** The row as currently drafted. */
  model: DeepSeekModelDraft
  /** Adapter-owned modality field this control reads and its editor writes. */
  field: string
  /** Row position, used only for the accessible name. */
  index: number
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable the control (read-only deployment or a pending write). */
  disabled: boolean
  /** Row-inline form: short title, hover tooltip instead of the hint line. */
  compact: boolean
  /** Store the explicit modality list for the new checked state. */
  onChange: (enabled: boolean) => void
}

/**
 * Render the shared per-model image-input declaration control.
 * @param props - row draft, adapter field, and copy seats.
 * @returns the checkbox label.
 */
export function ModelImageInputToggle(props: ModelImageInputToggleProps): ReactNode {
  return (
    <label
      className={props.compact
        ? `${styles['modalityToggle']} ${styles['modalityToggleCompact']}`
        : styles['modalityToggle']}
      aria-disabled={props.disabled}
      data-tooltip={props.compact ? `${props.t('modelImageInput')}: ${props.t('modelImageInputHint')}` : undefined}
    >
      <input
        type="checkbox"
        checked={imageInputEnabled(props.model, props.field)}
        aria-label={`${props.t('modelImageInput')} ${String(props.index + 1)}`}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.checked)
        }}
      />
      <span className={styles['modalityCopy']}>
        <span className={styles['modalityTitle']}>
          {props.t(props.compact ? 'modelImageInputShort' : 'modelImageInput')}
        </span>
        {props.compact ? null : (
          <span className={styles['modalityHint']}>{props.t('modelImageInputHint')}</span>
        )}
      </span>
    </label>
  )
}
