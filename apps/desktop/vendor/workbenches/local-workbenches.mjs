/** Persistent, data-only local workbench definitions with idempotent creation. */
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_RECORD_BYTES = 8 * 1024
const INPUT_FIELDS = ['requestId', 'title', 'description']
const RECORD_FIELDS = ['id', 'title', 'description', 'createdAt']
const ERROR_MESSAGES = {
  invalid_request: 'A UUID, a title of 1–80 characters and a description of 1–1000 characters are required.',
  request_conflict: 'This request already created a workbench with different content.',
  invalid_store: 'A saved local workbench is invalid. Repair its definition before continuing.',
  storage_failed: 'Local workbench storage failed. Retry with the same request ID after resolving the storage error.',
}

/** Machine-readable failure; callers own localized presentation and retain the cause in diagnostics. */
export class LocalWorkbenchError extends Error {
  /**
   * @param {number} status HTTP response status.
   * @param {'invalid_request' | 'request_conflict' | 'invalid_store' | 'storage_failed'} code Failure identity.
   * @param {ErrorOptions} [options] Underlying failure when available; omitted for validation failures.
   */
  constructor(status, code, options) {
    super(ERROR_MESSAGES[code], options)
    this.name = 'LocalWorkbenchError'
    this.status = status
    this.code = code
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasFields = (value, fields) => isObject(value)
  && Object.keys(value).length === fields.length
  && fields.every(field => Object.hasOwn(value, field))
const validText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit

function parseInput(input) {
  if (!hasFields(input, INPUT_FIELDS) || typeof input.requestId !== 'string' || !UUID.test(input.requestId)
    || !validText(input.title, 80) || !validText(input.description, 1000)) {
    throw new LocalWorkbenchError(400, 'invalid_request')
  }
  return { requestId: input.requestId.toLowerCase(), title: input.title.trim(), description: input.description.trim() }
}

function parseRecord(value, requestId) {
  if (!hasFields(value, RECORD_FIELDS) || value.id !== `local/${requestId}`
    || !validText(value.title, 80) || value.title.trim() !== value.title
    || !validText(value.description, 1000) || value.description.trim() !== value.description
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || new Date(value.createdAt).toISOString() !== value.createdAt) {
    throw new LocalWorkbenchError(500, 'invalid_store')
  }
  return value
}

function storageError(error) {
  return error instanceof LocalWorkbenchError ? error : new LocalWorkbenchError(500, 'storage_failed', { cause: error })
}

/**
 * Owns immutable definitions below `root/local-workbenches`. Names never enter paths.
 * A missing directory lists as empty; invalid saved records fail visibly without replacement.
 * Creation publishes one complete file exclusively, including across store instances or processes.
 * A storage failure may follow publication; repeating the same request safely retrieves that record.
 * @param {string} root Workbench persistence directory owned by the host.
 * @returns {{list(): Promise<object[]>, create(input: unknown): Promise<object>}} Persistent definition operations.
 */
export function createLocalWorkbenchStore(root) {
  const directory = join(root, 'local-workbenches')

  async function read(requestId) {
    const path = join(directory, `${requestId}.json`)
    if (!(await lstat(path)).isFile()) throw new LocalWorkbenchError(500, 'invalid_store')
    const handle = await open(path, 'r')
    let bytes
    try {
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
        if (bytesRead === 0) break
        length += bytesRead
      }
      if (length > MAX_RECORD_BYTES) throw new LocalWorkbenchError(500, 'invalid_store')
      bytes = buffer.subarray(0, length)
    } finally {
      await handle.close()
    }
    let value
    try { value = JSON.parse(bytes.toString('utf8')) }
    catch (error) { throw new LocalWorkbenchError(500, 'invalid_store', { cause: error }) }
    return parseRecord(value, requestId)
  }

  return {
    async list() {
      let files
      try { files = await readdir(directory) }
      catch (error) {
        if (error.code === 'ENOENT') return []
        throw storageError(error)
      }
      try {
        const result = []
        for (const file of files.filter(name => name.endsWith('.json')).sort()) {
          const requestId = file.slice(0, -5)
          if (!UUID.test(requestId) || requestId.toLowerCase() !== requestId) throw new LocalWorkbenchError(500, 'invalid_store')
          result.push(await read(requestId))
        }
        return result
      } catch (error) { throw storageError(error) }
    },
    async create(input) {
      const parsed = parseInput(input)
      const descriptor = { id: `local/${parsed.requestId}`, title: parsed.title, description: parsed.description, createdAt: new Date().toISOString() }
      const path = join(directory, `${parsed.requestId}.json`)
      const temporary = join(directory, `.local-workbench-${randomUUID()}.tmp`)
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        try {
          await writeFile(temporary, `${JSON.stringify(descriptor)}\n`, { flag: 'wx', mode: 0o600, flush: true })
          try { await link(temporary, path) }
          catch (error) {
            if (error.code !== 'EEXIST') throw error
            const existing = await read(parsed.requestId)
            if (existing.title !== parsed.title || existing.description !== parsed.description) throw new LocalWorkbenchError(409, 'request_conflict')
            return existing
          }
          return descriptor
        } finally {
          await rm(temporary, { force: true })
        }
      } catch (error) { throw storageError(error) }
    },
  }
}
