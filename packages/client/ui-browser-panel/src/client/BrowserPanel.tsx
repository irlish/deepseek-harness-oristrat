/**
 * BrowserPanel: the embedded-browser pane. The desktop main process owns the
 * WebContentsView; this component owns its placement — it measures the
 * surface element through its offset chain, opens (or re-attaches) the view
 * over it, and re-pushes bounds while the pane resizes, scrolls, or the
 * window changes. Unmounting hides the view instead of destroying it, so a
 * tab switch keeps the loaded document and history for the next mount. The
 * toolbar drives history; the address bar navigates on Enter. On the plain
 * web host, where no bridge exists, the pane explains the desktop-only
 * surface instead.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BrowserActivity, BrowserState, DesktopBrowserBridge } from './bridge.ts'
import { boundsFromLayout, normalizeUrlInput } from './bridge.ts'
import type {} from './locales.ts'
import css from './BrowserPanel.module.css'

/** The panel's injected desktop bridge seat. */
export interface BrowserPanelInjected {
  /** The desktop embedded-browser face; undefined on the plain web host. */
  bridge: DesktopBrowserBridge | undefined
}

/** The panel's composed props: injected bridge and copy. */
export type BrowserPanelProps = PropsLocale<'browser-panel'> & BrowserPanelInjected

/** Bridge rejections are surface noise: the next state push re-syncs the pane. */
function ignoreBridgeError(_error: unknown): void {}

/**
 * Draw the embedded-browser pane.
 * @param props - injected desktop bridge and localized copy.
 * @returns the toolbar above the measured view surface.
 */
export function BrowserPanel({ t, bridge }: BrowserPanelProps): ReactNode {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const bridgeRef = useRef(bridge)
  bridgeRef.current = bridge
  const [state, setState] = useState<BrowserState | null>(null)
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState<string | null>(null)
  const [activity, setActivity] = useState<BrowserActivity | null>(null)

  const pushBounds = useCallback((): void => {
    const active = bridgeRef.current
    const element = surfaceRef.current
    /* v8 ignore next -- pushers only run while the bridge is attached and the surface is mounted. */
    if (active === undefined || element === null) return
    active.setBounds(boundsFromLayout(element)).catch(ignoreBridgeError)
  }, [])

  useEffect(() => {
    const active = bridgeRef.current
    if (active === undefined) return
    const element = surfaceRef.current
    /* v8 ignore next -- the surface ref is attached before the effect runs. */
    if (element === null) return
    const unsubscribe = active.subscribe(setState)
    const unsubscribeActivity = active.subscribeActivity(setActivity)
    active.open(boundsFromLayout(element)).catch(ignoreBridgeError)
    // The pane's open animation transforms the painted position without
    // resizing the surface; a delayed push lands the view at the settled
    // layout box even when no observer fires afterwards.
    const settle = setTimeout(() => { pushBounds() }, 300)
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { pushBounds() })
      : undefined
    observer?.observe(element)
    window.addEventListener('resize', pushBounds)
    window.addEventListener('scroll', pushBounds, true)
    return () => {
      unsubscribe()
      unsubscribeActivity()
      clearTimeout(settle)
      observer?.disconnect()
      window.removeEventListener('resize', pushBounds)
      window.removeEventListener('scroll', pushBounds, true)
      active.hide().catch(ignoreBridgeError)
    }
  }, [pushBounds])

  const go = (event: FormEvent): void => {
    event.preventDefault()
    const active = bridgeRef.current
    const url = normalizeUrlInput(draft)
    if (active === undefined || url === undefined) return
    setFailed(null)
    active.navigate(url).catch((error: unknown) => {
      setFailed(error instanceof Error ? error.message : String(error))
    })
  }

  if (bridge === undefined) {
    return (
      <div className={css.panel}>
        <div className={css.notice}>{t('state.desktopOnly')}</div>
      </div>
    )
  }

  // A const copy keeps the undefined check inside the JSX callbacks.
  const desktop = bridge
  return (
    <div className={css.panel}>
      <div className={css.toolbar}>
        <button type="button" className={css.tool} aria-label={t('action.back')} disabled={state?.canGoBack !== true} onClick={() => { desktop.back().catch(ignoreBridgeError) }}>
          <IconChevronLeftOutlineRegular size={14} />
        </button>
        <button type="button" className={css.tool} aria-label={t('action.forward')} disabled={state?.canGoForward !== true} onClick={() => { desktop.forward().catch(ignoreBridgeError) }}>
          <IconChevronRightOutlineRegular size={14} />
        </button>
        <button type="button" className={css.tool} aria-label={t('action.reload')} onClick={() => { desktop.reload().catch(ignoreBridgeError) }}>
          <IconRefreshOutlineRegular size={14} />
        </button>
        <form className={css.address} onSubmit={go}>
          <input
            type="text"
            className={css.addressInput}
            value={draft}
            placeholder={state?.url === '' || state === null ? t('url.placeholder') : state.url}
            aria-label={t('url.placeholder')}
            onChange={(event) => { setDraft(event.target.value) }}
          />
        </form>
      </div>
      {activity?.active === true && (
        <div className={css.activity} role="status">
          <span className={css.activityDot} aria-hidden="true" />
          <span className={css.activityLabel}>{t('activity.running')}</span>
          <span className={css.activityMethod}>{t('activity.method', { method: activity.method })}</span>
        </div>
      )}
      {failed !== null && <div className={css.error}>{t('state.error', { message: failed })}</div>}
      <div ref={surfaceRef} className={css.surface}>
        {state?.url === '' && <div className={css.notice}>{t('state.blank')}</div>}
      </div>
    </div>
  )
}
