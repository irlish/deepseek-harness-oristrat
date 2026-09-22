/**
 * The `sidebar.right.pane.tab` body of the browser type: the embedded-browser
 * pane filling one Sidebar pane. Everything it drives arrives through the
 * injected desktop bridge seat.
 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import { BrowserPanel, type BrowserPanelInjected } from './BrowserPanel.tsx'

/** The body's injected desktop bridge seat. */
export type BrowserTabBodyInjected = BrowserPanelInjected

/** The body's composed props: pane runtime, injected bridge, and copy. */
export type BrowserTabBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'browser-panel'>
  & BrowserTabBodyInjected

/**
 * Draw the embedded browser inside one Sidebar pane.
 * @param props - pane runtime share, injected bridge, and localized copy.
 * @returns the pane-filling browser.
 */
export function BrowserTabBody({ t, bridge }: BrowserTabBodyProps): ReactNode {
  return <BrowserPanel t={t} bridge={bridge} />
}
