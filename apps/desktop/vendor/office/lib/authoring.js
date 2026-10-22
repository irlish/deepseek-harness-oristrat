/** Shared creation operation for the authenticated UI and model tools. */
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { OfficeError, validateOfficeDocument } from './office-state.js'
import { workspacePolicy } from './template-tool.js'

/** Reject malformed or oversized authoring input before acquiring output files. */
export function validateAuthoringRequest(input, limits) {
  if (!input || !['word', 'excel', 'ppt'].includes(input.format) || typeof input.title !== 'string' || !input.title.trim()
    || input.title.length > 160 || typeof input.content !== 'string' || !input.content.trim()) throw new OfficeError('invalid-request', 'Choose a format and enter a title and content')
  const request = { format: input.format, title: input.title.trim(), content: input.content.replace(/\r\n?/g, '\n') }
  if (Buffer.byteLength(JSON.stringify(request)) > limits.maxInputBytes) throw new OfficeError('limit-exceeded', 'This document is too large; split its content into smaller files')
  if (request.format === 'ppt' && request.content.split(/\n\s*\n/).length > limits.maxSlides) throw new OfficeError('limit-exceeded', 'This presentation has too many slides; split it into smaller files')
  if (request.format === 'excel' && request.content.split('\n').reduce((sum, row) => sum + row.split('\t').length, 0) > limits.maxCells) throw new OfficeError('limit-exceeded', 'This workbook has too many cells; split it into smaller files')
  return request
}

/** Run a finite, scrubbed writer inside the session's existing filesystem policy. */
export function createAuthoring(ctx, modes, limits) {
  return async (input, exec) => {
    const request = validateAuthoringRequest(input, limits)
    const policy = await workspacePolicy(ctx, exec)
    const signal = AbortSignal.any([AbortSignal.timeout(limits.timeoutMs), exec.signal])
    const plan = await ctx.sandbox.confine([process.execPath, fileURLToPath(new URL('./authoring-worker.js', import.meta.url))], policy)
    const env = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]))
    if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    const child = ctx.subprocess.spawn({ argv: plan.argv, cwd: policy.cwd, env, signal, graceMs: 1000,
      stdio: { stdin: { data: JSON.stringify(request) }, stdout: { maxBytes: 8192 }, stderr: { maxBytes: 4096 } } })
    let outcome
    try { outcome = await child.done }
    catch (error) {
      if (signal.aborted) throw new OfficeError('interrupted', 'Document creation was interrupted; check office-files before trying again', { cause: error })
      throw new OfficeError('creation-failed', 'The document writer could not start; check the installed runtime and workspace permissions', { cause: error })
    }
    if (signal.aborted) throw new OfficeError('interrupted', 'Document creation was interrupted; check office-files before trying again')
    if (outcome.exitCode !== 0) throw new OfficeError('creation-failed', 'The document could not be saved; check workspace permissions and try again', { cause: new Error(child.collected.stderr.readFrom(0).text) })
    let document
    try { document = validateOfficeDocument(JSON.parse(child.collected.stdout.readFrom(0).text)) }
    catch (error) { throw new OfficeError('invalid-result', 'The saved Office file could not be verified; check office-files before trying again', { cause: error }) }
    if (document.title !== request.title || document.format !== request.format) throw new OfficeError('invalid-result', 'The saved Office file differs from the request; check office-files before trying again')
    try { await modes.addDocument(exec.agent.id, document, policy.cwd) }
    catch (error) { throw new OfficeError('history-failed', `The file was saved at ${document.path}, but its history could not be updated; open it from the workspace`, { cause: error }) }
    return document
  }
}

/** Native authoring tool; tool calls and created-file results use the ordinary Session log. */
export function officeCreateTool(create, config) {
  return defineTool({
    name: 'office_create',
    description: 'Create a real Word DOCX, Excel XLSX, or PowerPoint PPTX file in the active workspace. Supply the actual document content. Word uses one paragraph per line. Excel uses tab-separated columns and newline-separated rows; formulas remain literal text. PowerPoint uses a blank line between slides, the first line as its heading and remaining lines as body text. Use the returned path with present. For selected PPT templates use the pptd tools instead.',
    parameters: {
      format: { type: 'string', enum: ['word', 'excel', 'ppt'], required: true, description: 'Native output format.' },
      title: { type: 'string', required: true, description: 'Document title and base file name.' },
      content: { type: 'string', required: true, description: 'Document paragraphs, TSV rows, or slides separated by blank lines.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', required: true }, format: { type: 'string', required: true }, title: { type: 'string', required: true },
      path: { type: 'string', required: true }, bytes: { type: 'number', required: true }, sha256: { type: 'string', required: true },
    } }, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
    timeoutMs: config.timeoutMs, isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', kind: 'execute', title: 'Create Office document', rawInput: args }),
    execute: create,
  })
}
