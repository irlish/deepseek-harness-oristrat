/**
 * The terminal tab's content: one xterm session filling one right Sidebar
 * pane, bound to one host PTY for the tab's mount lifetime. Multiple terminals
 * are the Sidebar's own tabs: each page of this type mounts its own body and
 * therefore its own PTY; closing a tab terminates its PTY.
 */

import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {
  GuiTerminalCloseRequest, GuiTerminalOpenRequest, GuiTerminalOpenValue, GuiTerminalOutputRequest,
  GuiTerminalReadValue, GuiTerminalWriteRequest,
} from '@deepseek-ai/dsh-api-gui-terminal/types'
import type {} from './locales.ts'
import { XTERM_CSS } from './xterm-css.ts'
import css from './TerminalPanel.module.css'

/** Host gui-terminal operations this pane drives, as plain callbacks. */
export interface TerminalPaneInjected {
  /** Spawn one interactive shell PTY. */
  openTerminal: (request: GuiTerminalOpenRequest) => Promise<GuiTerminalOpenValue>
  /** Forward raw terminal input bytes. */
  writeTerminal: (request: GuiTerminalWriteRequest) => Promise<void>
  /** Poll retained output from a cursor. */
  readTerminal: (request: GuiTerminalOutputRequest) => Promise<GuiTerminalReadValue>
  /** Terminate the session's PTY. */
  closeTerminal: (request: GuiTerminalCloseRequest) => Promise<void>
}

let xtermCssInstalled = false

/** Append the xterm stylesheet once per document. */
function installXtermCss(): void {
  if (xtermCssInstalled) return
  xtermCssInstalled = true
  const style = document.createElement('style')
  style.textContent = XTERM_CSS
  document.head.appendChild(style)
}

/** Lifecycle of the pane's PTY connection, visible under the screen. */
type PaneStatus = 'opening' | 'live' | 'dead' | 'error'

/** Props of the pane body: the injected host face, the session workspace
 * root the PTY starts in, and the section copy. */
export type TerminalPaneProps = TerminalPaneInjected & {
  t: TranslateNS<'terminal-panel'>
  /** Absolute workspace root of the owning session; server cwd when absent. */
  cwd?: string | undefined
}

/**
 * One xterm session bound to one host PTY for the Sidebar tab's lifetime.
 * @param props - injected host terminal callbacks and localized copy.
 * @returns the screen plus its connection-state line.
 */
export function TerminalPane({ openTerminal, writeTerminal, readTerminal, closeTerminal, t, cwd }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const fitRef = useRef<(() => void) | undefined>(undefined)
  const sessionRef = useRef<string | undefined>(undefined)
  const [status, setStatus] = useState<PaneStatus>('opening')
  const [detail, setDetail] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
    installXtermCss()
    const lifetime = { disposed: false }
    let term: Terminal | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let observer: ResizeObserver | undefined
    void (async () => {
      const opened = await openTerminal({ ...cwd === undefined ? {} : { cwd } })
      sessionRef.current = opened.id
      if (lifetime.disposed) {
        void closeTerminal({ id: opened.id })
        return
      }
      const styles = getComputedStyle(host)
      const activeTerm = new Terminal({
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        cursorBlink: true,
        theme: {
          background: styles.getPropertyValue('--term-bg').trim() || '#ffffff',
          foreground: styles.getPropertyValue('--term-fg').trim() || '#111111',
        },
      })
      term = activeTerm
      activeTerm.open(host)
      const fit = new FitAddon()
      activeTerm.loadAddon(fit)
      const refit = (): void => {
        try {
          fit.fit()
        } catch {
          /* v8 ignore next -- fit throws only on a detached renderer */
        }
      }
      fitRef.current = refit
      refit()
      // Pane width moves with the sidebar drag, which fires no window resize.
      observer = new ResizeObserver(() => { refit() })
      observer.observe(host)
      activeTerm.onData((data) => {
        void writeTerminal({ id: opened.id, data })
      })
      for (const frame of opened.scrollback) activeTerm.write(frame.data)
      let cursor = opened.cursor
      setStatus('live')
      timer = setInterval(() => {
        readTerminal({ id: opened.id, cursor }).then((result) => {
          if (lifetime.disposed) return
          for (const frame of result.frames) activeTerm.write(frame.data)
          cursor = result.cursor
          if (!result.alive && result.frames.length === 0) {
            if (timer !== undefined) clearInterval(timer)
            setStatus('dead')
          }
        }, (error: unknown) => {
          if (lifetime.disposed) return
          if (timer !== undefined) clearInterval(timer)
          setDetail(String(error))
          setStatus('error')
        })
      }, 60)
    })().catch((error: unknown) => {
      if (lifetime.disposed) return
      setDetail(String(error))
      setStatus('error')
    })
    return () => {
      lifetime.disposed = true
      if (timer !== undefined) clearInterval(timer)
      if (observer !== undefined) observer.disconnect()
      fitRef.current = undefined
      if (term !== undefined) term.dispose()
      const id = sessionRef.current
      if (id !== undefined) void closeTerminal({ id })
    }
    // The pane mounts once per Sidebar tab; the PTY dies with the tab.
  }, [])

  useEffect(() => {
    fitRef.current?.()
  }, [])

  return (
    <div className={css.pane}>
      <div ref={hostRef} className={css.termHost} />
      {status === 'opening' ? <div className={css.stateNote}>{t('panel.opening')}</div> : null}
      {status === 'dead' ? <div className={css.stateNote}>{t('panel.dead')}</div> : null}
      {status === 'error'
        ? <div className={css.stateNote}>{t('panel.error', { detail })}</div>
        : null}
    </div>
  )
}
