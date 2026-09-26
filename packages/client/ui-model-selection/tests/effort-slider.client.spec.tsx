// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EffortSlider } from '../src/client/EffortSlider.tsx'
import { stubPointerCapture } from './pointer-capture.ts'

const levels = [
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
  { id: 'xhigh', name: '极高' },
]

const base = { levels, ariaLabel: '推理等级滑块', unsetLabel: '跟随提供商默认', disabled: false }

afterEach(cleanup)

let captured: WeakMap<Element, number>
let restoreCapture: () => void

beforeAll(() => {
  const stub = stubPointerCapture()
  captured = stub.captured
  restoreCapture = stub.restore
})

afterAll(() => { restoreCapture() })

/** Give the track a 100px geometry so stop math is exact: centers sit at 15, 38.3, 61.7, 85. */
function mockTrack(slider: HTMLElement): void {
  Object.defineProperty(slider, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  })
}

it('falls back to the current stop when the track has no measurable width', () => {
  // Unset (currentIndex -1): the degenerate rect resolves to stop 0, which the release commits.
  const selectUnset = vi.fn()
  const unset = render(<EffortSlider {...base} currentIndex={-1} onSelect={selectUnset} />)
  fireEvent.pointerDown(unset.getByRole('slider'), { clientX: 50 })
  fireEvent.pointerUp(window)
  expect(selectUnset).toHaveBeenCalledWith(0)
  unset.unmount()

  // Set: the fallback equals the current stop, so nothing re-commits.
  const selectSet = vi.fn()
  const set = render(<EffortSlider {...base} currentIndex={2} onSelect={selectSet} />)
  fireEvent.pointerDown(set.getByRole('slider'), { clientX: 50 })
  fireEvent.pointerUp(window)
  expect(selectSet).not.toHaveBeenCalled()
})

it('leaves a track without levels unlit and reports no held level', () => {
  const onPreview = vi.fn()
  const onSelect = vi.fn()
  render(<EffortSlider {...base} levels={[]} currentIndex={-1} onPreview={onPreview} onSelect={onSelect} />)
  const slider = screen.getByRole('slider')
  expect(slider.hasAttribute('data-highest')).toBe(false)
  expect(slider.getAttribute('aria-valuetext')).toBe('跟随提供商默认')
  expect(slider.children).toHaveLength(2) // fill + knob
  fireEvent.pointerDown(slider, { clientX: 60 })
  expect(onPreview).toHaveBeenLastCalledWith(null)
})

it('empties the track while the session follows the provider default', () => {
  const view = render(<EffortSlider {...base} currentIndex={-1} onSelect={vi.fn()} />)
  expect(view.getByRole('slider').getAttribute('data-unset')).toBe('true')
  expect(view.getByRole('slider').hasAttribute('data-highest')).toBe(false)
  view.rerender(<EffortSlider {...base} currentIndex={0} onSelect={vi.fn()} />)
  // A chosen stop fills the track from its own end; only the default is empty.
  expect(view.getByRole('slider').hasAttribute('data-unset')).toBe(false)
})

it('marks only the highest selected stop for its gradient animation', () => {
  const view = render(<EffortSlider {...base} currentIndex={2} onSelect={vi.fn()} />)
  expect(view.getByRole('slider').hasAttribute('data-highest')).toBe(false)
  view.rerender(<EffortSlider {...base} currentIndex={3} onSelect={vi.fn()} />)
  expect(view.getByRole('slider').getAttribute('data-highest')).toBe('true')
})

it('pressing the current stop does not re-commit', () => {
  const onSelect = vi.fn()
  render(<EffortSlider {...base} currentIndex={1} onSelect={onSelect} />)
  const slider = screen.getByRole('slider')
  mockTrack(slider)
  fireEvent.pointerDown(slider, { clientX: 37 })
  fireEvent.pointerUp(window)
  expect(onSelect).not.toHaveBeenCalled()
})

it('holds every crossed level during a drag and commits once on release', () => {
  const onPreview = vi.fn()
  const onSelect = vi.fn()
  render(<EffortSlider {...base} currentIndex={0} onPreview={onPreview} onSelect={onSelect} />)
  const slider = screen.getByRole('slider')
  mockTrack(slider)

  fireEvent.pointerDown(slider, { clientX: 16 })
  expect(onPreview).toHaveBeenLastCalledWith(levels[0])
  expect(onSelect).not.toHaveBeenCalled()

  fireEvent.pointerMove(window, { clientX: 61 })
  expect(onPreview).toHaveBeenLastCalledWith(levels[2])
  // The held level drives the visible state while no commit exists yet.
  expect(slider.getAttribute('aria-valuenow')).toBe('2')
  expect(slider.getAttribute('aria-valuetext')).toBe('高')
  expect(onSelect).not.toHaveBeenCalled()

  // A move that stays inside the held level neither previews nor renders again.
  fireEvent.pointerMove(window, { clientX: 62 })
  expect(onPreview).toHaveBeenCalledTimes(2)

  fireEvent.pointerMove(window, { clientX: 84 })
  expect(slider.getAttribute('data-highest')).toBe('true')
  expect(onSelect).not.toHaveBeenCalled()

  fireEvent.pointerUp(window)
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(3)
  expect(onPreview).toHaveBeenLastCalledWith(null)
  expect(slider.getAttribute('aria-valuenow')).toBe('0')
  expect(slider.hasAttribute('data-highest')).toBe(false)

  // The released gesture listens no more.
  fireEvent.pointerMove(window, { clientX: 16 })
  expect(onPreview).toHaveBeenCalledTimes(4)
})

it('owns the pointer for the whole gesture and lets it go at the end', () => {
  const view = render(<EffortSlider {...base} currentIndex={0} onSelect={vi.fn()} />)
  const slider = view.getByRole('slider')
  mockTrack(slider)

  // The browser's default stays out of the gesture: a native selection or focus
  // change mid-drag would otherwise end it under the pointer.
  expect(fireEvent.pointerDown(slider, { clientX: 50, pointerId: 7 })).toBe(false)
  expect(captured.get(slider)).toBe(7)
  fireEvent.pointerUp(window)
  expect(captured.has(slider)).toBe(false)

  // A capture the browser already dropped is not released twice.
  fireEvent.pointerDown(slider, { clientX: 50, pointerId: 8 })
  slider.releasePointerCapture(8)
  expect(fireEvent.pointerUp(window)).toBe(true)
  expect(captured.has(slider)).toBe(false)

  // A drag that outlives its own render leaves no capture behind either.
  fireEvent.pointerDown(slider, { clientX: 50, pointerId: 9 })
  expect(captured.get(slider)).toBe(9)
  view.unmount()
  expect(captured.has(slider)).toBe(false)
})

it('leaves a disabled track out of the gesture', () => {
  render(<EffortSlider {...base} disabled currentIndex={0} onSelect={vi.fn()} />)
  const slider = screen.getByRole('slider')
  expect(fireEvent.pointerDown(slider, { clientX: 50, pointerId: 3 })).toBe(true)
  expect(captured.has(slider)).toBe(false)
})

it('keeps the held level when the browser cancels the pointer mid-drag', () => {
  const onPreview = vi.fn()
  const onSelect = vi.fn()
  render(<EffortSlider {...base} currentIndex={0} onPreview={onPreview} onSelect={onSelect} />)
  const slider = screen.getByRole('slider')
  mockTrack(slider)
  fireEvent.pointerDown(slider, { clientX: 84 })
  fireEvent.pointerCancel(window)
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(3)
  expect(onPreview).toHaveBeenLastCalledWith(null)
})

it('refuses pointer and keyboard commits while disabled', () => {
  const onSelect = vi.fn()
  render(<EffortSlider {...base} currentIndex={0} disabled onSelect={onSelect} />)
  const slider = screen.getByRole('slider')
  expect(slider.getAttribute('tabindex')).toBe('-1')
  mockTrack(slider)
  fireEvent.pointerDown(slider, { clientX: 90 })
  fireEvent.pointerUp(window)
  expect(fireEvent.keyDown(slider, { key: 'ArrowRight' })).toBe(true)
  expect(onSelect).not.toHaveBeenCalled()
})

it('passes unknown keys through and jumps to the ends on Home and End', () => {
  const onSelect = vi.fn()
  render(<EffortSlider {...base} currentIndex={1} onSelect={onSelect} />)
  const slider = screen.getByRole('slider')
  mockTrack(slider)
  expect(fireEvent.keyDown(slider, { key: 'a' })).toBe(true)
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.keyDown(slider, { key: 'Home' })
  expect(onSelect).toHaveBeenLastCalledWith(0)
  fireEvent.keyDown(slider, { key: 'End' })
  expect(onSelect).toHaveBeenLastCalledWith(3)
})
