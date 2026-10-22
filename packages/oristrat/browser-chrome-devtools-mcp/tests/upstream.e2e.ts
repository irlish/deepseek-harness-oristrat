import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it, onTestFinished, vi } from 'vitest'
import { verifyMcpBrowser } from '../../browser-use-runtime/tests/mcp-upstream.ts'
import * as Provider from '../src/index.ts'

it.skipIf(process.env.DSH_BROWSER_EXECUTABLE === undefined).each(['launch', 'attach'] as const)(
  'uses the pinned Chrome DevTools MCP server to %s Chromium and visit a loopback page',
  async mode => verifyMcpBrowser(Provider, 'chrome-devtools-mcp', { name: 'new_page', arguments: url => ({ url }) }, mode,
    async (ctx, agent, url, observed) => {
      const browser = ctx.get('browserAutomation')!
      expect(browser).toBeDefined()
      expect(browser.configuration().mode).toBe(mode)
      const signal = new AbortController().signal
      const pages = await browser.perform(agent, { kind: 'pages' }, signal)
      expect(pages.status).toBe('connected')
      expect(pages.text).toContain(url)
      const pageId = Number(pages.text.split('\n').find(line => line.includes(url))?.match(/^(\d+):/u)?.[1])
      expect(Number.isInteger(pageId), pages.text).toBe(true)
      expect(await browser.perform(agent, { kind: 'select', pageId }, signal)).toMatchObject({ status: 'connected' })
      expect(await browser.perform(agent, { kind: 'navigate', url: 'file:///etc/passwd' }, signal)).toMatchObject({ status: 'invalid-address' })
      const snapshot = await browser.perform(agent, { kind: 'observe', pageId }, signal)
      expect(snapshot.status, snapshot.text).toBe('connected')
      const invalidPage = await browser.perform(agent, { kind: 'observe', pageId: -1 }, signal)
      expect(invalidPage.status).toBe('failed')
      expect(invalidPage.text).not.toBe('')
      const input = /uid=([^\s]+) textbox "Name"/u.exec(snapshot.text)?.[1]
      const button = /uid=([^\s]+) button "Submit"/u.exec(snapshot.text)?.[1]
      expect(input, snapshot.text).toBeDefined()
      expect(button, snapshot.text).toBeDefined()
      const filled = await browser.perform(agent, { kind: 'fill', pageId, uid: input!, value: `verified-${mode}` }, signal)
      expect(filled.status, filled.text).toBe('connected')
      const clicked = await browser.perform(agent, { kind: 'click', pageId, uid: button! }, signal)
      expect(clicked.status, clicked.text).toBe('connected')
      await vi.waitFor(() => { expect(observed.has(`/submitted?value=verified-${mode}`)).toBe(true) })
      const updated = await browser.perform(agent, { kind: 'observe', pageId }, signal)
      expect(updated.text).toContain('Submitted')
      const workspace = await ctx.workingDirectory.ensure(agent, signal)
      const screenshotPath = join(workspace, 'submission.png')
      const screenshot = await ctx.tools.execute({
        agent, name: 'mcp__chrome-devtools-mcp__take_screenshot', arguments: { pageId, filePath: screenshotPath },
        callId: ToolCallId('screenshot-in-workspace'), signal,
      })
      expect(screenshot.isError, JSON.stringify(screenshot.content)).toBe(false)
      expect((await readFile(screenshotPath)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const outside = await mkdtemp(join(homedir(), '.dsh-browser-outside-'))
      onTestFinished(() => rm(outside, { recursive: true, force: true }))
      const deniedPath = join(outside, 'denied.png')
      const denied = await ctx.tools.execute({
        agent, name: 'mcp__chrome-devtools-mcp__take_screenshot', arguments: { pageId, filePath: deniedPath },
        callId: ToolCallId('screenshot-outside-workspace'), signal,
      })
      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied.content)).toContain('not within any of the configured workspace roots')
      await expect(readFile(deniedPath)).rejects.toMatchObject({ code: 'ENOENT' })
      const failed = await browser.perform(agent, { kind: 'click', pageId, uid: 'missing-node' }, signal)
      expect(failed.status).toBe('failed')
      expect(failed.text).not.toBe('')
      expect((await browser.perform(agent, { kind: 'observe', pageId }, signal)).status).toBe('connected')
    }),
)
