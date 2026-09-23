/** `repo-panel` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'repo-panel'

/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
  'action.aria': '仓库环境',
  'action.tooltip': '仓库环境与分支',
  'menu.title': '环境信息',
  'row.branch': '分支',
  'row.changes': '变更',
  'row.local': '本地',
  'row.sources': '来源',
  'value.aheadBehind': '领先 {ahead} · 落后 {behind}',
  'value.ahead': '领先 {ahead}',
  'value.behind': '落后 {behind}',
  'value.changes': '+{additions} -{deletions} · {files} 个文件',
  'state.clean': '工作区干净',
  'state.noRepo': '当前工作区不是 Git 仓库',
  'state.loading': '正在读取仓库状态…',
  'state.error': '读取失败：{message}',
  'state.noSession': '会话未关联工作区',
  'sources.none': '未配置远端',
  'branch.title': '切换分支',
  'branch.search': '搜索分支',
  'branch.create': '创建并检出新分支…',
  'branch.createPlaceholder': '新分支名，回车创建',
  'branch.empty': '没有匹配的分支',
  'branch.currentAria': '当前分支',
  'error.fallback': '操作失败',
} as const

/** English dictionary, keyed by the Chinese key set. */
const en: Record<keyof typeof zh, string> = {
  'action.aria': 'Repository environment',
  'action.tooltip': 'Repository environment and branches',
  'menu.title': 'Environment',
  'row.branch': 'Branch',
  'row.changes': 'Changes',
  'row.local': 'Local',
  'row.sources': 'Sources',
  'value.aheadBehind': '{ahead} ahead · {behind} behind',
  'value.ahead': '{ahead} ahead',
  'value.behind': '{behind} behind',
  'value.changes': '+{additions} -{deletions} · {files} files',
  'state.clean': 'Working tree clean',
  'state.noRepo': 'This workspace is not a git repository',
  'state.loading': 'Reading repository state…',
  'state.error': 'Read failed: {message}',
  'state.noSession': 'The session has no workspace',
  'sources.none': 'No remotes configured',
  'branch.title': 'Switch branch',
  'branch.search': 'Search branches',
  'branch.create': 'Create and checkout new branch…',
  'branch.createPlaceholder': 'New branch name, Enter creates',
  'branch.empty': 'No matching branches',
  'branch.currentAria': 'Current branch',
  'error.fallback': 'The operation failed',
}

/** Dictionary keys of the {@link NS} namespace. */
export type RepoPanelKey = keyof typeof zh

export { en, zh }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Environment menu labels, row values, branch submenu, and read states. */
    'repo-panel': RepoPanelKey
  }
}
