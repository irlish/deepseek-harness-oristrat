/**
 * Browser half: register `repo` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat and the chip title
 * into the keyed `sidebar.right.pane.tab.title` seat, both under the type's
 * `id`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { GuiRepoStatusRequest, GuiRepoStatusValue } from '@deepseek-ai/dsh-api-gui-repo/types'
import { REPO_ID, repoDefinition } from './definition.tsx'
import { en, NS, zh } from './locales.ts'
import { RepoTabBody, type RepoTabBodyInjected } from './RepoTabBody.tsx'
import { RepoTitle } from './RepoTitle.tsx'

export type { RepoPanelKey } from './locales.ts'
export type { RepoTabBodyInjected, RepoTabBodyProps } from './RepoTabBody.tsx'
export type { RepoPanelInjected, RepoPanelProps } from './RepoPanel.tsx'

/** Required browser services: the tab registry, the keyed seats, the Remote
 * carrier and its namespace, and copy. */
export const inject = ['slots', 'locale', 'remote', 'remote.guiRepo', 'sidebarRightTabs']

/** Connection response envelope carried by every unary Remote result. */
type RemoteEnvelope<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** The generated guiRepo namespace, structurally named pre-generation. */
interface GuiRepoWire {
  status: (request: GuiRepoStatusRequest) => Promise<RemoteEnvelope<GuiRepoStatusValue>>
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
 * Client plugin body: register the type, its dictionaries, its body, and its
 * chip title.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-repo-panel: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(repoDefinition(t)), 'ui-repo-panel: repo type')

  const wire = (ctx.remote as unknown as { guiRepo: GuiRepoWire }).guiRepo
  const injected = (): RepoTabBodyInjected => ({
    repoStatus: request => call(wire.status(request)),
  })
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: REPO_ID,
    locale: NS,
    inject: injected,
  }, RepoTabBody)), 'ui-repo-panel: repo tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: REPO_ID,
  }, RepoTitle)), 'ui-repo-panel: repo tab title')
}
