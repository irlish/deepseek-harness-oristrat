/** `browser-panel` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'browser-panel'

/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
  'type.label': '浏览器',
  'guide.title': '内嵌浏览器',
  'guide.description': '在右侧栏中浏览网页',
  'url.placeholder': '输入网址，回车打开',
  'action.back': '后退',
  'action.forward': '前进',
  'action.reload': '刷新',
  'state.desktopOnly': '内嵌浏览器仅在桌面客户端可用',
  'state.blank': '输入网址开始浏览',
  'state.error': '打开失败：{message}',
  'activity.running': 'Agent 正在控制浏览器',
  'activity.idle': '自动化空闲',
  'activity.method': '操作：{method}',
} as const

/** English dictionary, keyed by the Chinese key set. */
const en: Record<keyof typeof zh, string> = {
  'type.label': 'Browser',
  'guide.title': 'Embedded browser',
  'guide.description': 'Browse the web inside the right sidebar',
  'url.placeholder': 'Enter a URL and press Enter',
  'action.back': 'Back',
  'action.forward': 'Forward',
  'action.reload': 'Reload',
  'state.desktopOnly': 'The embedded browser is available in the desktop app only',
  'state.blank': 'Enter a URL to start browsing',
  'state.error': 'Open failed: {message}',
  'activity.running': 'The agent is driving this browser',
  'activity.idle': 'Automation idle',
  'activity.method': 'Action: {method}',
}

/** Dictionary keys of the {@link NS} namespace. */
export type BrowserPanelKey = keyof typeof zh

export { en, zh }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Browser type name, guide entry, toolbar labels, pane states, and automation activity. */
    'browser-panel': BrowserPanelKey
  }
}
