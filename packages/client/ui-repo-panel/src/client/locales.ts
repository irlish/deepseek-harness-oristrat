/** `repo-panel` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'repo-panel'

/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
  'type.label': '环境',
  'guide.title': '仓库环境',
  'guide.description': '当前分支、变更统计与远端来源',
  'row.branch': '分支',
  'row.changes': '变更',
  'row.local': '本地',
  'row.sources': '来源',
  'value.aheadBehind': '领先 {ahead} · 落后 {behind}',
  'value.ahead': '领先 {ahead}',
  'value.behind': '落后 {behind}',
  'value.changes': '+{additions} -{deletions} · {files} 个文件',
  'state.clean': '工作区干净',
  'state.noRepo': '当前目录不是 Git 仓库',
  'state.loading': '正在读取仓库状态…',
  'state.error': '读取失败：{message}',
  'sources.none': '未配置远端',
  'action.refresh': '刷新',
} as const

/** English dictionary, keyed by the Chinese key set. */
const en: Record<keyof typeof zh, string> = {
  'type.label': 'Environment',
  'guide.title': 'Repository environment',
  'guide.description': 'Current branch, change totals, and remote sources',
  'row.branch': 'Branch',
  'row.changes': 'Changes',
  'row.local': 'Local',
  'row.sources': 'Sources',
  'value.aheadBehind': '{ahead} ahead · {behind} behind',
  'value.ahead': '{ahead} ahead',
  'value.behind': '{behind} behind',
  'value.changes': '+{additions} -{deletions} · {files} files',
  'state.clean': 'Working tree clean',
  'state.noRepo': 'This directory is not a git repository',
  'state.loading': 'Reading repository state…',
  'state.error': 'Read failed: {message}',
  'sources.none': 'No remotes configured',
  'action.refresh': 'Refresh',
}

/** Dictionary keys of the {@link NS} namespace. */
export type RepoPanelKey = keyof typeof zh

export { en, zh }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Repo type name, guide entry, row labels, and read states. */
    'repo-panel': RepoPanelKey
  }
}
