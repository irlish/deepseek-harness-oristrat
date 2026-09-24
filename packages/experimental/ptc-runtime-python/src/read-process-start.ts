/** Linux process identity read for teardown race protection. */
import { readFileSync } from 'node:fs'

/**
 * A process's start time, as the identity half of (pid, started).
 *
 * A pid is reusable the moment the kernel reaps it, so signalling one that a
 * later process inherited would terminate an unrelated process group. Start
 * time is what distinguishes the original from its replacement: `kill(pid, 0)`
 * answers "does this number exist", which is true for both.
 *
 * Linux reads field 22 of `/proc/<pid>/stat` (starttime in clock ticks); the
 * field is positional after the comm field's closing parenthesis, which is
 * parsed from the LAST such character because a process name may contain one.
 * Darwin has no `/proc`, so the caller gets `undefined` there and `killGroup`
 * signals the pgid without the identity re-check rather than paying a `ps`
 * fork on a teardown path. Any read failure is `undefined` for the same
 * reason: this hardens a narrow race and must never break teardown.
 * @param pid - the process to read.
 * @returns its start time, or undefined when unavailable.
 */
export function readProcessStart(pid: number): string | undefined {
  /* v8 ignore next -- one arm per platform: Linux coverage takes the read path, Darwin this one. */
  if (process.platform !== 'linux') return undefined
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    // Field 22 overall; the slice above dropped pid and comm, so it is index 19.
    return fields[19]
  } catch {
    return undefined
  }
}
