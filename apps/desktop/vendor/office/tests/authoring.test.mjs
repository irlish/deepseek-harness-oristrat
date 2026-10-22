/** Real OOXML generation, confined-worker admission, and durable Office state. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { unzipSync, strFromU8 } from 'fflate'
import ExcelJS from 'exceljs'
import { materializeOfficeDocument } from '../lib/authoring-worker.js'
import { createOfficeModes, validateOfficeDocument } from '../lib/office-state.js'
import { createAuthoring, officeCreateTool, validateAuthoringRequest } from '../lib/authoring.js'
import { registerOfficeRoutes, registerOfficeContext } from '../lib/modes.js'

const limits = { maxInputBytes: 65536, maxSlides: 40, maxCells: 10000, maxDocuments: 50, maxActivities: 100, maxStateBytes: 2 * 1024 * 1024, maxDownloadBytes: 16 * 1024 * 1024, timeoutMs: 45000 }
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'office-authoring-')); t.after(() => rm(root, { recursive: true, force: true })); return root }
const xml = (archive, path) => strFromU8(archive[path])

test('creates a Word package containing the supplied title and paragraphs', async t => {
  const root = await temporary(t)
  const saved = await materializeOfficeDocument(root, { format: 'word', title: '季度报告', content: '第一段：实际内容\n第二段：12345' })
  const archive = unzipSync(await readFile(join(root, saved.path)))
  assert.match(xml(archive, 'word/document.xml'), /季度报告/)
  assert.match(xml(archive, 'word/document.xml'), /第一段：实际内容/)
  assert.match(xml(archive, 'word/document.xml'), /第二段：12345/)
  assert.ok(archive['[Content_Types].xml']); assert.equal(saved.format, 'word')
})

test('reopens Excel cells with numbers and literal formula-looking text intact', async t => {
  const root = await temporary(t)
  const saved = await materializeOfficeDocument(root, { format: 'excel', title: '预算', content: '项目\t金额\n研发\t12000\n=HYPERLINK("https://example.org")\t0032' })
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(join(root, saved.path))
  const sheet = workbook.worksheets[0]
  assert.equal(sheet.getCell('A2').value, '研发'); assert.equal(sheet.getCell('B2').value, 12000)
  assert.equal(sheet.getCell('A3').value, '=HYPERLINK("https://example.org")'); assert.equal(sheet.getCell('B3').value, '0032')
})

test('creates two editable PowerPoint slides with actual headings and body text', async t => {
  const root = await temporary(t)
  const saved = await materializeOfficeDocument(root, { format: 'ppt', title: '经营汇报', content: '现状\n收入增长 20%\n成本下降 5%\n\n行动\n启动下一阶段' })
  const archive = unzipSync(await readFile(join(root, saved.path)))
  assert.equal(Object.keys(archive).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path)).length, 2)
  assert.match(xml(archive, 'ppt/slides/slide1.xml'), /收入增长 20%/)
  assert.match(xml(archive, 'ppt/slides/slide2.xml'), /启动下一阶段/)
  assert.match(xml(archive, 'ppt/slides/slide1.xml'), /<a:t>/)
})

test('concurrent saves never overwrite an existing file, and reject a linked output directory', async t => {
  const root = await temporary(t), request = { format: 'word', title: '../Same', content: 'text' }
  const files = await Promise.all([materializeOfficeDocument(root, request), materializeOfficeDocument(root, request)])
  assert.notEqual(files[0].path, files[1].path)
  assert.equal((await readdir(join(root, 'office-files'))).length, 2)
  const other = await temporary(t), outside = await temporary(t)
  await symlink(outside, join(other, 'office-files'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(materializeOfficeDocument(other, request), /regular Office output directory/)
  assert.deepEqual(await readdir(outside), [])
})

test('state survives reload and concurrent changes; malformed state is never reset silently', async t => {
  const root = await temporary(t), modes = createOfficeModes(root, limits, () => undefined)
  await Promise.all([modes.select('session-one', 'word'), modes.record('session-one', 'created', { title: '报告' })])
  const reopened = createOfficeModes(root, limits, () => undefined)
  assert.equal((await reopened.state('session-one')).documentMode, 'word')
  assert.equal((await reopened.state('session-one')).activities.length, 1)
  await writeFile(join(root, (await readdir(root))[0]), '{broken')
  await assert.rejects(reopened.state('session-one'), SyntaxError)
  assert.equal(await readFile(join(root, (await readdir(root))[0]), 'utf8'), '{broken')
})

test('rejects invalid requests and worker output before publishing history', () => {
  for (const request of [{ format: 'pdf', title: 'x', content: 'x' }, { format: 'word', title: '', content: 'x' }, { format: 'word', title: 'x', content: '' }]) assert.throws(() => validateAuthoringRequest(request, limits), /title and content/)
  assert.throws(() => validateAuthoringRequest({ format: 'ppt', title: 'x', content: 'one\n\ntwo' }, { ...limits, maxSlides: 1 }), /too many slides/)
  assert.throws(() => validateAuthoringRequest({ format: 'excel', title: 'x', content: 'a\tb' }, { ...limits, maxCells: 1 }), /too many cells/)
  assert.throws(() => validateAuthoringRequest({ format: 'word', title: 'x', content: '中文' }, { ...limits, maxInputBytes: 2 }), /too large/)
  assert.throws(() => validateOfficeDocument({ id: 'x', path: '../../secret.docx' }), /could not be verified/)
})

function subprocess() {
  return { spawn(options) {
    let stdout = '', stderr = ''
    const process = spawn(options.argv[0], options.argv.slice(1), { cwd: options.cwd, env: options.env, signal: options.signal })
    process.stdout.on('data', data => { stdout += data }); process.stderr.on('data', data => { stderr += data })
    process.stdin.end(options.stdio.stdin.data)
    return { done: new Promise((resolve, reject) => { process.once('error', reject); process.once('close', exitCode => resolve({ exitCode })) }),
      collected: { stdout: { readFrom: () => ({ text: stdout }) }, stderr: { readFrom: () => ({ text: stderr }) } } }
  } }
}

test('shared UI/tool operation creates actual files and denies read-only workspaces', async t => {
  const workspace = await temporary(t), modes = createOfficeModes(await temporary(t), limits, () => undefined)
  const agent = { id: 'test-session', session: { header: { cwd: workspace } } }, signal = new AbortController().signal
  const ctx = { workingDirectory: { ensure: async () => workspace }, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) }, sandbox: { confine: async argv => ({ argv }) }, subprocess: subprocess() }
  const tool = officeCreateTool(createAuthoring(ctx, modes, limits), limits)
  const saved = await tool.execute({ format: 'word', title: '工具创建', content: '通过真实子进程保存' }, { agent, signal })
  assert.equal((await readFile(join(workspace, saved.path))).subarray(0, 2).toString(), 'PK')
  assert.equal((await modes.state(agent.id)).documents[0].path, saved.path)
  const denied = createAuthoring({ ...ctx, sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: workspace }) } }, modes, limits)
  await assert.rejects(denied({ format: 'excel', title: 'denied', content: 'no write' }, { agent, signal }), /write permission/)
  assert.equal((await readdir(join(workspace, 'office-files'))).length, 1)
})

test('registered Connection route creates, lists and downloads the same document and disposes', async t => {
  const workspace = await temporary(t), modes = createOfficeModes(await temporary(t), limits, () => undefined), handlers = new Map(), cleanup = []
  const agent = { id: 'session-rpc', session: { header: { cwd: workspace } } }
  const ctx = { effect: operation => cleanup.push(operation()), connection: { rpc: { handle: (path, handler) => { handlers.set(path, handler); return () => handlers.delete(path) } } },
    sessionController: { resolveAgent: async () => ({ agent }), inspect: async () => ({ meta: { cwd: workspace } }) }, workingDirectory: { ensure: async () => workspace },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) }, sandbox: { confine: async argv => ({ argv }) }, subprocess: subprocess() }
  registerOfficeRoutes(ctx, { list: async () => [] }, modes, createAuthoring(ctx, modes, limits), limits)
  const call = (endpoint, payload) => handlers.get('/office')(endpoint, { sessionId: agent.id, ...payload }, new AbortController().signal)
  const created = await call('create', { format: 'excel', title: 'RPC 表格', content: '名称\t数量\n库存\t8' })
  assert.equal(created.ok, true)
  assert.equal((await call('state')).value.documents[0].path, created.value.path)
  const downloaded = await call('download', { id: created.value.id })
  assert.deepEqual(Buffer.from(downloaded.value.data, 'base64'), await readFile(join(workspace, created.value.path)))
  assert.equal((await call('download', { id: 'unknown' })).error.code, 'not-found')
  assert.equal((await call('create', { format: 'excel', title: '', content: 'x' })).error.code, 'invalid-request')
  for (const dispose of cleanup) dispose()
  assert.equal(handlers.size, 0)
})

test('a fresh session finds files from the same workspace without mixing another workspace', async t => {
  const root = await temporary(t), workspace = await temporary(t), other = await temporary(t)
  const modes = createOfficeModes(root, limits, () => undefined)
  const first = await materializeOfficeDocument(workspace, { format: 'word', title: 'Same workspace', content: 'Retained before a model turn' })
  const foreign = await materializeOfficeDocument(other, { format: 'excel', title: 'Other workspace', content: 'private' })
  await modes.addDocument('hidden-blank-session', first, workspace)
  await modes.addDocument('other-session', foreign, other)
  const reopened = createOfficeModes(root, limits, () => undefined)
  assert.deepEqual((await reopened.documentsFor(workspace)).map(item => [item.id, item.sessionId]), [[first.id, 'hidden-blank-session']])
  assert.deepEqual((await reopened.documentsFor(other)).map(item => item.id), [foreign.id])
  assert.deepEqual((await reopened.state('brand-new-session')).documents, [])
})

test('malformed worker replies and aborted writers never publish a successful document', async t => {
  const workspace = await temporary(t), modes = createOfficeModes(await temporary(t), limits, () => undefined)
  const agent = { id: 'worker-errors', session: { header: { cwd: workspace } } }
  const base = { workingDirectory: { ensure: async () => workspace }, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) }, sandbox: { confine: async argv => ({ argv }) } }
  const invalid = createAuthoring({ ...base, subprocess: { spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '{"path":"../../secret.docx"}' }) } } }) } }, modes, limits)
  await assert.rejects(invalid({ format: 'word', title: 'x', content: 'y' }, { agent, signal: new AbortController().signal }), { code: 'invalid-result' })
  const controller = new AbortController()
  const interrupted = createAuthoring({ ...base, subprocess: { spawn: () => { controller.abort(); return { done: Promise.reject(new Error('stopped')) } } } }, modes, limits)
  await assert.rejects(interrupted({ format: 'word', title: 'x', content: 'y' }, { agent, signal: controller.signal }), { code: 'interrupted' })
  assert.deepEqual((await modes.state(agent.id)).documents, [])
})

test('Excel document titles remain valid when a worksheet name is reserved or quoted', async t => {
  const root = await temporary(t)
  for (const title of ['History', "'Quarter one'", '[]']) {
    const saved = await materializeOfficeDocument(root, { format: 'excel', title, content: 'Value\n42' })
    const book = new ExcelJS.Workbook(); await book.xlsx.readFile(join(root, saved.path))
    assert.equal(book.title, title)
    assert.equal(book.worksheets[0].getCell('A2').value, 42)
  }
})

test('Office mode instructions preserve downstream request-series decisions and are logged messages', async t => {
  const root = await temporary(t), modes = createOfficeModes(root, limits, () => undefined), listeners = new Map()
  const agent = { id: 'context-session', session: { surface: { nodes: [] } } }
  await modes.select(agent.id, 'word')
  registerOfficeContext({ on: (event, callback) => listeners.set(event, callback), workingDirectory: { ensure: async () => root }, skills: { get: async () => ({ name: 'office-docx', content: 'Write native documents.', description: 'DOCX', provider: 'test', source: 'bundled' }) } }, { list: async () => [] }, modes)
  const downstream = { kind: 'enter', messages: [], startsRequestSeries: true }
  const result = await listeners.get('agent/pre-step')({ agent, signal: new AbortController().signal }, async () => downstream)
  assert.equal(result.startsRequestSeries, true)
  assert.equal(result.messages[0].source.kind, 'plugin:dsh-desktop-office-composer')
  assert.match(result.messages[0].content[0].text, /office_create/)
  const rejected = { kind: 'reject' }
  assert.equal(await listeners.get('agent/pre-step')({ agent, signal: new AbortController().signal }, async () => rejected), rejected)
})

test('PPT mode registers its existing tools and preserves the current pre-step decision fields', async t => {
  const { apply } = await import('../../ppt-core/lib/index.js')
  const root = await temporary(t), services = new Map(), listeners = new Map(), tools = new Map()
  let provider
  const ctx = { effect: operation => operation(), inject: () => undefined, get: name => services.get(name), reflect: { provide: (name, service) => { services.set(name, service); return () => services.delete(name) } },
    connection: { rpc: { handle: () => () => undefined } }, on: (event, callback) => listeners.set(event, callback),
    systemPrompt: { section: () => undefined }, tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    skills: { registerProvider: factory => { provider = factory() }, get: name => provider.get({ name }) } }
  await apply(ctx, { root, maxSlides: 40, maxDecksPerSession: 50, maxActivities: 100 })
  for (const name of ['pptd_check', 'pptd_write_file', 'pptd_render', 'ppt_list_templates']) assert.ok(tools.has(name))
  const agent = { id: 'ppt-context', session: { header: { cwd: root }, surface: { nodes: [] }, deriveMessages: () => [] } }
  await services.get('officePresentation').selectPresentationMode(agent.id, true, { kind: 'user' })
  const result = await listeners.get('agent/pre-step')({ agent, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [], startsRequestSeries: true }))
  assert.equal(result.startsRequestSeries, true)
  assert.ok(result.messages.every(message => message.source.kind.startsWith('plugin:')))
  assert.ok(result.messages.some(message => message.source.kind === 'plugin:dsh-ppt-composer'))
})


test('Desktop owns runtime registration while the composer keeps native authoring without optional resources', async t => {
  const { apply, Config } = await import('../index.js')
  const root = await temporary(t)
  for (const runtimeOwner of ['plugin', 'desktop']) {
    const plugins = [], tools = new Map(), routes = new Map(), services = new Map(), cleanup = []
    const ctx = {
      plugin: async plugin => { plugins.push(plugin.name) },
      effect: operation => { cleanup.push(operation()) }, on: () => undefined, get: name => services.get(name),
      reflect: { provide: (name, service) => { services.set(name, service); return () => services.delete(name) } },
      tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
      connection: { rpc: { handle: (path, handler) => { routes.set(path, handler); return () => routes.delete(path) } } },
    }
    await apply(ctx, Config({ root, runtimeOwner }))
    assert.equal(plugins.length, runtimeOwner === 'plugin' ? 1 : 0)
    assert.ok(tools.has('office_create'))
    assert.ok(services.has('officeModes'))
    assert.deepEqual(await routes.get('/office')('catalog', {}, new AbortController().signal), { ok: true, value: { templates: [], mode: null, documents: [] } })
    for (const dispose of cleanup) dispose()
    assert.equal(tools.size, 0); assert.equal(routes.size, 0); assert.equal(services.size, 0)
  }
  assert.equal(Config({ root }).runtimeOwner, 'plugin')
  assert.throws(() => Config({ root, runtimeOwner: 'absent-provider' }))
})
