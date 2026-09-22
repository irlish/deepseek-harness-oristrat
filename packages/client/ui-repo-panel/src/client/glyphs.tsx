/**
 * The repo type's own glyph: a two-node branch mark drawn on currentColor,
 * sized like the neighboring tab icons.
 */
import type { ReactNode } from 'react'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Draw the branch glyph.
 * @param props - size and class of the mark.
 * @returns the inline svg.
 */
export function RepoGlyph({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M4.5 2.75a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5ZM1.25 4.5a3.25 3.25 0 1 1 4.6 2.94v.12a3.25 3.25 0 0 1 3.25 3.25v.7a3.25 3.25 0 1 1-1.5 0v-.7A1.75 1.75 0 0 0 5.85 9.06H4.6a3.25 3.25 0 0 1-3.25-3.25v-.02A3.26 3.26 0 0 1 1.25 4.5Zm6.4 5.69a1.75 1.75 0 1 0 1.5 0v-.01a1.7 1.7 0 0 0-.75-.18c-.26 0-.51.07-.75.19Z"
        fill="currentColor"
      />
      <path
        d="M11.5 2.75a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5ZM8.25 4.5a3.25 3.25 0 1 1 4.75 2.94v.62a3.25 3.25 0 0 1-1.5 0V7.44A1.75 1.75 0 0 1 9.75 4.5H8.25Z"
        fill="currentColor"
      />
    </svg>
  )
}
