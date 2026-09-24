/**
 * Browser half: register the repository environment menu as a Session-header
 * utility, beside the Session's own menu button.
 *
 * The public two-stage path, unmodified: the contribution goes into the
 * `conversation.session.header.utilities` list seat through `ctx.slots`,
 * waiting on the seat's declaration and rolling back with the plugin fiber.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  GuiRepoBranchMutationValue,
  GuiRepoBranchesRequest,
  GuiRepoBranchesValue,
  GuiRepoCheckoutRequest,
  GuiRepoCreateBranchRequest,
  GuiRepoStatusRequest,
  GuiRepoStatusValue,
} from '@deepseek-ai/dsh-api-gui-repo/types'
import { en, NS, zh } from './locales.ts'
import { RepoEnvAction, type RepoEnvActionInjected } from './RepoEnvAction.tsx'

export type { RepoPanelKey } from './locales.ts'
export type { RepoEnvActionInjected, RepoEnvActionProps } from './RepoEnvAction.tsx'

/** Required browser services: the slots, the Remote carrier and its
 * namespace, and copy. */
export const inject = ['slots', 'locale', 'remote', 'remote.guiRepo']

/** Connection response envelope carried by every unary Remote result. */
type RemoteEnvelope<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** The generated guiRepo namespace, structurally named pre-generation. */
interface GuiRepoWire {
  status: (request: GuiRepoStatusRequest) => Promise<RemoteEnvelope<GuiRepoStatusValue>>
  branches: (request: GuiRepoBranchesRequest) => Promise<RemoteEnvelope<GuiRepoBranchesValue>>
  checkout: (request: GuiRepoCheckoutRequest) => Promise<RemoteEnvelope<GuiRepoBranchMutationValue>>
  createBranch: (request: GuiRepoCreateBranchRequest) => Promise<RemoteEnvelope<GuiRepoBranchMutationValue>>
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
 * Client plugin body: register the dictionaries and the header menu.
 * @param ctx - client root context carrying the slots, the Remote face, and the locale registry.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-repo-panel: dictionaries')

  const wire: GuiRepoWire = ctx.remote.guiRepo
  const injected = (): RepoEnvActionInjected => ({
    repoStatus: request => call(wire.status(request)),
    repoBranches: request => call(wire.branches(request)),
    repoCheckout: request => call(wire.checkout(request)),
    repoCreateBranch: request => call(wire.createBranch(request)),
  })
  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'repo-env',
    // Immediately after the open-in-app split button in the header utility row.
    order: -9,
    locale: NS,
    inject: injected,
  }, RepoEnvAction)), 'ui-repo-panel: header environment menu')
}
