/**
 * The browser type's chip title: the globe mark before the type's label,
 * registered under `sidebar.right.pane.tab.title`; without it the chip would
 * show the bare label.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BrowserGlyph } from './glyphs.tsx'
import css from './BrowserPanel.module.css'

/**
 * The title as the chip shows it.
 * @param props - the tab information hook.
 * @returns the globe mark followed by the tab's title text.
 */
export function BrowserTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return (
    <>
      <BrowserGlyph size={16} className={css.titleIcon} />
      {tab.title}
    </>
  )
}
