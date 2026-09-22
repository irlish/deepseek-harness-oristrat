/**
 * Stage one of this package's registration: what the `repo` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address. The guide page
 * offers it beside the files and terminal types; the sidebar navigation
 * controller opens it.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { RepoGlyph } from './glyphs.tsx'

/** The tab kind this package owns. */
export const REPO_KIND = 'repo'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const REPO_ID = '@deepseek-ai/dsh-client-ui-repo-panel'

/**
 * The repo type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function repoDefinition(t: TranslateNS<'repo-panel'>): SidebarRightTabDefinition {
  return {
    id: REPO_ID,
    kind: REPO_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      order: 30,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: RepoGlyph,
    }],
  }
}
