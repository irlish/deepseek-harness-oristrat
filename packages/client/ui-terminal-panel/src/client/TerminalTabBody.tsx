/**
 * The `sidebar.right.pane.tab` body of the terminal type: one xterm session
 * filling one Sidebar pane. Everything it drives arrives through the injected
 * host face; the pane runtime share supplies the tab identity it draws under.
 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from './locales.ts'
import { TerminalPane, type TerminalPaneInjected } from './TerminalWorkspace.tsx'

/** The body's injected host terminal callbacks. */
export type TerminalTabBodyInjected = TerminalPaneInjected

/** The body's composed props: pane runtime, injected face, and copy. */
export type TerminalTabBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'terminal-panel'>
  & TerminalTabBodyInjected

/**
 * Draw one terminal session inside one Sidebar pane.
 * @param props - pane runtime share, injected host callbacks, and localized copy.
 * @returns the pane-filling screen.
 */
export function TerminalTabBody({
  t, sessionId, useSessions, openTerminal, writeTerminal, readTerminal, closeTerminal,
}: TerminalTabBodyProps): ReactNode {
  // The terminal starts where the session works: the workspace root the
  // sessions mirror carries per session, undefined until the mirror knows it.
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  return (
    <TerminalPane
      t={t}
      cwd={cwd}
      openTerminal={openTerminal}
      writeTerminal={writeTerminal}
      readTerminal={readTerminal}
      closeTerminal={closeTerminal}
    />
  )
}
