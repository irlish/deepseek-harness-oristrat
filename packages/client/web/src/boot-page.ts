/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** The original Oristrat dotted-orbit mark, built without the client renderer. */
function oristratMark(): HTMLDivElement {
  const mark = div(css.brandMark)
  mark.setAttribute('aria-hidden', 'true')
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 120 120')
  for (const [count, radius, firstSize, lastSize, className] of [
    [24, 46, 3.4, 1.2, css.ringOuter],
    [18, 33, 2.6, 1.09, css.ringInner],
  ] as const) {
    const ring = document.createElementNS(SVG_NS, 'g')
    ring.setAttribute('class', className ?? '')
    for (let index = 0; index < count; index += 1) {
      const angle = ((171 + index * 360 / count) * Math.PI) / 180
      const circle = document.createElementNS(SVG_NS, 'circle')
      circle.setAttribute('cx', String(60 + radius * Math.cos(angle)))
      circle.setAttribute('cy', String(60 + radius * Math.sin(angle)))
      circle.setAttribute('r', String(firstSize + (lastSize - firstSize) * index / (count - 1)))
      circle.style.setProperty('--i', String(index))
      ring.append(circle)
    }
    svg.append(ring)
  }
  const hex = document.createElementNS(SVG_NS, 'g')
  hex.setAttribute('class', css.hex ?? '')
  const vertices = [[60, 43], [45.3, 51.5], [45.3, 68.5], [60, 77], [74.7, 68.5], [74.7, 51.5]]
  const polygon = document.createElementNS(SVG_NS, 'polygon')
  polygon.setAttribute('points', vertices.map(([x, y]) => `${x},${y}`).join(' '))
  hex.append(polygon)
  for (const [x, y] of vertices) {
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', '60')
    line.setAttribute('y1', '60')
    line.setAttribute('x2', String(x))
    line.setAttribute('y2', String(y))
    hex.append(line)
  }
  svg.append(hex)
  const nodes = document.createElementNS(SVG_NS, 'g')
  nodes.setAttribute('class', css.nodes ?? '')
  for (const [x, y] of [...vertices, [60, 60]]) {
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.setAttribute('cx', String(x))
    circle.setAttribute('cy', String(y))
    circle.setAttribute('r', x === 60 && y === 60 ? '2.4' : '2.1')
    nodes.append(circle)
  }
  svg.append(nodes)
  mark.append(svg)
  return mark
}

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly mark: HTMLDivElement
  private readonly wordmark: HTMLDivElement
  private readonly spinner: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly states = new Map<string, LoaderEntryState>()
  private readonly active = new Set<string>()
  private total = 0
  private failure: string | undefined

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.dshBoot = ''
    this.card = div(css.card)
    this.mark = oristratMark()
    this.wordmark = div(css.wordmark, 'Oristrat AI')
    this.wordmark.append(div(css.badge, 'STEM'))
    this.spinner = div(css.spinner)
    this.spinner.dataset.dshBootSpinner = ''
    this.hint = div(css.hint, 'Loading plugins…')
    this.card.append(this.mark, this.wordmark, this.spinner, this.hint)
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Set the number of loader entries represented by the progress arc.
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      if (this.spinner.parentElement !== this.card) {
        this.card.replaceChildren(this.mark, this.wordmark, this.spinner, this.hint)
      }
      return
    }
    const report = div(css.failed)
    report.append(div(css.failedTitle, 'Failed to load plugins'))
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.wordmark, report)
  }

  /** Grow the rotating arc monotonically as loader entries activate. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    this.spinner.style.setProperty('--dsh-boot-arc', `${String(Math.round(72 + ratio * 216))}deg`)
  }
}
