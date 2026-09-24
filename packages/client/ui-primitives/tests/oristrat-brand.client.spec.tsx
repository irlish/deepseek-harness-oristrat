// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { OristratBrand } from '../src/OristratBrand.tsx'

afterEach(cleanup)

it('shows the company mark and wordmark together, or only the wordmark when the mark has its own slot', () => {
  const labels = { fullName: 'Oristrat AI STEM', wordmark: 'Oristrat AI', badge: 'STEM' }
  const first = render(<OristratBrand labels={labels} />)
  expect(first.container.querySelector('img')).not.toBeNull()
  expect(first.getByLabelText(labels.fullName).textContent).toBe('Oristrat AISTEM')
  first.unmount()

  const second = render(<OristratBrand labels={labels} includeMark={false} size={30} className="identity" />)
  expect(second.container.querySelector('img')).toBeNull()
  expect(second.getByLabelText(labels.fullName).classList.contains('identity')).toBe(true)
})
