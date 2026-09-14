import { OristratMark } from './OristratMark.tsx'

/** Display options for the composed Oristrat brand identity. */
export interface OristratBrandProps {
  /** Mark width in px (default 24; height keeps the mark ratio). */
  size?: number
  /** Extra class for layout placement. */
  className?: string
  /** Whether to include the leading mark; defaults to true. Hosts that slot the mark separately pass false. */
  includeMark?: boolean
}

/**
 * Render the composed Oristrat identity: the hexagon-network mark, the
 * "Oristrat AI" name, and the "STEM" emphasis badge. The badge pairs the
 * primary ink token as its fill with the inverted label token as its text,
 * the same pair the sidebar version capsule used, so light and dark themes
 * both read as a solid emphasis chip.
 * @param props.size - mark width in px (default 24).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading mark.
 * @returns the brand row (aria-label carries the full name; inner art is decorative).
 */
export function OristratBrand({ size = 24, className, includeMark = true }: OristratBrandProps) {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(6, Math.round(size * 0.28)) }}
      aria-label="Oristrat AI STEM"
    >
      {includeMark ? <OristratMark size={size} /> : null}
      <span
        style={{
          fontSize: Math.round(size * 0.72),
          fontWeight: 600,
          letterSpacing: '0.02em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >Oristrat AI</span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: 'var(--dsw-alias-label-primary)',
          color: 'var(--dsw-alias-label-primary-inverted)',
          borderRadius: Math.max(3, Math.round(size * 0.14)),
          padding: `${Math.max(2, Math.round(size * 0.1))}px ${Math.max(4, Math.round(size * 0.22))}px`,
          fontSize: Math.max(9, Math.round(size * 0.45)),
          fontWeight: 700,
          letterSpacing: '0.05em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
        aria-hidden="true"
      >STEM</span>
    </span>
  )
}
