/**
 * RepoPanel: the read-only repository environment view. One poll loop owns
 * the snapshot: an immediate read on mount, a fixed-interval refresh while
 * the pane lives, and a manual refresh button. Rows show the branch with
 * upstream divergence, working-tree change totals, the serving machine, and
 * the configured remote sources; a directory outside any worktree renders a
 * single not-a-repo notice.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GuiRepoStatusRequest, GuiRepoStatusValue } from '@deepseek-ai/dsh-api-gui-repo/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'
import css from './RepoPanel.module.css'

/** Poll interval between automatic snapshot reads. */
const POLL_MS = 4_000

/** The panel's injected host read verb. */
export interface RepoPanelInjected {
  /** Snapshot the repository environment of one directory. */
  repoStatus: (request: GuiRepoStatusRequest) => Promise<GuiRepoStatusValue>
}

/** The panel's composed props: injected host verb, copy, and the inspected directory. */
export type RepoPanelProps = PropsLocale<'repo-panel'> & RepoPanelInjected & {
  /** Absolute workspace root of the owning session; server cwd when absent. */
  cwd?: string | undefined
}

/** One label/value row of the environment list. */
function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <span className={css.rowValue}>{children}</span>
    </div>
  )
}

/**
 * Draw the repository environment of one directory.
 * @param props - host read verb, localized copy, and the inspected directory.
 * @returns the pane-filling environment card.
 */
export function RepoPanel({ repoStatus, t, cwd }: RepoPanelProps): ReactNode {
  const [status, setStatus] = useState<GuiRepoStatusValue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const statusRef = useRef(repoStatus)
  statusRef.current = repoStatus

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await statusRef.current({ ...cwdRef.current === undefined ? {} : { cwd: cwdRef.current } })
      setStatus(next)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  return (
    <div className={css.panel}>
      <div className={css.head}>
        <span className={css.headTitle}>
          {status === null && error === null ? t('state.loading') : status?.repo === true ? (status.branch === '' ? status.root : status.branch) : t('state.noRepo')}
        </span>
        <button type="button" className={css.refresh} aria-label={t('action.refresh')} onClick={() => { void refresh() }}>
          <IconRefreshOutline14 />
        </button>
      </div>
      {error !== null && <div className={css.error}>{t('state.error', { message: error })}</div>}
      {status?.repo === true && (
        <div className={css.rows}>
          <Row label={t('row.branch')}>
            {status.branch}
            {status.ahead !== undefined && status.behind !== undefined && (
              <span className={css.divergence}>{t('value.aheadBehind', { ahead: status.ahead, behind: status.behind })}</span>
            )}
            {status.ahead !== undefined && status.behind === undefined && (
              <span className={css.divergence}>{t('value.ahead', { ahead: status.ahead })}</span>
            )}
            {status.ahead === undefined && status.behind !== undefined && (
              <span className={css.divergence}>{t('value.behind', { behind: status.behind })}</span>
            )}
          </Row>
          <Row label={t('row.changes')}>
            {status.files !== undefined && status.files > 0
              ? t('value.changes', { additions: status.additions ?? 0, deletions: status.deletions ?? 0, files: status.files })
              : t('state.clean')}
          </Row>
          <Row label={t('row.local')}>{status.host}</Row>
          <Row label={t('row.sources')}>
            {status.sources.length === 0
              ? t('sources.none')
              : (
                <span className={css.sources}>
                  {status.sources.map(source => (
                    <span key={`${source.name}\u0000${source.url}`} className={css.source}>
                      <span className={css.sourceName}>{source.name}</span>
                      <span className={css.sourceUrl}>{source.url}</span>
                    </span>
                  ))}
                </span>
              )}
          </Row>
        </div>
      )}
    </div>
  )
}
