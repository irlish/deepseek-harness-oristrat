/** Workbench provider loading, durable Session ownership, and native conversation composition. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { expect, it } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

interface WorkbenchState {
  state: {
    active: string | null
    added: string[]
    sessionBindings: Record<string, string>
    recentSessions: Record<string, string>
    notes: Record<string, string>
  }
}

const WORKBENCH = 'fixture/web-workbench'

it('opens a loaded workbench, persists its new Session, and returns to ordinary conversations', async () => {
  const scaffold = await launchWebScaffold({
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/workbenches/package.json', import.meta.url))],
    profile: { packages: [], bundles: ['@fixture/web-workbench'] },
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      const evidence = fileURLToPath(new URL('../../../.artifacts/workbenches', import.meta.url))
      await mkdir(evidence, { recursive: true })
      try {
        // The external community index is the only network dependency replaced here.
        await page.route('**/api/desktop-workbenches/catalog*', route => route.fulfill({
          json: { catalog: { schemaVersion: 2, kind: 'catalog', categories: [], workbenches: [] }, stale: false },
        }))
        const readState = async (): Promise<WorkbenchState> =>
          await (await scaffold.hostFetch('/api/desktop-workbenches/state')).json() as WorkbenchState
        const refusedInstall = await scaffold.hostFetch('/api/desktop-workbenches/market-install', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'invalid' }),
        })
        expect(refusedInstall.status).toBe(400)
        expect(await refusedInstall.json()).toMatchObject({ error: 'A workbench market entry is required.' })
        await page.goto(scaffold.authenticatedUrl)
        await connectFreshWorkspace(page, scaffold.workspaceCwd)
        await expect.poll(async () => (await readState()).state.added).toContain(WORKBENCH)
        await page.getByRole('button', { name: 'Open workbench home', exact: true }).click()
        await page.getByRole('tab', { name: /^Installed/ }).click()
        await page.getByRole('heading', { name: 'Fixture Workbench', exact: true }).waitFor()
        await page.getByRole('button', { name: /^Switch workbench, current:/ }).click()
        await page.getByRole('menuitemradio', { name: /Fixture Workbench/ }).click()
        await page.locator('[data-workbench-fixture]').waitFor()
        await expect.poll(async () => (await readState()).state.active).toBe(WORKBENCH)
        await page.getByLabel('Business note', { exact: true }).fill('Keep business state when starting a conversation')
        await page.frameLocator('iframe[title="Workbench report"]').getByRole('heading', { name: 'Workbench report ready' }).waitFor()
        await page.getByRole('button', { name: 'Start conversation', exact: true }).click()
        await expect.poll(async () => Object.keys((await readState()).state.sessionBindings).length).toBe(1)
        const first = (await readState()).state.recentSessions[WORKBENCH]!
        await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
        expect(await page.getByLabel('Business note', { exact: true }).inputValue()).toBe('Keep business state when starting a conversation')
        // The sidebar's New Session action must create another workbench-owned Session.
        await page.getByRole('button', { name: 'New session', exact: true }).last().click()
        await expect.poll(async () => Object.keys((await readState()).state.sessionBindings).length).toBe(2)
        const second = (await readState()).state.recentSessions[WORKBENCH]!
        expect(second).not.toBe(first)
        await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
        expect(await page.getByLabel('Business note', { exact: true }).inputValue()).toBe('Keep business state when starting a conversation')
        await page.getByRole('button', { name: /^Switch workbench, current:/ }).click()
        await page.getByRole('menuitemradio', { name: 'Sessions', exact: true }).click()
        await expect.poll(async () => (await readState()).state.active).toBeNull()
        await page.locator('[data-workbench-fixture]').waitFor({ state: 'hidden' })
        const ordinaryCount = scaffold.ctx.agents.list().length
        await page.getByRole('button', { name: 'New session', exact: true }).last().click()
        await expect.poll(() => scaffold.ctx.agents.list().length).toBeGreaterThan(ordinaryCount)
        expect(Object.keys((await readState()).state.sessionBindings)).toHaveLength(2)
        // A reload restores the provider and its durable Session association.
        await page.reload()
        await page.getByRole('button', { name: /^Switch workbench, current:/ }).click()
        await page.getByRole('menuitemradio', { name: /Fixture Workbench/ }).click()
        await expect.poll(async () => (await readState()).state.active).toBe(WORKBENCH)
        expect((await readState()).state.recentSessions[WORKBENCH]).toBe(second)
        await page.locator('[data-workbench-fixture]').waitFor()
        await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
        await page.screenshot({ path: join(evidence, 'web-loaded.png'), fullPage: true })
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
        await compareOrRefreshGolden(fileURLToPath(new URL('./expected/workbenches/flow.expected.md', import.meta.url)), [
          'Local provider: loaded and listed in Workbench home',
          'Business panel: editable note and embedded report rendered',
          'Start conversation: one persisted workbench-owned Session',
          'Sidebar New session: second owned Session; business state retained',
          'Sessions mode: ordinary Session leaves workbench ownership unchanged',
          'Reload: provider and most recent owned Session restored',
        ].join('\n'), webSnapshotMode())
      } catch (error) {
        await saveFailureShot(page, 'workbenches/web-failure')
        throw error
      }
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})


it('creates a local notebook workbench from the Web and restores it after a Host restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-local-workbench-e2e-'))
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  const evidence = fileURLToPath(new URL('../../../.artifacts/workbenches', import.meta.url))
  const readState = async (): Promise<WorkbenchState> =>
    await (await scaffold!.hostFetch('/api/desktop-workbenches/state')).json() as WorkbenchState
  const open = async (): Promise<Page> => {
    scaffold = await launchWebScaffold({ harnessHome: home })
    browser = await chromium.launch()
    const opened = await newEnglishPage(browser)
    await opened.route('**/api/desktop-workbenches/catalog*', route => route.fulfill({
      json: { catalog: { schemaVersion: 2, kind: 'catalog', categories: [], workbenches: [] }, stale: false },
    }))
    await opened.goto(scaffold.authenticatedUrl)
    return opened
  }
  try {
    page = await open()
    const tripwire = watchConsole(page)
    await connectFreshWorkspace(page, scaffold!.workspaceCwd)
    await page.getByRole('button', { name: 'Open workbench home', exact: true }).click()
    await page.getByRole('button', { name: 'Build my workbench', exact: true }).click()
    const form = page.getByRole('form', { name: 'Create a basic workbench' })
    await form.getByLabel('Workbench name', { exact: true }).fill('Project notebook')
    await form.getByLabel('Purpose', { exact: true }).fill('Collect customer requests and plan the next release')
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'web-create-form.png'), fullPage: true })
    const creation = page.waitForResponse(response => response.url().endsWith('/api/desktop-workbenches/local/create'))
    await form.getByRole('button', { name: 'Create and open', exact: true }).click()
    const createdResponse = await creation
    expect(createdResponse.status()).toBe(200)
    const created = await createdResponse.json() as { workbench: { id: string; title: string; description: string } }
    const id = created.workbench.id
    expect(id).toMatch(/^local\/[a-f0-9-]+$/u)
    const duplicate = await scaffold!.hostFetch('/api/desktop-workbenches/local/create', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: createdResponse.request().postData()!,
    })
    expect(await duplicate.json()).toEqual(created)
    const saved = JSON.parse(await readFile(join(home, 'desktop-workbenches/local-workbenches', `${id.slice('local/'.length)}.json`), 'utf8')) as { title: string }
    expect(saved.title).toBe('Project notebook')
    await expect.poll(async () => (await readState()).state.active).toBe(id)
    const note = page.getByRole('textbox', { name: 'Workbench notes', exact: true })
    await note.fill('Customer A needs offline export. Prepare a prototype on Friday.')
    await expect.poll(async () => (await readState()).state.notes[id]).toBe('Customer A needs offline export. Prepare a prototype on Friday.')
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click()
    await expect.poll(async () => Object.values((await readState()).state.sessionBindings)).toContain(id)
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    await page.reload()
    await expect.poll(() => note.inputValue()).toBe('Customer A needs offline export. Prepare a prototype on Friday.')
    await page.getByRole('button', { name: 'Open workbench home', exact: true }).click()
    await page.getByRole('tab', { name: /^Installed/ }).click()
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Project notebook', exact: true }) })
    await card.getByRole('button', { name: 'Open workbench', exact: true }).click()
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'web-created.png'), fullPage: true })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await browser!.close()
    browser = undefined
    await scaffold!.close()
    scaffold = undefined
    page = await open()
    const restarted = watchConsole(page)
    await expect.poll(() => page!.getByRole('textbox', { name: 'Workbench notes', exact: true }).inputValue())
      .toBe('Customer A needs offline export. Prepare a prototype on Friday.')
    expect((await readState()).state.active).toBe(id)
    const definitions = await (await scaffold!.hostFetch('/api/desktop-workbenches/local')).json() as { workbenches: { id: string }[] }
    expect(definitions.workbenches.map(definition => definition.id)).toEqual([id])
    expect(restarted.pageErrors).toEqual([])
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/workbenches/create.expected.md', import.meta.url)), [
      'Creation: name and purpose saved to a local definition file',
      'Retry: the same request returns one existing workbench',
      'Notebook: business notes persisted to Host state',
      'Conversation: a real Session belongs to the created workbench',
      'Reload: notes and the native conversation restored',
      'Installed: the created workbench opens from its card',
      'Host restart: definition, notes, and active selection restored',
    ].join('\n'), webSnapshotMode())
  } catch (error) {
    if (page !== undefined) await saveFailureShot(page, 'workbenches/create-failure')
    throw error
  } finally {
    await browser?.close()
    await scaffold?.close()
    await rm(home, { recursive: true, force: true })
  }
})
