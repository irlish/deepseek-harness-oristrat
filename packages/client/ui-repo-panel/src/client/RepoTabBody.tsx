/**
 * The `sidebar.right.pane.tab` body of the repo type: the environment card
 * filling one Sidebar pane. Everything it drives arrives through the injected
 * host face; the runtime share supplies the session whose workspace root it
 * inspects.
 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from './locales.ts'
import { RepoPanel, type RepoPanelInjected } from './RepoPanel.tsx'

/** The body's injected host read verb. */
export type RepoTabBodyInjected = RepoPanelInjected

/** The body's composed props: pane runtime, injected face, and copy. */
export type RepoTabBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'repo-panel'>
  & RepoTabBodyInjected

/**
 * Draw the repository environment inside one Sidebar pane.
 * @param props - pane runtime share, injected host verb, and localized copy.
 * @returns the pane-filling environment card.
 */
export function RepoTabBody({ t, sessionId, useSessions, repoStatus }: RepoTabBodyProps): ReactNode {
  // The panel reads where the session works: the workspace root the sessions
  // mirror carries per session, undefined until the mirror knows it.
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  return <RepoPanel t={t} cwd={cwd} repoStatus={repoStatus} />
}
