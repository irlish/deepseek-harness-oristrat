// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { BrowserAutomation } from '../src/client/view/BrowserAutomation.tsx'
import type { BrowserBodyProps } from '../src/client/view/BrowserBody.tsx'
import type { BrowserAutomationResult } from '@oristrat/dsh-browser-use-chrome-devtools-mcp/types'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function mount() {
  const controller = new AbortController()
  const connection = { mode: 'attach' as const, endpoint: 'http://127.0.0.1:9231' }
  const perform = vi.fn<NonNullable<BrowserBodyProps['performAutomation']>>()
  perform.mockResolvedValue({ connection, status: 'connected', text: '1: https://example.test/form' })
  const configuration = vi.fn(async () => connection)
  const messages: Readonly<Record<string, string>> = zh
  const view = render(<BrowserAutomation t={key => messages[key] ?? key} signal={controller.signal} url="https://example.test/form"
    automationConfiguration={configuration} performAutomation={perform} />)
  fireEvent.click(view.getByRole('button', { name: /浏览器自动化/u }))
  return { view, perform, configuration, connection, controller }
}

it('displays the actual connection and passes explicit page and element identities to browser operations', async () => {
  const h = mount()
  await waitFor(() => { expect(h.view.getByText(/http:\/\/127.0.0.1:9231/u)).toBeDefined() })
  fireEvent.click(h.view.getByRole('button', { name: zh['automation.connect'] }))
  await waitFor(() => { expect(h.view.getByLabelText(zh['automation.output']).textContent).toBe('1: https://example.test/form') })
  expect(h.perform).toHaveBeenLastCalledWith({ kind: 'pages' }, h.controller.signal)
  fireEvent.click(h.view.getByRole('button', { name: zh['automation.open'] }))
  await waitFor(() => { expect(h.perform).toHaveBeenLastCalledWith({ kind: 'navigate', url: 'https://example.test/form' }, h.controller.signal) })
  await waitFor(() => { expect(h.view.getByRole('button', { name: zh['automation.connect'] })).toHaveProperty('disabled', false) })
  fireEvent.change(h.view.getByRole('textbox', { name: zh['automation.pageId'] }), { target: { value: '1' } })
  fireEvent.change(h.view.getByRole('textbox', { name: zh['automation.uid'] }), { target: { value: '2_4' } })
  fireEvent.change(h.view.getByRole('textbox', { name: zh['automation.value'] }), { target: { value: 'Hello' } })
  fireEvent.click(h.view.getByRole('button', { name: zh['automation.fill'] }))
  await waitFor(() => { expect(h.perform).toHaveBeenLastCalledWith({ kind: 'fill', pageId: 1, uid: '2_4', value: 'Hello' }, h.controller.signal) })
})

it('retains the previous page on connection failure and reports that an action may have changed it', async () => {
  const h = mount()
  await waitFor(() => { expect(h.configuration).toHaveBeenCalledOnce() })
  await waitFor(() => { expect(h.view.getByRole('button', { name: zh['automation.connect'] })).toHaveProperty('disabled', false) })
  fireEvent.click(h.view.getByRole('button', { name: zh['automation.connect'] }))
  await waitFor(() => { expect(h.view.getByLabelText(zh['automation.output'])).toBeDefined() })
  h.perform.mockRejectedValueOnce(new Error('connection lost'))
  fireEvent.click(h.view.getByRole('button', { name: zh['automation.open'] }))
  await waitFor(() => { expect(h.view.getByRole('alert').textContent).toBe(zh['automation.connection-failed']) })
  expect(h.view.getByLabelText(zh['automation.output']).textContent).toBe('1: https://example.test/form')
})

it('prevents duplicate operations and shows upstream failures without claiming a connection', async () => {
  const h = mount()
  await waitFor(() => { expect(h.view.getByRole('button', { name: zh['automation.connect'] })).toHaveProperty('disabled', false) })
  const pending = Promise.withResolvers<BrowserAutomationResult>()
  h.perform.mockReturnValueOnce(pending.promise)
  fireEvent.click(h.view.getByRole('button', { name: zh['automation.connect'] }))
  fireEvent.click(h.view.getByRole('button', { name: zh['automation.connect'] }))
  expect(h.perform).toHaveBeenCalledOnce()
  pending.resolve({ connection: h.connection, status: 'failed', text: 'Chrome is not reachable' })
  await waitFor(() => { expect(h.view.getByRole('alert').textContent).toBe(zh['automation.failed']) })
  expect(h.view.getByLabelText(zh['automation.output']).textContent).toBe('Chrome is not reachable')
})
