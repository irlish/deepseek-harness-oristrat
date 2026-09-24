// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EffortSlider } from '../src/client/EffortSlider.tsx'

const levels = [
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
  { id: 'xhigh', name: '极高' },
]

const base = { levels, ariaLabel: '推理等级滑块', unsetLabel: '跟随提供商默认', disabled: false }

afterEach(cleanup)

/** Give the track a 100px geometry so stop math is exact: centers sit at 19, 39.7, 60.3, 81. */
function mockTrack(slider: HTMLElement): void {
  Object.defineProperty(slider, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  })
}

it('falls back to the current stop when the track has no measurable width', () => {
  // Unset (currentIndex -1): the degenerate rect resolves to stop 0 and commits it.
  const selectUnset = vi.fn()
  const unset = render(<EffortSlider {...base} currentIndex={-1} onSelect={selectUnset} />)
  fireEvent.pointerDown(unset.getByRole('slider'), { clientX: 50 })
  expect(selectUnset).toHaveBeenCalledWith(0)
  unset.unmount()

  // Set: the fallback equals the current stop, so nothing re-commits.
  const selectSet = vi.fn()
  const set = render(<EffortSlider {...base} currentIndex={2} onSelect={selectSet} />)
  fireEvent.pointerDown(set.getByRole('slider'), { clientX: 50 })
  expect(selectSet).not.toHaveBeenCalled()
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
  expect(onSelect).not.toHaveBeenCalled()
})

it('commits every pointermove of a drag and stops at pointerup', () => {
  const onSelect = vi.fn()
  render(<EffortSlider {...base} currentIndex={0} onSelect={onSelect} />)
  const slider = screen.getByRole('slider')
  mockTrack(slider)
  fireEvent.pointerDown(slider, { clientX: 10 })
  fireEvent.pointerMove(window, { clientX: 90 })
  expect(onSelect).toHaveBeenCalledWith(3)
  fireEvent.pointerUp(window)
  fireEvent.pointerMove(window, { clientX: 10 })
  expect(onSelect).toHaveBeenCalledTimes(1)
})

it('refuses pointer and keyboard commits while disabled', () => {
  const onSelect = vi.fn()
  render(<EffortSlider {...base} currentIndex={0} disabled onSelect={onSelect} />)
  const slider = screen.getByRole('slider')
  expect(slider.getAttribute('tabindex')).toBe('-1')
  mockTrack(slider)
  fireEvent.pointerDown(slider, { clientX: 90 })
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
