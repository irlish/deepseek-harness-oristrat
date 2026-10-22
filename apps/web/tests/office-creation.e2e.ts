/** Native Office authoring through the shipped Web UI, filesystem, and viewers. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

it('creates, downloads, restores, and previews Office files without a model request', async () => {
  const scaffold = await launchWebScaffold()
  try {
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    try {
      const tripwire = watchConsole(page)
      await page.route('**/api/desktop-workbenches/catalog*', route => route.fulfill({
        json: { catalog: { schemaVersion: 2, kind: 'catalog', categories: [], workbenches: [] }, stale: false },
      }))
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      await page.locator('[data-office-create]').click()
      const dialog = page.locator('[data-office-dialog]')
      await dialog.waitFor()
      expect(await dialog.locator('[data-office-save]').isEnabled()).toBe(false)
      await page.setViewportSize({ width: 390, height: 844 })
      const narrowDialog = await dialog.boundingBox()
      expect(narrowDialog).not.toBeNull()
      expect(narrowDialog!.x).toBeGreaterThanOrEqual(0)
      expect(narrowDialog!.x + narrowDialog!.width).toBeLessThanOrEqual(390)
      await dialog.locator('[data-office-title]').fill('Draft survives resize')
      await page.setViewportSize({ width: 1680, height: 1000 })
      expect(await dialog.locator('[data-office-title]').inputValue()).toBe('Draft survives resize')
      const cases = [
        { format: 'word', extension: 'docx', content: 'Office acceptance paragraph\nSecond paragraph', member: 'word/document.xml', text: 'Office acceptance paragraph' },
        { format: 'excel', extension: 'xlsx', content: 'Item\tAmount\nAlpha\t42\nBeta\t=1+1', member: 'xl/sharedStrings.xml', text: 'Alpha' },
        { format: 'ppt', extension: 'pptx', content: 'First slide\nOffice acceptance slide\n\nSecond slide\nNext action', member: 'ppt/slides/slide1.xml', text: 'Office acceptance slide' },
      ]
      const saved: { format: string; path: string; bytes: Buffer }[] = []
      for (const example of cases) {
        await dialog.locator('[data-office-format]').selectOption(example.format)
        await dialog.locator('[data-office-title]').fill('Acceptance document')
        await dialog.locator('[data-office-content]').fill(example.content)
        await dialog.locator('[data-office-save]').click()
        const result = dialog.locator('[data-office-saved]')
        await result.waitFor({ timeout: 30_000 })
        const path = await result.getAttribute('data-office-saved')
        if (path === null) throw new Error('Office creation returned no workspace path')
        expect(path.endsWith(`.${example.extension}`)).toBe(true)
        const bytes = await readFile(join(scaffold.workspaceCwd, 'workspace', path))
        const archive = unzipSync(bytes)
        expect(strFromU8(archive[example.member]!)).toContain(example.text)
        if (example.format === 'excel') {
          expect(strFromU8(archive['xl/worksheets/sheet1.xml']!)).toContain('<v>42</v>')
          expect(strFromU8(archive['xl/worksheets/sheet1.xml']!)).not.toContain('<f>')
          expect(strFromU8(archive['xl/sharedStrings.xml']!)).toContain('=1+1')
        }
        if (example.format === 'ppt') expect(strFromU8(archive['ppt/slides/slide2.xml']!)).toContain('Next action')
        const row = dialog.locator(`[data-office-file="${path}"]`)
        const downloaded = page.waitForEvent('download')
        await row.locator('[data-office-download]').click()
        const download = await downloaded
        const downloadPath = await download.path()
        if (downloadPath === null) throw new Error('Office download has no local file')
        expect(await readFile(downloadPath)).toEqual(bytes)
        saved.push({ format: example.format, path, bytes })
      }
      // A duplicate title must create another file without replacing earlier work.
      await dialog.locator('[data-office-save]').click()
      await expect.poll(() => dialog.locator('[data-office-file]').count()).toBe(4)
      for (const item of saved) expect(await readFile(join(scaffold.workspaceCwd, 'workspace', item.path))).toEqual(item.bytes)
      await page.reload()
      await page.locator('[data-office-create]').click()
      await expect.poll(() => dialog.locator('[data-office-file]').count()).toBe(4)
      const evidence = fileURLToPath(new URL('../../../.artifacts/office-creation', import.meta.url))
      await mkdir(evidence, { recursive: true })
      await page.screenshot({ path: join(evidence, 'created-files.png'), fullPage: true })
      // Files created before any model turn remain available after reopening Web.
      for (const item of saved) {
        await dialog.locator(`[data-office-file="${item.path}"] [data-office-open]`).click()
        if (item.format === 'excel') await page.locator('[data-excel-preview]').waitFor({ timeout: 60_000 })
        else {
          await page.locator('[data-pdf-preview]').waitFor({ timeout: 60_000 })
          await expect.poll(async () => (await page.locator('[data-pdf-text]').allTextContents()).join(''), { timeout: 30_000 })
            .toContain(item.format === 'word' ? 'Office acceptance paragraph' : 'Office acceptance slide')
        }
        await page.screenshot({ path: join(evidence, `${item.format}-preview.png`), fullPage: true })
        await page.locator('[data-office-create]').click()
      }
      await dialog.getByRole('button', { name: 'Close document creation', exact: true }).click()
      await page.getByRole('button', { name: 'Work mode', exact: true }).click()
      await page.getByText('Work', { exact: true }).click()
      const word = page.locator('[data-office-mode="word"]')
      const excel = page.locator('[data-office-mode="excel"]')
      await word.click()
      await expect.poll(() => word.getAttribute('aria-pressed')).toBe('true')
      const ppt = page.getByRole('button', { name: 'PPT', exact: true })
      await ppt.click()
      await expect.poll(() => ppt.getAttribute('aria-expanded')).toBe('true')
      await expect.poll(() => word.getAttribute('aria-pressed')).toBe('false')
      await excel.click()
      await expect.poll(() => excel.getAttribute('aria-pressed')).toBe('true')
      await expect.poll(() => ppt.getAttribute('aria-expanded')).toBe('false')
      await page.route('**/dsh-ppt/presentation/mode', async (route) => {
        const request: unknown = route.request().postDataJSON()
        if (request === null || typeof request !== 'object' || !('rpcId' in request) || typeof request.rpcId !== 'string') {
          throw new Error('PPT selection has no RPC request identity')
        }
        await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId,
          result: { ok: false, error: { code: 'fixture-mode-failure', message: 'Fixture mode failure', details: {} } } } })
      })
      await ppt.click()
      await page.getByText('Fixture mode failure', { exact: true }).waitFor()
      expect(await ppt.getAttribute('aria-expanded')).toBe('false')
      expect(await excel.getAttribute('aria-pressed')).toBe('true')
      await page.unroute('**/dsh-ppt/presentation/mode')
      await ppt.click()
      await expect.poll(() => ppt.getAttribute('aria-expanded')).toBe('true')
      await expect.poll(() => excel.getAttribute('aria-pressed')).toBe('false')
      await excel.click()
      await expect.poll(() => excel.getAttribute('aria-pressed')).toBe('true')
      await page.screenshot({ path: join(evidence, 'work-mode.png'), fullPage: true })
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      await compareOrRefreshGolden(fileURLToPath(new URL('./expected/office-creation.md', import.meta.url)), [
        'Word: entered paragraphs stored in a real DOCX and rendered in the document viewer',
        'Excel: entered text and numeric cells stored in XLSX; formulas remain literal text',
        'PowerPoint: both entered slides stored in PPTX and rendered in the document viewer',
        'Downloads: byte-identical to workspace files for all three formats',
        'Duplicate titles: new output path; earlier files unchanged',
        'Reload before a model turn: all four files remain available',
        'Work mode: Word, Excel, and PPT selections reach the Host and remain mutually exclusive',
        'Rejected PPT selection: error shown, Excel retained, and a later successful request recovers',
        '390px viewport: creation dialog fits; draft survives resizing',
      ].join('\n'), webSnapshotMode())
    } catch (error) {
      await saveFailureShot(page, 'web-e2e-office-creation')
      throw error
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
