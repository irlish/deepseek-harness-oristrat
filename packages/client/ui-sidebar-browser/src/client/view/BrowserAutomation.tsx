/** Human controls for the Chromium browser owned by this Session. */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BrowserAutomationAction, BrowserAutomationConnection, BrowserAutomationResult } from '@oristrat/dsh-browser-use-chrome-devtools-mcp/types'
import type { BrowserBodyProps } from './BrowserBody.tsx'
import css from './Browser.module.css'

type Props = Pick<BrowserBodyProps, 't' | 'automationConfiguration' | 'performAutomation'> & {
  readonly url: string
  readonly signal: AbortSignal
}

/**
 * Render connection verification and page controls; responses are retained after an unsuccessful operation.
 * @param props - localized controls and Session-bound operation callbacks.
 * @returns the expandable browser control panel.
 */
export function BrowserAutomation(props: Props): ReactNode {
  const { t, signal } = props
  const [expanded, setExpanded] = useState(false)
  const [connection, setConnection] = useState<BrowserAutomationConnection>()
  const [status, setStatus] = useState<BrowserAutomationResult['status'] | 'idle' | 'connection-failed'>('idle')
  const [output, setOutput] = useState('')
  const [pending, setPending] = useState(false)
  const operation = useRef(false)
  const [uid, setUid] = useState('')
  const [value, setValue] = useState('')
  const [pageId, setPageId] = useState('')
  const active = (): boolean => !signal.aborted
  const run = async (action?: BrowserAutomationAction): Promise<void> => {
    if (operation.current || !active()) return
    operation.current = true
    setPending(true)
    try {
      if (action === undefined) {
        const configured = await props.automationConfiguration?.(signal)
        if (!active()) return
        setConnection(configured)
        setStatus(configured === undefined ? 'unavailable' : 'idle')
      } else {
        const result = await props.performAutomation?.(action, signal)
        if (!active()) return
        setStatus(result?.status ?? 'unavailable')
        if (result !== undefined) {
          setConnection(result.connection)
          if (result.text) setOutput(result.text)
        }
      }
    } catch (_error) {
      // Remote errors leave the last observed page visible; a fresh check is required before another action.
      if (active()) setStatus('connection-failed')
    } finally {
      operation.current = false
      if (active()) setPending(false)
    }
  }
  const disabled = pending || signal.aborted
  return <section className={css.automation} aria-label={t('automation.title')}>
    <button type="button" className={css.automationToggle} aria-expanded={expanded} onClick={() => {
      setExpanded(!expanded)
      if (!expanded && connection === undefined) void run()
    }}>{t('automation.title')}<span>{t(`automation.${status}`)}</span></button>
    {expanded && <div className={css.automationBody} aria-busy={pending}>
      <p className={css.automationHint}>{t('automation.description')}</p>
      {connection !== undefined && <p className={css.automationHint}>
        {t(`automation.mode.${connection.mode}`)}{connection.endpoint ? ` · ${connection.endpoint}` : ''}
      </p>}
      <p className={css.automationHint}>{t('automation.configure')}</p>
      <div className={css.automationActions}>
        <Button size="sm" disabled={disabled} onClick={() => { void run({ kind: 'pages' }) }}>{t('automation.connect')}</Button>
        <Button size="sm" disabled={disabled || !props.url.trim()} onClick={() => { void run({ kind: 'navigate', url: props.url }) }}>{t('automation.open')}</Button>
        <Button size="sm" disabled={disabled || !/^\d+$/u.test(pageId)} onClick={() => { void run({ kind: 'observe', pageId: Number(pageId) }) }}>{t('automation.observe')}</Button>
      </div>
      <form className={css.automationActions} onSubmit={(event) => { event.preventDefault(); void run({ kind: 'select', pageId: Number(pageId) }) }}>
        <input className={css.automationInput} aria-label={t('automation.pageId')} placeholder={t('automation.pageId')} value={pageId} inputMode="numeric" onChange={(event) => { setPageId(event.currentTarget.value) }} />
        <Button size="sm" type="submit" disabled={disabled || !/^\d+$/u.test(pageId)}>{t('automation.select')}</Button>
      </form>
      <div className={css.automationActions}>
        <input className={css.automationInput} aria-label={t('automation.uid')} placeholder={t('automation.uid')} value={uid} onChange={(event) => { setUid(event.currentTarget.value) }} />
        <Button size="sm" disabled={disabled || !uid.trim() || !/^\d+$/u.test(pageId)} onClick={() => { void run({ kind: 'click', pageId: Number(pageId), uid: uid.trim() }) }}>{t('automation.click')}</Button>
      </div>
      <div className={css.automationActions}>
        <input className={css.automationInput} aria-label={t('automation.value')} placeholder={t('automation.value')} value={value} onChange={(event) => { setValue(event.currentTarget.value) }} />
        <Button size="sm" disabled={disabled || !uid.trim() || !/^\d+$/u.test(pageId)} onClick={() => { void run({ kind: 'fill', pageId: Number(pageId), uid: uid.trim(), value }) }}>{t('automation.fill')}</Button>
      </div>
      {status !== 'idle' && <p className={css.automationHint} role={status === 'connected' ? 'status' : 'alert'}>{t(`automation.${status}`)}</p>}
      {output && <pre className={css.automationOutput} aria-label={t('automation.output')}>{output}</pre>}
    </div>}
  </section>
}
