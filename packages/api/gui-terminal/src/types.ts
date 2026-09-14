/** Wire types of the browser-interactive terminal Remote namespace. */

/** One retained output frame of a GUI terminal session. */
export interface GuiTerminalOutputFrame {
  /** Monotonic per-session frame sequence, starting at 0. */
  seq: number
  /** UTF-8 PTY output bytes in delivery order. */
  data: string
}

/** Open request for one browser terminal session. */
export interface GuiTerminalOpenRequest {
  /** Absolute working directory; the server process cwd when absent. */
  cwd?: string
  /** Initial PTY columns (default 120). */
  cols?: number
  /** Initial PTY rows (default 30). */
  rows?: number
}

/** Identity and retained output of a freshly opened session. */
export interface GuiTerminalOpenValue {
  /** Opaque session id. */
  id: string
  /** Retained output frames present at open time, in order. */
  scrollback: GuiTerminalOutputFrame[]
  /** Cursor just past the last scrollback frame. */
  cursor: number
}

/** Keystroke write request. */
export interface GuiTerminalWriteRequest {
  /** Session id from {@link GuiTerminalOpenValue}. */
  id: string
  /** Raw terminal input bytes. */
  data: string
}

/** Session close request. */
export interface GuiTerminalCloseRequest {
  /** Session id from {@link GuiTerminalOpenValue}. */
  id: string
}

/** Liveness summary of one session. */
export interface GuiTerminalSessionSummary {
  /** Opaque session id. */
  id: string
  /** Whether the top-level PTY process is still running. */
  alive: boolean
}

/** Stream request: retained frames from a cursor, then live output. */
export interface GuiTerminalOutputRequest {
  /** Session id from {@link GuiTerminalOpenValue}. */
  id: string
  /** First frame sequence the caller still needs. */
  cursor: number
}

/** Poll result: retained frames from a cursor plus liveness. */
export interface GuiTerminalReadValue {
  /** Frames at or after the request cursor, in order. */
  frames: GuiTerminalOutputFrame[]
  /** Cursor just past the last returned frame. */
  cursor: number
  /** Whether the top-level PTY process is still running. */
  alive: boolean
}
