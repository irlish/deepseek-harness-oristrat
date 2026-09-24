/**
 * Stage one of this package's registration: what the `terminal` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address. The guide page offers
 * it as an entry box beside the files type, and `⌘J`/`Ctrl+J` opens it through
 * the sidebar navigation controller.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { TerminalGlyph } from './glyphs.tsx'

/** The tab kind this package owns. */
export const TERMINAL_KIND = 'terminal'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const TERMINAL_ID = '@deepseek-ai/dsh-client-ui-terminal-panel'

/**
 * The terminal type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function terminalDefinition(t: TranslateNS<'terminal-panel'>): SidebarRightTabDefinition {
  return {
    id: TERMINAL_ID,
    kind: TERMINAL_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: TERMINAL_ID,
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: TerminalGlyph,
    }],
  }
}
