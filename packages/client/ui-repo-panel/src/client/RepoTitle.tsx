/**
 * The repo type's chip title: the branch mark before the type's label,
 * registered under `sidebar.right.pane.tab.title`; without it the chip would
 * show the bare label.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { RepoGlyph } from './glyphs.tsx'
import css from './RepoPanel.module.css'

/**
 * The title as the chip shows it.
 * @param props - the tab information hook.
 * @returns the branch mark followed by the tab's title text.
 */
export function RepoTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return (
    <>
      <RepoGlyph size={16} className={css.titleIcon} />
      {tab.title}
    </>
  )
}
