/** `terminal-panel` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'terminal-panel'

/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
  'type.label': '终端',
  'guide.title': '终端',
  'guide.description': '交互式 shell 终端，支持多页签',
  'panel.dead': '终端进程已退出',
  'panel.opening': '正在启动终端…',
  'panel.error': '终端连接失败：{detail}',
} as const

/** English dictionary, keyed by the Chinese key set. */
const en: Record<keyof typeof zh, string> = {
  'type.label': 'Terminal',
  'guide.title': 'Terminal',
  'guide.description': 'Interactive shell terminal with multiple tabs',
  'panel.dead': 'Terminal process exited',
  'panel.opening': 'Starting terminal…',
  'panel.error': 'Terminal connection failed: {detail}',
}

/** Dictionary keys of the {@link NS} namespace. */
export type TerminalPanelKey = keyof typeof zh

export { en, zh }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Terminal type name, guide entry, tab labels, and connection states. */
    'terminal-panel': TerminalPanelKey
  }
}
