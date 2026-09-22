/**
 * The browser type's own glyph: a globe mark drawn on currentColor, sized
 * like the neighboring tab icons.
 */
import type { ReactNode } from 'react'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Draw the globe glyph.
 * @param props - size and class of the mark.
 * @returns the inline svg.
 */
export function BrowserGlyph({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm9.5-4.9A6.4 6.4 0 0 1 12.4 5.5h-2.2c-.2-.9-.45-1.75-.7-2.4Zm-3 0c-.25.65-.5 1.5-.7 2.4H3.6A6.4 6.4 0 0 1 6.5 3.1ZM2.9 7h2.4a13 13 0 0 0 0 2H2.9a6.3 6.3 0 0 1 0-2Zm3.9 0h2.4a13 13 0 0 1 0 2H6.8a13 13 0 0 1 0-2Zm3.9 0h2.4a6.3 6.3 0 0 1 0 2h-2.4a13 13 0 0 0 0-2ZM5.8 10.5h2.2c.2.9.45 1.75.7 2.4a6.4 6.4 0 0 1-2.9-2.4Zm3.7 0h2.2a6.4 6.4 0 0 1-2.9 2.4c.25-.65.5-1.5.7-2.4Z"
        fill="currentColor"
      />
    </svg>
  )
}
