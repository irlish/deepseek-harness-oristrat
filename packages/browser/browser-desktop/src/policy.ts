/**
 * Access policy for the browser view: which origins the agent may drive, and
 * which caller may drive the single view at a time.
 *
 * Both decisions are enforced where the operation happens — the origin check
 * runs on every navigation and every action, the lease is claimed by every
 * request — rather than by filtering tool schemas, which any second caller
 * could bypass.
 * @module
 */

import { BrowserError, type BrowserOwner } from '@deepseek-ai/dsh-browser'

/** Origin access policy as configured for a deployment. */
export interface OriginPolicySpec {
  /** Decision for an origin no pattern matches. */
  readonly defaultDecision: 'allow' | 'deny'
  /** Patterns that grant access. */
  readonly allow: readonly string[]
  /** Patterns that refuse access; they win over `allow`. */
  readonly deny: readonly string[]
}

/** One policy decision. */
export interface OriginDecision {
  readonly allowed: boolean
  /** Pattern or default that produced the decision. */
  readonly reason: string
}

/**
 * Origin policy over host and origin patterns.
 *
 * A pattern matches one of three ways: a bare host (`example.com`) matches that
 * host only, a wildcard host (`*.example.com` or `.example.com`) matches that
 * host and any subdomain, and a full origin (`https://example.com:8443`)
 * matches an exact scheme, host, and port.
 */
export class OriginPolicy {
  /**
   * @param spec - configured allow and deny patterns with their default.
   */
  constructor(private readonly spec: OriginPolicySpec) {}

  /**
   * Decide whether the agent may drive one URL.
   * @param url - URL the view is on or is being sent to.
   * @returns the decision with the pattern that produced it; a URL that cannot
   *   be parsed as an absolute URL is refused, because the policy cannot speak
   *   about it.
   */
  resolve(url: string): OriginDecision {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { allowed: false, reason: `unparseable url ${JSON.stringify(url)}` }
    }
    for (const pattern of this.spec.deny) {
      if (matches(pattern, parsed)) return { allowed: false, reason: `denied by ${pattern}` }
    }
    for (const pattern of this.spec.allow) {
      if (matches(pattern, parsed)) return { allowed: true, reason: `allowed by ${pattern}` }
    }
    return {
      allowed: this.spec.defaultDecision === 'allow',
      reason: `default ${this.spec.defaultDecision}`,
    }
  }

  /**
   * Refuse one URL unless the policy allows it.
   * @param url - URL about to be navigated to or acted on.
   * @throws BrowserError with `BROWSER_ORIGIN_DENIED` when the policy refuses.
   */
  assertAllowed(url: string): void {
    const decision = this.resolve(url)
    if (!decision.allowed) {
      throw new BrowserError(`origin refused: ${decision.reason}`, 'BROWSER_ORIGIN_DENIED')
    }
  }
}

/**
 * Test one pattern against a parsed URL.
 * @param pattern - configured pattern.
 * @param url - parsed URL under test.
 * @returns whether the pattern matches.
 */
function matches(pattern: string, url: URL): boolean {
  const trimmed = pattern.trim()
  if (trimmed === '') return false
  if (trimmed.includes('://')) return url.origin === new URL(trimmed).origin
  const wildcard = trimmed.startsWith('*.') || trimmed.startsWith('.')
  const host = wildcard ? trimmed.replace(/^\*?\./u, '') : trimmed
  if (wildcard) return url.hostname === host || url.hostname.endsWith(`.${host}`)
  return url.hostname === host
}

/** One lease decision. */
export type LeaseDecision = { readonly granted: true } | {
  readonly granted: false
  readonly holder: BrowserOwner
  readonly idleMs: number
}

/**
 * Single-owner lease over the browser view.
 *
 * One view exists per application window, so two sessions must not interleave
 * commands in it. The first caller owns the lease, the same caller keeps it,
 * and a different caller may take it only after the holder has been idle long
 * enough that it is no longer plausibly mid-test.
 */
export class BrowserLease {
  private holder: BrowserOwner | undefined
  private lastUsed = 0

  /**
   * @param idleMs - idle time after which another caller may take the lease.
   * @param now - clock, injectable for tests.
   */
  constructor(
    private readonly idleMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Claim or refresh the lease for one caller.
   * @param owner - caller asking to drive the view.
   * @returns whether the lease was granted, and who holds it when it was not.
   */
  claim(owner: BrowserOwner): LeaseDecision {
    const at = this.now()
    if (this.holder === undefined || this.holder === owner) {
      this.holder = owner
      this.lastUsed = at
      return { granted: true }
    }
    const idle = at - this.lastUsed
    if (idle >= this.idleMs) {
      this.holder = owner
      this.lastUsed = at
      return { granted: true }
    }
    return { granted: false, holder: this.holder, idleMs: idle }
  }

  /**
   * Record activity so an idle holder keeps the lease through a long test.
   * @param owner - caller that just used the view.
   */
  touch(owner: BrowserOwner): void {
    if (this.holder === owner) this.lastUsed = this.now()
  }

  /** Release the lease when the view goes away. */
  release(): void {
    this.holder = undefined
    this.lastUsed = 0
  }
}

/**
 * Refuse a request whose caller cannot drive the view right now.
 * @param lease - lease over the browser view.
 * @param owner - caller making the request.
 * @throws BrowserError with `BROWSER_BUSY` when another caller holds the lease.
 */
export function assertLease(lease: BrowserLease, owner: BrowserOwner): void {
  const decision = lease.claim(owner)
  if (!decision.granted) {
    const seconds = Math.round(decision.idleMs / 1000)
    throw new BrowserError(
      `another session (${decision.holder}) is driving the browser; it was active ${String(seconds)}s ago`,
      'BROWSER_BUSY',
    )
  }
}
