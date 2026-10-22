/** Recorded Office tool execution with actual OOXML and delivery, using the shipped Web composition. */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas, normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, normalizeWebSessionVolatiles, rawSessionLog, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT } from './support.ts'

const DIRECTORY = fileURLToPath(new URL('../../../snapshots/web/office-authoring', import.meta.url))
const FIXTURE = join(DIRECTORY, 'session.v4.jsonl')
interface CreatedDocument { id: string; format: string; title: string; path: string; bytes: number; sha256: string }

/** Parse the process result from the persisted tool event before using its file reference. */
function createdDocument(value: unknown): CreatedDocument {
  if (value === null || typeof value !== 'object') throw new Error('Office replay has no saved-file result')
  const fields = value as Record<string, unknown>
  if (typeof fields.id !== 'string' || !/^[a-f0-9-]{36}$/.test(fields.id)
    || fields.format !== 'word' || fields.title !== 'Recorded report'
    || fields.path !== `office-files/${fields.id}/Recorded report.docx`
    || typeof fields.bytes !== 'number' || !Number.isSafeInteger(fields.bytes) || fields.bytes < 1
    || typeof fields.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fields.sha256)) throw new Error('Office replay returned invalid file metadata')
  return { id: fields.id, format: fields.format, title: fields.title, path: fields.path, bytes: fields.bytes, sha256: fields.sha256 }
}

/** Only the verified created file's UUID, bytes, and hash vary; ZIP timestamps change its byte identity. */
function normalizeCreatedDocument(log: string, file: CreatedDocument): string {
  const visit = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') return value.split(file.id).join('00000000-0000-4000-8000-000000000001')
      .split(file.sha256).join('0'.repeat(64)).replaceAll(`"bytes":${file.bytes}`, '"bytes":1')
    if (key === 'bytes' && value === file.bytes) return 1
    if (Array.isArray(value)) return value.map(item => visit(item))
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name)]))
    return value
  }
  return log.split('\n').filter(Boolean).map(line => JSON.stringify(visit(JSON.parse(line)))).join('\n') + '\n'
}

it.skipIf(webSnapshotMode() === 'record')('replays Office creation and presentation with logged schemas, results, and native document contents', async () => {
  const mode = webSnapshotMode(), original = await readFile(FIXTURE, 'utf8')
  const scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: false, toolsMode: 'ptc' })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      const settled = scaffold.whenTurnSettled()
      const input = page.locator('[data-composer-input]').first()
      await input.fill(fixtureUserPrompts(original)[0]!)
      await input.press('Enter')
      const sessionId = await settled, agent = scaffold.ctx.agents.get(sessionId)
      if (agent === undefined || agent.session.header.cwd === undefined) throw new Error('Office replay has no live workspace session')
      const cwd = agent.session.header.cwd, events = agent.session.snapshotEvents()
      const execution = events.find(event => event.type === 'tool/ptc-dispatch' && event.data.name === 'office_create')
      if (execution?.type !== 'tool/ptc-dispatch') throw new Error('The recorded model did not call office_create')
      expect(execution.data.isError).toBe(false)
      const text = execution.data.content.find(block => block.type === 'text')
      if (text?.type !== 'text') throw new Error('Office tool returned no metadata text')
      const file = createdDocument(JSON.parse(text.text)), bytes = await readFile(join(cwd, file.path))
      expect(bytes.length).toBe(file.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
      expect(events.filter(event => event.type === 'deliverables/presented').flatMap(event => event.data.files.map(item => item.path))).toEqual([join(cwd, file.path)])
      expect((await readdir(join(cwd, 'office-files')))).toEqual([file.id])
      expect(await readdir(join(cwd, 'office-files', file.id))).toEqual(['Recorded report.docx'])
      const members = unzipSync(bytes)
      expect(strFromU8(members['word/document.xml']!)).toContain('Revenue increased by 20%.')
      expect(strFromU8(members['word/document.xml']!)).toContain('Next step: review the budget.')
      const expanded = Object.fromEntries(Object.entries(members)
        .sort(([left], [right]) => left.localeCompare(right)).map(([name, data]) => [name,
          strFromU8(data).replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g, '$1{{documentTime}}$2'),
        ]))
      await compareOrRefreshGolden(join(DIRECTORY, 'workspace.expected', 'report.docx.members.json'), JSON.stringify(expanded, null, 2), mode)
      const context = { sessionIds: [sessionId], cwd }, raw = rawSessionLog(agent.session)
      const normalizePaths = (value: string) => value.split(REPO_ROOT).join('{{sourceRoot}}').split(scaffold.baseUrl).join('{{webUrl}}').split(scaffold.harnessHome).join('{{harnessHome}}')
      const prompts = normalizedSystemPrompts(raw, context).map(normalizePaths), schemas = normalizedToolSchemas(raw, context)
      await compareOrRefreshGolden(join(DIRECTORY, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)).trimEnd(), mode)
      await compareOrRefreshGolden(join(DIRECTORY, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)).trimEnd(), mode)
      const registered = scaffold.ctx.tools.schemas(agent)
      expect(registered.map(tool => tool.name)).toEqual(expect.arrayContaining(['office_create', 'pptd_check', 'pptd_write_file', 'pptd_render', 'ppt_list_templates']))
      const officeSchema = registered.find(tool => tool.name === 'office_create')
      expect(officeSchema).toBeDefined()
      await compareOrRefreshGolden(join(DIRECTORY, 'office-tool.expected.json'), JSON.stringify(officeSchema, null, 2), mode)
      const normalized = redactSessionSnapshotIds([normalizeSessionSnapshot(normalizeCreatedDocument(normalizeWebSessionVolatiles(raw, cwd), file), context, { identityMode: 'preserve' })])[0]!
      const actual = normalizePaths(normalized)
      if (mode === 'refresh') await writeFile(FIXTURE, actual)
      expect(actual).toBe(mode === 'refresh' ? actual : original)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
