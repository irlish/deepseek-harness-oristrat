import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
export const name: 'desktop-office'
export const inject: string[]
export interface Config {
  root: string
  resources?: string
  cli?: string
  /** Desktop Host owns its bundled skills and runtime; other profiles install them here. */
  runtimeOwner: 'plugin' | 'desktop'
  maxInputBytes: number
  maxSlides: number
  maxCells: number
  maxDocuments: number
  maxActivities: number
  maxStateBytes: number
  maxDownloadBytes: number
  timeoutMs: number
}
export const Config: Schema<Config>
export function apply(ctx: Context, config: Config): Promise<void>

export interface OfficeTemplateSelection {
  id: string
  mode: 'word' | 'excel'
  revision: string
}
/** A native file created in a workspace; identifiers never grant filesystem access. */
export interface OfficeDocument {
  id: string
  format: 'word' | 'excel' | 'ppt'
  title: string
  path: string
  bytes: number
  sha256: string
  createdAt?: string
}
/** Private UI state; injected instructions and tool results use the ordinary Session log. */
export interface OfficeModes {
  state(sessionId: string): Promise<{ documentMode: 'word' | 'excel' | null; selectedDocumentTemplate?: OfficeTemplateSelection; documents: OfficeDocument[] }>
  select(sessionId: string, mode: 'word' | 'excel' | null): Promise<boolean>
  selectTemplate(sessionId: string, template: OfficeTemplateSelection): Promise<boolean>
  deselectTemplate(sessionId: string): Promise<boolean>
  addDocument(sessionId: string, document: OfficeDocument, workspaceRoot: string): Promise<unknown>
  documentsFor(workspaceRoot: string): Promise<(OfficeDocument & { sessionId: string })[]>
  record(sessionId: string, operation: string, facts: Record<string, unknown>): Promise<boolean>
}
declare module '@deepseek-ai/cordis' {
  interface Context { officeModes: OfficeModes }
}
