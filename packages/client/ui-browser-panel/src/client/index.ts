/**
 * Browser half: register `browser` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat and the chip title
 * into the keyed `sidebar.right.pane.tab.title` seat, both under the type's
 * `id`. The desktop bridge is read once per apply: on the plain web host it
 * is undefined and the pane renders its desktop-only notice.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { BROWSER_ID, browserDefinition } from './definition.tsx'
import { en, NS, zh } from './locales.ts'
import { desktopBrowser } from './bridge.ts'
import { BrowserTabBody, type BrowserTabBodyInjected } from './BrowserTabBody.tsx'
import { BrowserTitle } from './BrowserTitle.tsx'

export type { BrowserPanelKey } from './locales.ts'
export type { BrowserTabBodyInjected, BrowserTabBodyProps } from './BrowserTabBody.tsx'
export type { BrowserPanelInjected, BrowserPanelProps } from './BrowserPanel.tsx'
export type { BrowserBounds, BrowserState, DesktopBrowserBridge } from './bridge.ts'

/** Required browser services: the tab registry and the keyed seats. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: register the type, its dictionaries, its body, and its
 * chip title.
 * @param ctx - client root context carrying the registry and the slots.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const bridge = desktopBrowser()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-browser-panel: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(browserDefinition(t)), 'ui-browser-panel: browser type')

  const injected = (): BrowserTabBodyInjected => ({ bridge })
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: BROWSER_ID,
    locale: NS,
    inject: injected,
  }, BrowserTabBody)), 'ui-browser-panel: browser tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: BROWSER_ID,
  }, BrowserTitle)), 'ui-browser-panel: browser tab title')
}
