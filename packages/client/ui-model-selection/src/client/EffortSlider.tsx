/**
 * EffortSlider: the Codex-style animated reasoning-effort control. One stop
 * per offered level; the knob and the filled track glide between stops while
 * dots light up through the current index. Pointer (click or drag) and
 * keyboard (arrows, Home, End) commit the stop they land on; an unset
 * selection (provider default) renders a hollow knob at the first stop.
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import clsx from 'clsx'
import css from './ModelSelect.module.css'

/** One offered reasoning level, in adapter-preferred order. */
export interface EffortLevel {
  readonly id: string
  readonly name: string
}

/** Props of {@link EffortSlider}. */
export interface EffortSliderProps {
  /** Offered levels, left to right. */
  readonly levels: readonly EffortLevel[]
  /** Index of the selected level, or -1 while the provider default applies. */
  readonly currentIndex: number
  /** Accessible name of the slider, naming the current level. */
  readonly ariaLabel: string
  /** Accessible name of the unset (provider default) position. */
  readonly unsetLabel: string
  /** Whether commits are refused while a selection is in flight. */
  readonly disabled: boolean
  /** Commit one stop by index. */
  readonly onSelect: (index: number) => void
}

/** Stop positions live inside a 10px inset so the knob never overhangs. */
const TRACK_INSET_PX = 10

/**
 * Render the animated effort slider.
 * @param props - levels, current stop, accessible names, and the commit verb.
 * @returns the track with dots, fill, and knob.
 */
export function EffortSlider({ levels, currentIndex, ariaLabel, unsetLabel, disabled, onSelect }: EffortSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const currentRef = useRef(currentIndex)
  currentRef.current = currentIndex
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const dragListeners = useRef<{ move: (event: globalThis.PointerEvent) => void; up: () => void } | null>(null)
  const last = levels.length - 1
  const placed = currentIndex < 0 ? 0 : currentIndex

  const positionAt = (index: number) => {
    const fraction = last <= 0 ? 0 : index / last
    return `calc(${TRACK_INSET_PX}px + ${fraction} * (100% - ${2 * TRACK_INSET_PX}px))`
  }

  const indexAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (rect === undefined || rect.width <= 2 * TRACK_INSET_PX) return currentRef.current < 0 ? 0 : currentRef.current
    const ratio = (clientX - rect.left - TRACK_INSET_PX) / (rect.width - 2 * TRACK_INSET_PX)
    return Math.min(last, Math.max(0, Math.round(ratio * last)))
  }

  const commit = (index: number): void => {
    if (index === currentRef.current) return
    selectRef.current(index)
  }

  const stopDrag = (): void => {
    const listeners = dragListeners.current
    if (listeners === null) return
    dragListeners.current = null
    window.removeEventListener('pointermove', listeners.move)
    window.removeEventListener('pointerup', listeners.up)
  }

  // A drag outlives renders; unmount must not leak its window listeners.
  useEffect(() => stopDrag, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    stopDrag()
    const move = (moveEvent: globalThis.PointerEvent): void => { commit(indexAt(moveEvent.clientX)) }
    const up = (): void => { stopDrag() }
    dragListeners.current = { move, up }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    commit(indexAt(event.clientX))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const step: Record<string, number | 'home' | 'end'> = {
      ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, Home: 'home', End: 'end',
    }
    const move = step[event.key]
    if (move === undefined) return
    event.preventDefault()
    event.stopPropagation()
    commit(move === 'home' ? 0 : move === 'end' ? last : Math.min(last, Math.max(0, placed + move)))
  }

  return (
    <div
      ref={trackRef}
      className={clsx(css.slider, disabled && css.sliderDisabled)}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={placed}
      aria-valuetext={currentIndex < 0 ? unsetLabel : levels[currentIndex]?.name}
      aria-disabled={disabled}
      style={{ '--effort-pos': positionAt(placed) } as CSSProperties}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div className={css.sliderFill} />
      {levels.map((level, index) => (
        <span
          key={level.id}
          className={clsx(css.sliderDot, index <= currentIndex && css.sliderDotOn)}
          style={{ left: positionAt(index) }}
        />
      ))}
      <span className={clsx(css.sliderKnob, currentIndex < 0 && css.sliderKnobUnset)} />
    </div>
  )
}
