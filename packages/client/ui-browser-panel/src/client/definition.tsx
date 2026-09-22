/**
 * Stage one of this package's registration: what the `browser` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address. The guide page
 * offers it beside the files, terminal, and environment types; the sidebar
 * navigation controller opens it.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { BrowserGlyph } from './glyphs.tsx'

/** The tab kind this package owns. */
export const BROWSER_KIND = 'browser'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const BROWSER_ID = '@deepseek-ai/dsh-client-ui-browser-panel'

/**
 * The browser type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function browserDefinition(t: TranslateNS<'browser-panel'>): SidebarRightTabDefinition {
  return {
    id: BROWSER_ID,
    kind: BROWSER_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      order: 40,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: BrowserGlyph,
    }],
  }
}
