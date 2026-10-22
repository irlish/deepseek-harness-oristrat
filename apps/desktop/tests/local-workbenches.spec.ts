import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'

interface Definition {
  id: string
  title: string
  description: string
  createdAt: string
}

interface DefinitionStore {
  list(): Promise<Definition[]>
  create(input: unknown): Promise<Definition>
}

// The prebuilt plugin uses a data-only ESM store without TypeScript declarations.
const storeEntry = '../vendor/workbenches/local-workbenches.mjs'
const { createLocalWorkbenchStore, LocalWorkbenchError } = await import(storeEntry) as {
  createLocalWorkbenchStore: (root: string) => DefinitionStore
  LocalWorkbenchError: new (status: number, code: string) => Error & { status: number; code: string }
}

async function fixture(): Promise<{
  root: string
  store: DefinitionStore
  request: { requestId: string; title: string; description: string }
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-local-workbenches-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return {
    root,
    store: createLocalWorkbenchStore(root),
    request: { requestId: randomUUID(), title: 'Project notes', description: 'Keep decisions and related conversations together.' },
  }
}

it('lists a missing directory as empty without creating it', async () => {
  const { root, store } = await fixture()
  await expect(store.list()).resolves.toEqual([])
  expect(await readdir(root)).toEqual([])
})

it('persists normalized definitions across store instances and repeats without replacing the record', async () => {
  const { root, store, request } = await fixture()
  const created = await store.create({ ...request, requestId: request.requestId.toUpperCase(), title: `  ${request.title}  `, description: `\n${request.description}\n` })
  expect(created).toMatchObject({ id: `local/${request.requestId}`, title: request.title, description: request.description })
  expect(Number.isFinite(Date.parse(created.createdAt))).toBe(true)
  const file = join(root, 'local-workbenches', `${request.requestId}.json`)
  const original = await readFile(file, 'utf8')
  expect(JSON.parse(original)).toEqual(created)
  const reopened = createLocalWorkbenchStore(root)
  await expect(reopened.list()).resolves.toEqual([created])
  await expect(reopened.create(request)).resolves.toEqual(created)
  expect(await readFile(file, 'utf8')).toBe(original)
  expect(await readdir(join(root, 'local-workbenches'))).toEqual([`${request.requestId}.json`])
})

it.skipIf(process.platform === 'win32')('creates owner-only definition files', async () => {
  const { root, store, request } = await fixture()
  await store.create(request)
  expect((await stat(join(root, 'local-workbenches', `${request.requestId}.json`))).mode & 0o777).toBe(0o600)
})

it('concurrent independent stores publish exactly one definition for the same request', async () => {
  const { root, request } = await fixture()
  const stores = [createLocalWorkbenchStore(root), createLocalWorkbenchStore(root)]
  const operations = stores.map(store => store.create(request))
  const [first, second] = await Promise.all(operations)
  expect(second).toEqual(first)
  await expect(createLocalWorkbenchStore(root).list()).resolves.toEqual([first])
  expect(await readdir(join(root, 'local-workbenches'))).toEqual([`${request.requestId}.json`])
})

it('independent processes return the same published record', async () => {
  const { root, request } = await fixture()
  const script = `
    const { createLocalWorkbenchStore } = await import(process.argv[1]);
    const start = new Promise(resolve => process.once('message', resolve));
    process.send('ready');
    await start;
    const result = await createLocalWorkbenchStore(process.argv[2]).create(JSON.parse(process.argv[3]));
    process.stdout.write(JSON.stringify(result));
    process.disconnect();
  `
  const children = Array.from({ length: 2 }, () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script,
      new URL(storeEntry, import.meta.url).href, root, JSON.stringify(request)], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    })
    let stdout = ''
    let stderr = ''
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => { resolve({ code, signal }) })
    })
    onTestFinished(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await closed
    })
    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    return { child, closed, ready: once(child, 'message'), stdout: () => stdout, stderr: () => stderr }
  })
  try {
    await Promise.all(children.map(child => Promise.race([
      child.ready,
      child.closed.then(() => { throw new Error(`Definition writer exited before ready: ${child.stderr()}`) }),
    ])))
    for (const child of children) child.child.send('create')
    for (const child of children) {
      expect(await child.closed, child.stderr()).toEqual({ code: 0, signal: null })
    }
    const saved = (await readFile(join(root, 'local-workbenches', `${request.requestId}.json`), 'utf8')).trim()
    for (const child of children) expect(child.stdout()).toBe(saved)
    expect(await readdir(join(root, 'local-workbenches'))).toEqual([`${request.requestId}.json`])
  } finally {
    for (const child of children) {
      if (child.child.exitCode === null && child.child.signalCode === null) child.child.kill()
    }
    await Promise.allSettled(children.map(child => child.closed))
  }
})

it('concurrent conflicting requests leave the winning definition intact', async () => {
  const { root, request } = await fixture()
  const results = await Promise.allSettled([
    createLocalWorkbenchStore(root).create(request),
    createLocalWorkbenchStore(root).create({ ...request, title: 'Different project' }),
  ])
  const successes = results.filter(result => result.status === 'fulfilled')
  const failures = results.filter(result => result.status === 'rejected')
  expect(successes).toHaveLength(1)
  expect(failures).toHaveLength(1)
  expect(failures[0]?.reason).toBeInstanceOf(LocalWorkbenchError)
  expect(failures[0]?.reason).toMatchObject({ status: 409, code: 'request_conflict' })
  await expect(createLocalWorkbenchStore(root).list()).resolves.toEqual(successes.map(result => result.value))
  expect(await readdir(join(root, 'local-workbenches'))).toEqual([`${request.requestId}.json`])
})

it.each([
  null,
  [],
  {},
  { requestId: '../../outside' },
  { requestId: 'not-a-uuid' },
  { requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
  { title: '' },
  { title: ' \n\t ' },
  { title: 'x'.repeat(81) },
  { title: 12 },
  { description: '' },
  { description: ' \n\t ' },
  { description: 'x'.repeat(1001) },
  { description: false },
  { extra: 'unexpected' },
])('rejects invalid input without creating a file: %j', async (override) => {
  const { root, store, request } = await fixture()
  const input = override === null || Array.isArray(override) || Object.keys(override).length === 0 ? override : { ...request, ...override }
  await expect(store.create(input)).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
  expect(await readdir(root)).toEqual([])
})

it('keeps path-looking titles as inert data and accepts exact length limits', async () => {
  const { root, store, request } = await fixture()
  const title = '../../outside/'.padEnd(80, 'x')
  const created = await store.create({ ...request, title, description: 'd'.repeat(1000) })
  expect(created.title).toBe(title)
  expect(created.description).toHaveLength(1000)
  expect(await readdir(root)).toEqual(['local-workbenches'])
  expect(await readdir(join(root, 'local-workbenches'))).toEqual([`${request.requestId}.json`])
})

it.each([
  '{broken json',
  JSON.stringify({}),
  JSON.stringify({ id: 'local/wrong', title: 'Name', description: 'Purpose', createdAt: '2026-10-22T00:00:00.000Z' }),
  'x'.repeat(8193),
])('reports corrupt saved records and refuses to overwrite them: %s', async (saved) => {
  const { root, store, request } = await fixture()
  const directory = join(root, 'local-workbenches')
  await mkdir(directory)
  const file = join(directory, `${request.requestId}.json`)
  await writeFile(file, saved)
  await expect(store.list()).rejects.toMatchObject({ status: 500, code: 'invalid_store' })
  await expect(store.create(request)).rejects.toMatchObject({ status: 500, code: 'invalid_store' })
  expect(await readFile(file, 'utf8')).toBe(saved)
})

it.each([
  { title: ' padded ' },
  { description: '' },
  { createdAt: 'yesterday' },
  { createdAt: '2026-02-30T00:00:00.000Z' },
  { extra: true },
])('validates saved fields instead of trusting valid JSON: %j', async (override) => {
  const { root, store, request } = await fixture()
  const created = await store.create(request)
  await writeFile(join(root, 'local-workbenches', `${request.requestId}.json`), JSON.stringify({ ...created, ...override }))
  await expect(store.list()).rejects.toMatchObject({ status: 500, code: 'invalid_store' })
})

it('rejects invalid record filenames while ignoring unpublished temporary files', async () => {
  const { root, store } = await fixture()
  const directory = join(root, 'local-workbenches')
  await mkdir(directory)
  await writeFile(join(directory, '.local-workbench-interrupted.tmp'), 'partial data')
  await expect(store.list()).resolves.toEqual([])
  await writeFile(join(directory, 'wrong.json'), '{}')
  await expect(store.list()).rejects.toMatchObject({ status: 500, code: 'invalid_store' })
})

it('reports inaccessible storage as a typed error with its original cause', async () => {
  const { root, store, request } = await fixture()
  await writeFile(join(root, 'local-workbenches'), 'not a directory')
  await expect(store.list()).rejects.toMatchObject({ status: 500, code: 'storage_failed' })
  await expect(store.list()).rejects.toHaveProperty('cause', expect.any(Error))
  await expect(store.create(request)).rejects.toMatchObject({ status: 500, code: 'storage_failed' })
  await expect(store.create(request)).rejects.toHaveProperty('cause', expect.any(Error))
})
