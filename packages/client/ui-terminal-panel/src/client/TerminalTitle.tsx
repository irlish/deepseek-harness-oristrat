/**
 * The terminal type's chip title: the screen mark before the type's label,
 * registered under `sidebar.right.pane.tab.title`; without it the chip would
 * show the bare label.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TerminalGlyph } from './glyphs.tsx'
import css from './TerminalPanel.module.css'

/**
 * The title as the chip shows it.
 * @param props - the tab information hook.
 * @returns the terminal mark followed by the tab's title text.
 */
export function TerminalTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return (
    <>
      <TerminalGlyph size={16} className={css.titleIcon} />
      {tab.title}
    </>
  )
}
