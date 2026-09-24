/**
 * RepoEnvAction: the Session-header repository environment menu. The trigger
 * sits in the header utilities beside the Session menu; opening it drops a
 * popover with the live environment rows (change totals, host, sources) and
 * a branch row whose submenu lists the worktree's local branches behind a
 * search box, checks out the picked one, and creates-and-checks-out a new
 * one. Reads poll while the menu is open; every git fact and mutation
 * arrives through the injected gui-repo Remote verbs.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
  MenuSurface,
  Tooltip,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
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
import type {} from './locales.ts'
import { EnvGlyph, RepoGlyph } from './glyphs.tsx'
import css from './RepoEnvAction.module.css'

/** Refresh interval for the open menu's git facts. */
const POLL_MS = 4_000

/** The menu's injected host verbs. */
export interface RepoEnvActionInjected {
  /** Snapshot the environment of one directory. */
  repoStatus: (request: GuiRepoStatusRequest) => Promise<GuiRepoStatusValue>
  /** List the local branches of one directory. */
  repoBranches: (request: GuiRepoBranchesRequest) => Promise<GuiRepoBranchesValue>
  /** Switch one worktree to an existing local branch. */
  repoCheckout: (request: GuiRepoCheckoutRequest) => Promise<GuiRepoBranchMutationValue>
  /** Create one new local branch and switch to it. */
  repoCreateBranch: (request: GuiRepoCreateBranchRequest) => Promise<GuiRepoBranchMutationValue>
}

/** The action's composed props: header runtime share, injected verbs, copy. */
export type RepoEnvActionProps =
  & PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'repo-panel'>
  & RepoEnvActionInjected

/** Change-total cell text: the clean-tree note or the +/- and file totals. */
function changesText(status: GuiRepoStatusValue, t: TranslateNS<'repo-panel'>): string {
  const additions = status.additions ?? 0
  const deletions = status.deletions ?? 0
  const files = status.files ?? 0
  if (additions === 0 && deletions === 0 && files === 0) return t('state.clean')
  return t('value.changes', { additions, deletions, files })
}

/** Upstream divergence cell text; absent without an upstream. */
function divergenceText(status: GuiRepoStatusValue, t: TranslateNS<'repo-panel'>): string | undefined {
  const { ahead, behind } = status
  if (ahead !== undefined && behind !== undefined) return t('value.aheadBehind', { ahead, behind })
  if (ahead !== undefined) return t('value.ahead', { ahead })
  if (behind !== undefined) return t('value.behind', { behind })
  return undefined
}

/**
 * Draw the header trigger and, while open, its environment popover.
 * @param props - header runtime share, injected gui-repo verbs, and copy.
 * @returns the trigger button plus the portaled menu while open.
 */
export function RepoEnvAction({
  t, sessionId, useSessions, repoStatus, repoBranches, repoCheckout, repoCreateBranch,
}: RepoEnvActionProps): ReactNode {
  // The menu reads where the session works: the workspace root the sessions
  // mirror carries per session, undefined until the mirror knows it.
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<GuiRepoStatusValue | null>(null)
  const [branchesOpen, setBranchesOpen] = useState(false)
  const [listing, setListing] = useState<GuiRepoBranchesValue | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const branchRowRef = useRef<HTMLButtonElement | null>(null)
  const position = useAnchoredPosition({ open, anchorRef, panelRef, side: 'bottom', gap: 6, margin: 8 })
  useDismissOnOutsidePointer(anchorRef, open, setOpen, panelRef)

  // Closing the menu drops the submenu and its draft so the next open starts
  // from the environment rows.
  useEffect(() => {
    if (open) return
    setBranchesOpen(false)
    setQuery('')
    setCreating(false)
    setDraft('')
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  useEffect(() => {
    if (!open || cwd === undefined) return
    let alive = true
    const load = (): void => {
      repoStatus({ cwd }).then(
        (value) => { if (alive) setStatus(value) },
        () => { if (alive) setStatus(null) },
      )
      if (!branchesOpen) return
      repoBranches({ cwd }).then(
        (value) => { if (alive) setListing(value) },
        () => { if (alive) setListing(null) },
      )
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [open, branchesOpen, cwd, repoStatus, repoBranches])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const names = listing?.branches ?? []
    return needle.length === 0 ? names : names.filter(name => name.toLowerCase().includes(needle))
  }, [listing, query])

  const pick = (branch: string): void => {
    /* v8 ignore next -- every live row is disabled without a workspace or while busy; the guard narrows cwd for the wire call. */
    if (cwd === undefined || busy) return
    setBusy(true)
    repoCheckout({ cwd, branch }).then(
      (result) => {
        setBusy(false)
        if (result.ok) {
          setOpen(false)
          return
        }
        setError(result.error ?? t('error.fallback'))
      },
      () => {
        setBusy(false)
        setError(t('error.fallback'))
      },
    )
  }

  const create = (event: FormEvent): void => {
    event.preventDefault()
    const name = draft.trim()
    /* v8 ignore next -- the submenu never renders without a workspace; the guard narrows cwd and stops empty-draft and busy submits. */
    if (cwd === undefined || busy || name.length === 0) return
    setBusy(true)
    repoCreateBranch({ cwd, name }).then(
      (result) => {
        setBusy(false)
        if (result.ok) {
          setOpen(false)
          return
        }
        setError(result.error ?? t('error.fallback'))
      },
      () => {
        setBusy(false)
        setError(t('error.fallback'))
      },
    )
  }

  const divergence = status !== null && status.repo ? divergenceText(status, t) : undefined
  return (
    <>
      <Tooltip label={t('action.tooltip')} side="bottom">
        <button
          ref={anchorRef}
          type="button"
          className={css.trigger}
          aria-label={t('action.aria')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <EnvGlyph size={16} />
          <span>{t('menu.title')}</span>
        </button>
      </Tooltip>
      {open && createPortal(
        <MenuSurface ref={panelRef} className={css.popover} role="menu" aria-label={t('menu.title')} style={position ?? undefined}>
          <div className={css.caption}>{t('menu.title')}</div>
          {cwd === undefined
            ? <div className={css.note}>{t('state.noSession')}</div>
            : status === null
              ? <div className={css.note}>{t('state.loading')}</div>
              : !status.repo
                ? <div className={css.note}>{t('state.noRepo')}</div>
                : (
                  <>
                    <div className={css.row}>
                      <span className={css.rowLabel}>{t('row.changes')}</span>
                      <span className={css.rowValue}>{changesText(status, t)}</span>
                    </div>
                    <div className={css.row}>
                      <span className={css.rowLabel}>{t('row.local')}</span>
                      <span className={css.rowValue}>{status.host}</span>
                    </div>
                    <button
                      ref={branchRowRef}
                      type="button"
                      className={css.rowButton}
                      aria-expanded={branchesOpen}
                      onClick={() => { setBranchesOpen(value => !value) }}
                    >
                      <RepoGlyph size={14} />
                      <span className={css.rowLabel}>{status.branch ?? ''}</span>
                      {divergence !== undefined && <span className={css.rowValue}>{divergence}</span>}
                      <IconChevronDownOutlineRegular size={14} />
                    </button>
                    <div className={css.sources}>
                      <span className={css.rowLabel}>{t('row.sources')}</span>
                      {status.sources.length === 0
                        ? <span className={css.sourcesEmpty}>{t('sources.none')}</span>
                        : (
                          <ul className={css.sourceList}>
                            {status.sources.map(source => (
                              <li key={`${source.name}\u0000${source.url}`} className={css.sourceItem}>
                                <span className={css.sourceName}>{source.name}</span>
                                <span className={css.sourceUrl}>{source.url}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  </>
                )}
          {branchesOpen && (
            <MenuSurface
              className={css.submenu}
              role="menu"
              aria-label={t('branch.title')}
              /* v8 ignore next -- the row ref is set whenever the submenu renders; the fallback only narrows the optional chain. */
              style={{ top: branchRowRef.current?.offsetTop ?? 0 }}
            >
              <div className={css.searchRow}>
                <IconSearchOutlineRegular size={16} />
                <input
                  className={css.searchInput}
                  value={query}
                  placeholder={t('branch.search')}
                  aria-label={t('branch.search')}
                  onChange={(event) => { setQuery(event.target.value) }}
                />
              </div>
              <div className={css.branchList}>
                {listing === null
                  ? <div className={css.note}>{t('state.loading')}</div>
                  : filtered.length === 0
                    ? <div className={css.note}>{t('branch.empty')}</div>
                    : filtered.map(name => (
                      <button
                        key={name}
                        type="button"
                        role="menuitemradio"
                        aria-checked={name === listing.current}
                        aria-label={name === listing.current ? t('branch.currentAria') : undefined}
                        className={css.branchRow}
                        disabled={busy}
                        onClick={() => { pick(name) }}
                      >
                        <span className={css.branchName}>{name}</span>
                        {name === listing.current && <IconCheckOutlineRegular size={14} />}
                      </button>
                    ))}
              </div>
              {creating
                ? (
                  <form className={css.createRow} onSubmit={create}>
                    <input
                      autoFocus
                      className={css.searchInput}
                      value={draft}
                      placeholder={t('branch.createPlaceholder')}
                      aria-label={t('branch.createPlaceholder')}
                      onChange={(event) => { setDraft(event.target.value) }}
                    />
                  </form>
                )
                : (
                  <button type="button" className={css.createRow} disabled={busy} onClick={() => { setCreating(true) }}>
                    <IconPlusOutlineRegular size={16} />
                    <span>{t('branch.create')}</span>
                  </button>
                )}
              {error !== null && <div className={css.error}>{error}</div>}
            </MenuSurface>
          )}
        </MenuSurface>,
        document.body,
      )}
    </>
  )
}
