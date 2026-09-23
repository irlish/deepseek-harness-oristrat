# Agent Note: Oristrat 第三轮——头部仓库环境菜单、浏览器视图复用与工具栏清理

Status: implemented

[English](2026-09-23-oristrat-header-repo-menu-browser-view-reuse.md) | 中文

> 范围：(1) `ui-repo-panel` 从右侧栏标签迁移为 Codex 风格的会话头部工具菜单，附带分支切换子菜单，以及支撑它的 `gui-repo` 分支动词；(2) `apps/desktop` 与 `ui-browser-panel` 中内嵌浏览器的隐藏而非销毁生命周期，使浏览状态跨标签切换保留；(3) 浏览器工具栏清理：移除不可见的提交按钮，并让视图落在稳定的布局边界上。部分取代[第二轮 note](2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.zh.md)——后者记录了最初的侧栏标签位置与卸载即关闭的生命周期。

## 问题

第二轮交付后，三个产品可见的缺陷与诉求同时到来：

- 浏览器地址栏右侧的控件呈现黑底黑字：`.go` 提交按钮的品牌背景与文字 token 解析为同一深色；同时 dock 上出现灰色方块，因为 `WebContentsView` 保留了动画中途测得的过期边界（面板打开 transform 期间的 `getBoundingClientRect`，且稳定后没有任何 observer 触发）。
- 切走浏览器标签会销毁视图，文档、Cookie 与历史在每次标签切换时丢失；产品负责人要求页面像后台浏览器标签一样保留。
- 仓库环境以右侧栏标签形式存在且严格只读；产品负责人要求对齐 Codex：在会话头部「⋯」菜单旁放一个字形按钮，点击打开包含环境事实与分支列表的下拉，可搜索、切换并创建分支。

## 决策

### gui-repo 分支动词

- `gui-repo` 在 `status` 之外新增三个动词：`branches`（同一 toplevel 探测之后并发执行 `for-each-ref refs/heads` + `rev-parse --abbrev-ref HEAD`）、`checkout`（`git switch -- <branch>`）与 `createBranch`（先经导出的 `isValidBranchName` 守卫，再 `git switch --create <name>`）。两个变更动词共享一个私有 `mutate` 辅助，返回 `{ ok }` 或 `{ ok: false, error }`，error 依次取 git 去空白后的 stderr、stdout，最后 `git <verb> failed` 默认值；`runGit` 现在收集 stderr。按产品决策，提交与推送仍然缺席。

### 头部环境菜单

- `ui-repo-panel` 删除其侧栏标签注册（`definition.tsx`、`RepoTabBody.tsx`、`RepoTitle.tsx`、`RepoPanel.tsx`），改为注册一个 `conversation.session.header.utilities` 条目（id `repo-env`、order 0），渲染 `RepoEnvAction`：currentColor 分支字形触发按钮、由 `useAnchoredPosition` 定位并经 `useDismissOnOutsidePointer` 与 Escape 关闭的 portal 气泡、环境行（变更合计、主机、分支及分歧、来源），以及带子串搜索过滤的分支子菜单——`menuitemradio` 行标记当前分支、点选即检出、内联草稿表单创建并检出。状态在打开期间每 4 秒轮询；分支仅在子菜单打开期间轮询。变更操作有防重入守卫，成功时关闭气泡，失败时在子菜单内显示 git 的拒绝消息。

### 浏览器视图复用

- `browser-view.ts` 在应用窗口生命周期内每窗口维持一个 `WebContentsView`：`hide()` 在 `attached` 标志保护下经 `removeChildView` 分离视图而不销毁；`open()` 幂等地重新附着同一实例（不重新加载）；attach 时设置 `#ffffff` 背景，使未绘制的视图不会呈现为深色矩形。渲染进程面把 `close` 更名为 `hide`（IPC 通道 `dsh-desktop:browser-hide`）；`close` 仅保留给窗口拆除。
- `ui-browser-panel` 移除 `.go` 按钮（地址表单仅以回车导航，其占位符本来就这样声明），并经由新的 `boundsFromLayout` offset 链遍历测量边界——该布局在祖先 transform 动画期间即为最终值；挂载时立即推送一次并在 300ms 后落定推送一次，与既有的 ResizeObserver/scroll/resize 推送并存；卸载时隐藏而非关闭。

## 备选方案

- 修复 `.go` 按钮的 token 而不是移除它：回车本就提交表单，该按钮是重复的可操作面，其唯一上线行为就是黑底黑字。
- 用隐藏 DOM 元素的方式分离视图：`WebContentsView` 是窗口的原生子视图而非 DOM 的子节点；只有 `removeChildView` 能阻止它绘制在应用之上。
- 重开时通过重新加载最后 URL 恢复浏览状态：会丢失表单输入、滚动位置、页内历史与未提交的页面状态；保活视图的代价只是每窗口一个闲置渲染进程。
- 用 `git checkout <branch>` 切换：路径规格歧义强制使用 `--`，而 `checkout -b -- <name>` 会把名称当作起点引用；`git switch` 对两个动词都无歧义，且自 git 2.23 起随附。
- 保留侧栏标签形式的环境表面并在其中加分支：产品负责人明确要求 Codex 风格的头部座位与下拉；侧栏标签类型、引导条目与键控座位被删除而不是闲置保留。

## 影响

- 三个包都保持每文件 100% 覆盖；真正不可达的防御臂（被禁用按钮挡住的卸载后读取落定、子菜单 offset 回退、toplevel 探测正常时的 `for-each-ref` 失败）携带有理由的 `v8 ignore` 注释，可达的卸载后与回退臂由规格断言。
- 浏览状态现在跨每次标签切换保留，仅随应用窗口销毁；每窗口一个闲置 `WebContentsView` 是被接受的内存代价。
- 分支切换是 GUI 唯一的仓库修改操作；提交/推送按产品决策仍由 agent 的 bash 工具承担。
- 头部菜单在存在 `guiRepo` Remote 命名空间之处即注册，因此 Web 宿主同样获得它；浏览器面板仍仅限桌面端。
