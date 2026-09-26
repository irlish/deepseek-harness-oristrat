/**
 * EffortSlider: the Codex-style animated reasoning-effort control. One stop
 * per offered level; the knob and the filled track glide between stops while
 * dots light up through the current index. A pointer gesture holds the stop it
 * passes and commits once on release, so a drag lands one selection however many
 * stops it crosses; the keyboard commits the stop each arrow, Home, or End key
 * lands on. An unset selection (provider default) leaves the track empty under a
 * hollow knob parked on the first stop.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
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
  /**
   * Receive the level a pointer gesture holds — the same object from `levels` —
   * and `null` once that gesture ends or the track offers no level.
   */
  readonly onPreview?: (level: EffortLevel | null) => void
  /** Commit one stop by index. */
  readonly onSelect: (index: number) => void
}

/**
 * Distance from either end to the outermost stop's center, in the slider's own
 * pixels: the pill's radius plus the knob's, so a knob parked on the first or
 * last stop sits tangent inside the rounded end instead of crossing it.
 */
const TRACK_INSET_PX = 15

/**
 * Render the animated effort slider.
 * @param props - levels, current stop, accessible names, and the commit verb.
 * @returns the track with dots, fill, and knob.
 */
export function EffortSlider({
  levels, currentIndex, ariaLabel, unsetLabel, disabled, onPreview, onSelect,
}: EffortSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const currentRef = useRef(currentIndex)
  currentRef.current = currentIndex
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const previewRef = useRef(onPreview)
  previewRef.current = onPreview
  const dragListeners = useRef<{ move: (event: globalThis.PointerEvent) => void; up: () => void } | null>(null)
  const captureRef = useRef<{ element: HTMLDivElement; pointerId: number } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const last = levels.length - 1
  // The stop the control shows: the one a gesture holds, else the selection.
  const held = dragging ?? currentIndex
  const placed = held < 0 ? 0 : held

  const positionAt = (index: number) => {
    const fraction = last <= 0 ? 0 : index / last
    return `calc(${TRACK_INSET_PX}px + ${fraction} * (100% - ${2 * TRACK_INSET_PX}px))`
  }

  const levelAt = (index: number): EffortLevel | null => levels[index] ?? null

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
    window.removeEventListener('pointercancel', listeners.up)
    const capture = captureRef.current
    captureRef.current = null
    if (capture !== null && capture.element.hasPointerCapture(capture.pointerId)) {
      capture.element.releasePointerCapture(capture.pointerId)
    }
  }

  // A drag outlives renders; unmount must not leak its window listeners.
  useEffect(() => stopDrag, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    stopDrag()
    // The gesture owns this pointer, and the browser keeps its defaults out of
    // it: a pointer drag that left the default in place starts a selection and
    // moves focus off the control, and a release outside the window never
    // reaches a listener that is watching only this window. Capture delivers
    // every later move and the release to the track wherever the pointer goes.
    event.preventDefault()
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    captureRef.current = { element, pointerId: event.pointerId }
    // The stop this gesture holds; a move that crosses a stop replaces it.
    let gestureStop = indexAt(event.clientX)
    setDragging(gestureStop)
    previewRef.current?.(levelAt(gestureStop))
    // Preview on move, commit on release: a reach past either end still names the
    // stop the release lands on.
    const move = (moveEvent: globalThis.PointerEvent): void => {
      const next = indexAt(moveEvent.clientX)
      if (next === gestureStop) return
      gestureStop = next
      setDragging(next)
      previewRef.current?.(levelAt(next))
    }
    // A canceled pointer (a browser touch gesture taking over) keeps the held
    // stop: what the knob shows is what the release would have committed.
    const up = (): void => {
      stopDrag()
      setDragging(null)
      previewRef.current?.(null)
      commit(gestureStop)
    }
    dragListeners.current = { move, up }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
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
      data-highest={held === last && held >= 0 ? 'true' : undefined}
      data-unset={held < 0 ? 'true' : undefined}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={placed}
      aria-valuetext={held < 0 ? unsetLabel : levels[held]?.name}
      aria-disabled={disabled}
      style={{ '--effort-pos': positionAt(placed) } as CSSProperties}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div className={css.sliderFill} />
      {levels.map((level, index) => (
        <span
          key={level.id}
          className={clsx(css.sliderDot, index <= placed && css.sliderDotOn)}
          style={{ left: positionAt(index) }}
        />
      ))}
      <span className={clsx(css.sliderKnob, held < 0 && css.sliderKnobUnset)} />
    </div>
  )
}
