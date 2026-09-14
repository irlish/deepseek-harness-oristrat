/**
 * Glyph of the terminal tab type: the screen-with-prompt mark used by the
 * guide capsule and the tab chip.
 */
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * The terminal mark: prompt chevron and caret line inside a screen outline.
 * @param props - icon size and class seat shared with the primitive icons.
 * @returns the glyph svg.
 */
export function TerminalGlyph({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="1" y="2.5" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 6.5L6.5 8.5L4 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 10.5H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
