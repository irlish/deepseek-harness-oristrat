// @vitest-environment jsdom
/** Per-model image-input declaration control: state read, explicit writes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { imageInputEnabled, imageInputModalities, ModelImageInputToggle } from '../src/client/ModelImageInputToggle.tsx'
import { en } from '../src/client/locales.ts'
import type { DeepSeekModelDraft } from '../src/client/DeepSeekModelsEditor.tsx'

const t = (key: keyof typeof en): string => en[key]

afterEach(() => {
  cleanup()
})

function mount(props: { model?: DeepSeekModelDraft; field?: string; disabled?: boolean; compact?: boolean } = {}) {
  const onChange = vi.fn()
  const view = render(
    <ModelImageInputToggle
      model={props.model ?? { id: 'm' }}
      field={props.field ?? 'input'}
      index={0}
      t={t}
      disabled={props.disabled ?? false}
      compact={props.compact ?? false}
      onChange={onChange}
    />,
  )
  return { view, onChange }
}

describe('image input declaration helpers', () => {
  it('reads only an explicit image entry in the adapter-owned field', () => {
    expect(imageInputEnabled({ input: ['text', 'image'] }, 'input')).toBe(true)
    expect(imageInputEnabled({ input: ['text'] }, 'input')).toBe(false)
    expect(imageInputEnabled({ input: 'image' }, 'input')).toBe(false)
    expect(imageInputEnabled({}, 'input')).toBe(false)
    expect(imageInputEnabled({ inputModalities: ['text', 'image'] }, 'inputModalities')).toBe(true)
  })

  it('writes the explicit two-modality or text-only list', () => {
    expect(imageInputModalities(true)).toEqual(['text', 'image'])
    expect(imageInputModalities(false)).toEqual(['text'])
  })
})

describe('ModelImageInputToggle', () => {
  it('shows the declared state and reports flips', () => {
    const declared = mount({ model: { id: 'm', input: ['text', 'image'] } })
    const box = screen.getByRole('checkbox', { name: `${en.modelImageInput} 1` })
    expect(box.getAttribute('aria-checked') ?? (box as HTMLInputElement).checked).toBeTruthy()
    cleanup()
    const undeclared = mount()
    const plain = screen.getByRole('checkbox', { name: `${en.modelImageInput} 1` }) as HTMLInputElement
    expect(plain.checked).toBe(false)
    fireEvent.click(plain)
    expect(undeclared.onChange).toHaveBeenCalledExactlyOnceWith(true)
    expect(declared.onChange).not.toHaveBeenCalled()
  })

  it('renders the full copy with the hint line and the compact form without it', () => {
    mount()
    expect(screen.getByText(en.modelImageInput)).toBeTruthy()
    expect(screen.getByText(en.modelImageInputHint)).toBeTruthy()
    cleanup()
    mount({ compact: true })
    expect(screen.getByText(en.modelImageInputShort)).toBeTruthy()
    expect(screen.queryByText(en.modelImageInputHint)).toBeNull()
  })

  it('disables the control without muting the declared state', () => {
    mount({ model: { id: 'm', input: ['text', 'image'] }, disabled: true })
    const box = screen.getByRole('checkbox', { name: `${en.modelImageInput} 1` }) as HTMLInputElement
    expect(box.disabled).toBe(true)
    expect(box.checked).toBe(true)
  })
})
