/**
 * Browser half: register `terminal` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat and the chip title into
 * the keyed `sidebar.right.pane.tab.title` seat, both under the type's `id`.
 * `⌘J`/`Ctrl+J` opens the page through the sidebar navigation controller.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-gui-terminal/remote'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {
  GuiTerminalCloseRequest, GuiTerminalOpenRequest, GuiTerminalOpenValue, GuiTerminalOutputRequest,
  GuiTerminalReadValue, GuiTerminalWriteRequest,
} from '@deepseek-ai/dsh-api-gui-terminal/types'
import { TERMINAL_ID, TERMINAL_KIND, terminalDefinition } from './definition.tsx'
import { en, NS, zh } from './locales.ts'
import { TerminalTabBody, type TerminalTabBodyInjected } from './TerminalTabBody.tsx'
import { TerminalTitle } from './TerminalTitle.tsx'

export type { TerminalPanelKey } from './locales.ts'
export type { TerminalTabBodyInjected, TerminalTabBodyProps } from './TerminalTabBody.tsx'
export type { TerminalPaneInjected, TerminalPaneProps } from './TerminalWorkspace.tsx'

/** Required browser services: the tab registry, the keyed seats, the Remote
 * carrier and its namespace, the navigation controller, and copy. */
export const inject = [
  'slots', 'locale', 'remote', 'remote.guiTerminal', 'sidebarRightTabs', 'sidebarRight',
]

/** Connection response envelope carried by every unary Remote result. */
type RemoteEnvelope<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** The generated guiTerminal namespace, structurally named pre-generation. */
interface GuiTerminalWire {
  open: (request: GuiTerminalOpenRequest) => Promise<RemoteEnvelope<GuiTerminalOpenValue>>
  write: (request: GuiTerminalWriteRequest) => Promise<RemoteEnvelope<void>>
  read: (request: GuiTerminalOutputRequest) => Promise<RemoteEnvelope<GuiTerminalReadValue>>
  close: (request: GuiTerminalCloseRequest) => Promise<RemoteEnvelope<void>>
}

/** Unwrap one unary Remote envelope, turning host errors into throws. */
function call<T>(promise: Promise<RemoteEnvelope<T>>): Promise<T> {
  return promise.then((result) => {
    if (!result.ok) {
      throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error))
    }
    return result.value
  })
}

/**
 * Client plugin body: register the type, its dictionaries, its body, its chip
 * title, and the keyboard shortcut that opens the page.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-terminal-panel: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(terminalDefinition(t)), 'ui-terminal-panel: terminal type')

  const wire: GuiTerminalWire = ctx.remote.guiTerminal
  const injected = (): TerminalTabBodyInjected => ({
    openTerminal: request => call(wire.open(request)),
    writeTerminal: request => call(wire.write(request)),
    readTerminal: request => call(wire.read(request)),
    closeTerminal: request => call(wire.close(request)),
  })
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TERMINAL_ID,
    locale: NS,
    inject: injected,
  }, TerminalTabBody)), 'ui-terminal-panel: terminal tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: TERMINAL_ID,
  }, TerminalTitle)), 'ui-terminal-panel: terminal tab title')

  const onKey = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
      event.preventDefault()
      ctx.sidebarRight.openTab(TERMINAL_KIND)
    }
  }
  window.addEventListener('keydown', onKey)
  ctx.effect(() => () => { window.removeEventListener('keydown', onKey) }, 'ui-terminal-panel: terminal shortcut')
}
