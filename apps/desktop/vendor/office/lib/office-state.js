/** Session-keyed Office UI state; model context is logged separately at pre-step. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Expected Office failures retain a stable category across HTTP and tools. */
export class OfficeError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'OfficeError'; this.code = code }
}

/** Validate worker output and durable file references before using their paths. */
export function validateOfficeDocument(document) {
  const extension = { word: 'docx', excel: 'xlsx', ppt: 'pptx' }[document?.format]
  if (!document || !/^[a-f0-9-]{36}$/.test(document.id) || !extension
    || typeof document.title !== 'string' || typeof document.path !== 'string'
    || (document.createdAt !== undefined && (typeof document.createdAt !== 'string' || !Number.isFinite(Date.parse(document.createdAt))))
    || !document.path.startsWith(`office-files/${document.id}/`) || !document.path.endsWith(`.${extension}`)
    || !/^office-files\/[a-f0-9-]{36}\/[^/\\]+\.(docx|xlsx|pptx)$/.test(document.path)
    || !Number.isSafeInteger(document.bytes) || document.bytes < 1 || !/^[a-f0-9]{64}$/.test(document.sha256)) throw new OfficeError('invalid-result', 'The saved Office file could not be verified; check office-files before trying again')
  return document
}

/** Validate the persisted document references before exposing files to a client. */
export function validateOfficeState(value) {
  if (!value || value.version !== 1 || ![null, 'word', 'excel'].includes(value.documentMode)
    || !Array.isArray(value.documents) || !Array.isArray(value.activities)) throw new OfficeError('invalid-state', 'Office state could not be read; restore its saved state before continuing')
  if (value.selectedDocumentTemplate && (!['word', 'excel'].includes(value.selectedDocumentTemplate.mode)
    || !/^[a-z0-9-]{1,96}$/.test(value.selectedDocumentTemplate.id) || !/^[a-f0-9]{24}$/.test(value.selectedDocumentTemplate.revision))) throw new OfficeError('invalid-state', 'The saved Office selection is invalid')
  for (const document of value.documents) validateOfficeDocument(document)
  if (value.documents.length && (typeof value.sessionId !== 'string' || !value.sessionId || !isAbsolute(value.workspaceRoot ?? ''))) throw new OfficeError('invalid-state', 'The saved Office workspace is invalid')
  return value
}

/** Atomic, per-session transactions retain the previous state on write failure. */
export function createOfficeModes(root, limits, presentation) {
  if (!isAbsolute(root)) throw new OfficeError('invalid-config', 'Office root must be an absolute directory')
  const pending = new Map()
  const pathFor = id => {
    if (typeof id !== 'string' || !id.trim() || id.length > 512) throw new OfficeError('invalid-request', 'Choose an active session')
    return join(root, `${createHash('sha256').update(id).digest('hex')}.json`)
  }
  const read = async id => {
    try {
      if ((await stat(pathFor(id))).size > limits.maxStateBytes) throw new OfficeError('invalid-state', 'Office history exceeds its configured size limit')
      return validateOfficeState(JSON.parse(await readFile(pathFor(id), 'utf8')))
    }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, documentMode: null, documents: [], activities: [] }
      throw error
    }
  }
  const mutate = (id, update) => {
    const prior = pending.get(id) ?? Promise.resolve()
    const operation = prior.then(async () => {
      const current = await read(id), next = { ...await update(current), sessionId: id }
      validateOfficeState(next)
      const serialized = JSON.stringify(next)
      if (Buffer.byteLength(serialized) > limits.maxStateBytes) throw new OfficeError('limit-exceeded', 'Office history is full; create a new session')
      await mkdir(root, { recursive: true, mode: 0o700 })
      const destination = pathFor(id), temporary = `${destination}.${randomUUID()}.tmp`
      try { await writeFile(temporary, `${serialized}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, destination) }
      finally { await rm(temporary, { force: true }) }
      return next
    })
    const settled = operation.then(() => undefined, () => undefined)
    pending.set(id, settled)
    void settled.then(() => { if (pending.get(id) === settled) pending.delete(id) })
    return operation
  }
  return {
    async state(id) { await pending.get(id); return read(id) },
    async select(id, mode) {
      if (![null, 'word', 'excel'].includes(mode)) throw new OfficeError('invalid-request', 'Choose Word or Excel')
      await mutate(id, async state => {
        if (mode) await presentation()?.selectPresentationMode(id, false, { kind: 'user' })
        const { selectedDocumentTemplate, ...rest } = state
        return { ...rest, documentMode: mode }
      })
      return true
    },
    async selectTemplate(id, template) {
      await mutate(id, async state => {
        await presentation()?.selectPresentationMode(id, false, { kind: 'user' })
        return { ...state, documentMode: template.mode, selectedDocumentTemplate: template }
      })
      return true
    },
    async deselectTemplate(id) { await mutate(id, state => { const { selectedDocumentTemplate, ...rest } = state; return rest }); return true },
    async record(id, operation, facts) {
      await mutate(id, state => ({ ...state, activities: [...state.activities, { operation, facts, time: new Date().toISOString() }].slice(-limits.maxActivities) }))
      return true
    },
    async addDocument(id, document, workspaceRoot) {
      return mutate(id, state => ({ ...state, workspaceRoot, documents: [{ ...document, createdAt: new Date().toISOString() }, ...(state.workspaceRoot === workspaceRoot ? state.documents : [])].slice(0, limits.maxDocuments) }))
    },
    async documentsFor(workspaceRoot) {
      await Promise.all(pending.values())
      let files
      try { files = await readdir(root) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
      const documents = []
      for (const file of files.filter(file => /^[a-f0-9]{64}\.json$/.test(file))) {
        const path = join(root, file)
        if ((await stat(path)).size > limits.maxStateBytes) throw new OfficeError('invalid-state', 'Office history exceeds its configured size limit')
        const candidate = JSON.parse(await readFile(path, 'utf8'))
        if (candidate.workspaceRoot !== workspaceRoot) continue
        const state = validateOfficeState(candidate)
        if (pathFor(state.sessionId) !== path) throw new OfficeError('invalid-state', 'Office history belongs to a different session')
        documents.push(...state.documents.map(document => ({ ...document, sessionId: state.sessionId })))
      }
      return documents.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? '') || right.id.localeCompare(left.id)).slice(0, limits.maxDocuments)
    },
  }
}
