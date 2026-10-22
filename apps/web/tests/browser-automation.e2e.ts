/** Human browser automation through the shipped Web UI, Remote gateway, MCP, and real Chromium. */
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/browser-automation/controls.expected.md', import.meta.url))

describe.skipIf(MODE === 'record')('web e2e: browser automation', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let root: string
  let target: string
  let tripwire: ReturnType<typeof watchConsole>
  const observed = new Set<string>()
  const fixture = createServer((request, response) => {
    observed.add(request.url!)
    response.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY' })
    response.end('<!doctype html><title>Automation fixture</title><label>Name<input id="name"></label><button onclick="fetch(\'/submitted?name=\'+encodeURIComponent(document.querySelector(\'#name\').value)).then(()=>this.textContent=\'Submitted\')">Submit</button>')
  })

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-browser-ui-'))
    fixture.listen(0, '127.0.0.1')
    await once(fixture, 'listening')
    const address = fixture.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP fixture')
    target = `http://127.0.0.1:${address.port}/form`
    const patch = join(root, 'browser.patch.yml')
    await writeFile(patch, JSON.stringify([
      { id: 'ui-sidebar-browser', disabled: false },
      { id: 'browser-use-chrome-devtools-mcp', config: { mode: 'launch', headless: true, executablePath: chromium.executablePath() } },
    ]))
    scaffold = await launchWebScaffold({ extraOverlayPath: patch })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    fixture.closeAllConnections()
    if (fixture.listening) await new Promise<void>((resolve, reject) => {
      fixture.close((error) => { if (error) reject(error); else resolve() })
    })
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('verifies a connection and submits a real page without relying on iframe embedding or a model call', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-browser-automation'))
    const column = page.locator('[data-rightbar-col]')
    await page.locator('[data-sidebar-right-expand]').click()
    await column.locator('[data-sidebar-right-guide-entry="browser"]').click()
    await column.getByRole('button', { name: /Browser automation/u }).click()
    const automation = column.getByRole('region', { name: 'Browser automation' })
    await automation.getByText('Launch separate Chromium', { exact: true }).waitFor()
    await automation.getByRole('button', { name: 'Connect / check pages' }).click()
    await automation.getByRole('status').filter({ hasText: 'Connected; browser response received' }).waitFor()
    await column.getByRole('textbox', { name: 'Enter an HTTP(S) address' }).fill(target)
    await automation.getByRole('button', { name: 'Open address in automation browser' }).click()
    const output = automation.getByLabel('Actual browser response')
    await expect.poll(() => output.textContent()).toContain(target)
    const listing = await output.innerText()
    const pageId = listing.split('\n').find(line => line.includes(target))?.match(/^(\d+):/u)?.[1]
    expect(pageId, listing).toBeDefined()
    await automation.getByRole('textbox', { name: 'Page ID from the response' }).fill(pageId!)
    await automation.getByRole('button', { name: 'Read page', exact: true }).click()
    await expect.poll(() => output.textContent()).toContain('textbox "Name"')
    const snapshot = await output.innerText()
    const input = /uid=([^\s]+) textbox "Name"/u.exec(snapshot)?.[1]
    const button = /uid=([^\s]+) button "Submit"/u.exec(snapshot)?.[1]
    expect(input, snapshot).toBeDefined()
    expect(button, snapshot).toBeDefined()
    await automation.getByRole('textbox', { name: 'Element UID from a page snapshot' }).fill(input!)
    await automation.getByRole('textbox', { name: 'Text to fill' }).fill('verified-from-web')
    await automation.getByRole('button', { name: 'Fill element', exact: true }).click()
    await expect.poll(() => output.textContent()).toContain('verified-from-web')
    await automation.getByRole('textbox', { name: 'Element UID from a page snapshot' }).fill(button!)
    await automation.getByRole('button', { name: 'Click element', exact: true }).click()
    await expect.poll(() => observed.has('/submitted?name=verified-from-web')).toBe(true)
    await expect.poll(() => output.textContent()).toContain('Submitted')
    const evidence = fileURLToPath(new URL('../../../.artifacts/browser-automation', import.meta.url))
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'web-submitted.png'), fullPage: true })
    await automation.getByRole('textbox', { name: 'Page ID from the response' }).fill('999999')
    await automation.getByRole('button', { name: 'Read page', exact: true }).click()
    const alert = automation.getByRole('alert')
    await expect.poll(() => alert.textContent()).toBe('Operation failed. Review the response and inspect the page again.')
    await page.screenshot({ path: join(evidence, 'web-failure.png'), fullPage: true })
    expect(await output.textContent()).not.toContain('Submitted')
    expect(tripwire.pageErrors).toEqual([])
    await compareOrRefreshGolden(EXPECTED, [
      '# Browser automation', '',
      `- Connection: ${await automation.getByText('Launch separate Chromium', { exact: true }).innerText()}`,
      '- Navigation: the real Chromium reached a page that denies iframe embedding',
      '- Page snapshot: explicit page ID and element UIDs',
      '- Interaction: the independent HTTP server received verified-from-web',
      `- Invalid page: ${await alert.innerText()}`,
      '- Model calls: none',
    ].join('\n'), MODE)
  })
})
