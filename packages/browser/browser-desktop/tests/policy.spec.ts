import { describe, expect, it } from 'vitest'
import { BrowserError, parseBrowserOwner } from '@deepseek-ai/dsh-browser'
import { assertLease, BrowserLease, OriginPolicy } from '../src/policy.ts'

/** Policy with the given allow and deny patterns. */
function policy(spec: Partial<ConstructorParameters<typeof OriginPolicy>[0]> = {}): OriginPolicy {
  return new OriginPolicy({ defaultDecision: 'allow', allow: [], deny: [], ...spec })
}

/** Lease over a clock the test advances by hand. */
function leaseWith(clock: { at: number }, idleMs: number): BrowserLease {
  return new BrowserLease(idleMs, () => clock.at)
}

describe('OriginPolicy pattern matching', () => {
  it('matches a bare host exactly, including its subdomain exclusion', () => {
    const subject = policy({ allow: ['example.com'] })

    expect(subject.resolve('https://example.com/checkout')).toEqual({ allowed: true, reason: 'allowed by example.com' })
    expect(subject.resolve('http://example.com')).toEqual({ allowed: true, reason: 'allowed by example.com' })
    expect(subject.resolve('https://sub.example.com')).toEqual({ allowed: true, reason: 'default allow' })
  })

  it('matches a wildcard host and every subdomain but no lookalike domain', () => {
    const subject = policy({ allow: ['*.example.com'], defaultDecision: 'deny' })

    expect(subject.resolve('https://example.com')).toEqual({ allowed: true, reason: 'allowed by *.example.com' })
    expect(subject.resolve('https://a.b.example.com').allowed).toBe(true)
    expect(subject.resolve('https://notexample.com')).toEqual({ allowed: false, reason: 'default deny' })
    expect(subject.resolve('https://example.com.evil.test')).toEqual({ allowed: false, reason: 'default deny' })
  })

  it('treats a leading dot as the same wildcard form', () => {
    const subject = policy({ allow: ['.example.com'], defaultDecision: 'deny' })

    expect(subject.resolve('https://example.com').allowed).toBe(true)
    expect(subject.resolve('https://deep.example.com').allowed).toBe(true)
    expect(subject.resolve('https://other.test').allowed).toBe(false)
  })

  it('matches a full origin including scheme and port', () => {
    const subject = policy({ allow: ['https://example.com:8443'], defaultDecision: 'deny' })

    expect(subject.resolve('https://example.com:8443/app')).toEqual({
      allowed: true,
      reason: 'allowed by https://example.com:8443',
    })
    expect(subject.resolve('https://example.com').allowed).toBe(false)
    expect(subject.resolve('http://example.com:8443').allowed).toBe(false)
  })

  it('trims patterns and ignores blank ones', () => {
    const subject = policy({ allow: ['  example.com  ', '   '] })

    expect(subject.resolve('https://example.com').reason).toBe('allowed by   example.com  ')
    expect(subject.resolve('https://other.test')).toEqual({ allowed: true, reason: 'default allow' })
  })

  it('lets a deny pattern win over an allow pattern', () => {
    const subject = policy({ allow: ['example.com'], deny: ['admin.example.com'] })

    expect(subject.resolve('https://admin.example.com').allowed).toBe(false)
    expect(subject.resolve('https://admin.example.com').reason).toBe('denied by admin.example.com')
    expect(subject.resolve('https://example.com').allowed).toBe(true)
  })

  it('denies by default when no pattern matches', () => {
    const subject = policy({ defaultDecision: 'deny', allow: ['example.com'] })

    expect(subject.resolve('https://other.test')).toEqual({ allowed: false, reason: 'default deny' })
    expect(subject.resolve('https://example.com')).toEqual({ allowed: true, reason: 'allowed by example.com' })
  })

  it('refuses a URL it cannot parse as absolute', () => {
    const subject = policy()

    expect(subject.resolve('example.com/page')).toEqual({
      allowed: false,
      reason: 'unparseable url "example.com/page"',
    })
    expect(subject.resolve('')).toEqual({ allowed: false, reason: 'unparseable url ""' })
  })
})

describe('OriginPolicy.assertAllowed', () => {
  it('returns without a decision object when the policy allows the URL', () => {
    expect(() => { policy({ allow: ['example.com'] }).assertAllowed('https://example.com') }).not.toThrow()
  })

  it('throws BROWSER_ORIGIN_DENIED naming the pattern that refused', () => {
    expect(() => { policy({ deny: ['example.com'] }).assertAllowed('https://example.com') }).toThrow(
      expect.objectContaining({
        code: 'BROWSER_ORIGIN_DENIED',
        message: 'origin refused: denied by example.com',
      }),
    )
  })

  it('throws with the unparseable-URL reason for a relative URL', () => {
    expect(() => { policy().assertAllowed('/relative') }).toThrow(
      expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED', message: 'origin refused: unparseable url "/relative"' }),
    )
  })

  it('throws a typed browser error rather than a plain error', () => {
    const failure = (() => {
      try {
        policy({ defaultDecision: 'deny' }).assertAllowed('https://example.com')
        return undefined
      } catch (error) {
        return error
      }
    })()

    expect(failure).toBeInstanceOf(BrowserError)
  })
})

describe('BrowserLease', () => {
  it('grants the first claim and reports the default clock', () => {
    const lease = new BrowserLease(1_000)

    expect(lease.claim(parseBrowserOwner('session-a'))).toEqual({ granted: true })
  })

  it('keeps granting the same caller and refuses a second caller while it is active', () => {
    const clock = { at: 10_000 }
    const lease = leaseWith(clock, 5_000)
    const first = parseBrowserOwner('session-a')
    const second = parseBrowserOwner('session-b')

    expect(lease.claim(first)).toEqual({ granted: true })
    clock.at = 11_500
    expect(lease.claim(first)).toEqual({ granted: true })
    expect(lease.claim(second)).toEqual({ granted: false, holder: first, idleMs: 0 })
  })

  it('reports how long the holder has been idle to a refused caller', () => {
    const clock = { at: 1_000 }
    const lease = leaseWith(clock, 30_000)
    const first = parseBrowserOwner('session-a')
    lease.claim(first)
    clock.at = 3_400

    expect(lease.claim(parseBrowserOwner('session-b'))).toEqual({
      granted: false,
      holder: first,
      idleMs: 2_400,
    })
  })

  it('hands the lease to another caller once the holder has been idle long enough', () => {
    const clock = { at: 0 }
    const lease = leaseWith(clock, 1_000)
    const first = parseBrowserOwner('session-a')
    const second = parseBrowserOwner('session-b')
    lease.claim(first)
    clock.at = 1_000

    expect(lease.claim(second)).toEqual({ granted: true })
    expect(lease.claim(first)).toEqual({ granted: false, holder: second, idleMs: 0 })
  })

  it('extends the holder deadline on touch and ignores a non-holder touch', () => {
    const clock = { at: 0 }
    const lease = leaseWith(clock, 1_000)
    const first = parseBrowserOwner('session-a')
    const second = parseBrowserOwner('session-b')
    lease.claim(first)

    clock.at = 600
    lease.touch(second)
    clock.at = 900
    expect(lease.claim(second)).toEqual({ granted: false, holder: first, idleMs: 900 })

    lease.touch(first)
    clock.at = 1_400
    expect(lease.claim(second)).toEqual({ granted: false, holder: first, idleMs: 500 })
  })

  it('returns to an unclaimed state on release', () => {
    const clock = { at: 0 }
    const lease = leaseWith(clock, 10_000)
    lease.claim(parseBrowserOwner('session-a'))

    lease.release()
    clock.at = 50

    expect(lease.claim(parseBrowserOwner('session-b'))).toEqual({ granted: true })
  })
})

describe('assertLease', () => {
  it('claims the lease for the caller without a decision object', () => {
    const lease = new BrowserLease(1_000)

    expect(() => { assertLease(lease, parseBrowserOwner('session-a')) }).not.toThrow()
    expect(lease.claim(parseBrowserOwner('session-a'))).toEqual({ granted: true })
  })

  it('throws BROWSER_BUSY naming the holder and its rounded idle seconds', () => {
    const clock = { at: 0 }
    const lease = leaseWith(clock, 30_000)
    assertLease(lease, parseBrowserOwner('session-a'))
    clock.at = 2_400

    expect(() => { assertLease(lease, parseBrowserOwner('session-b')) }).toThrow(
      expect.objectContaining({
        code: 'BROWSER_BUSY',
        message: 'another session (session-a) is driving the browser; it was active 2s ago',
      }),
    )
  })
})
