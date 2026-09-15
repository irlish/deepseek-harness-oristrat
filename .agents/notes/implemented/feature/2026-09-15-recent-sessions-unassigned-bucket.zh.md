# Agent Note: Recent Sessions unassigned bucket

Status: implemented

[English](2026-09-15-recent-sessions-unassigned-bucket.md) | 中文

## Problem

Web GUI 没有任何路径可以开启一个不属于 Workspace 的会话。New Session 总要解析出一个 Workspace 目标——显式的、当前会话所属的或最近的——而当根本不存在任何 Workspace 时，`startSession()` 走进死胡同：清空选中并停在无会话视图上，没有任何可见的出路。Ungrouped 桶只是一个尾部兜底，仅在已有游离 Session 浮现时才渲染，因此无 Workspace 的会话在侧边栏没有常设的家，零 Workspace 的实例看起来像坏掉而不是空着。Host 其实早已支持这种情形：`SessionCommandController.create` 会从 Workspace 路径回退到显式 `cwd` 再回退到其 `defaultCwd`，Client 的 `sessions.create()` 也接受不带任何选项的调用。

## Decision

`UiWorkspaceService` 新增 `connectUnassigned()`：优先复用第一个不属于任何 Workspace、未被归档的空白 Session，否则不带选项调用 `sessions.create()`，让 Host 把会话落在其 `defaultCwd` 上；并发启动共享同一个在途 promise。`startSession()` 在解析不出 Workspace 目标时经 `openUnassigned()` 接通该桶，其导航替代守卫与 `openWorkspace` 相同。没有 Workspace 的冷启动保持无会话的主视觉区——其输入界面本就可用——因此未关联 Session 只在显式意图下创建。`deriveGroups` 现在始终把 Ungrouped 桶渲染在最前，即使为空。在浏览器侧，除非持久化 `groupExpansion` 中存在它自己的键，该桶默认展开；其 ＋ 会调用 `startSession()`（此前是惰性的）；展开且为空时显示 `empty.unassigned` 文案；工作区列表顶部的拖放边界锚定在第一个工作区分组而非领先的桶上。Locale 文案通过既有 `group.ungrouped` 键把该桶命名为 **Recent Sessions**（中文「最近会话」），新增 `empty.unassigned`，Workspace 删除确认框也说明保留的会话会显示在其下。全局 `empty.none` 空态只保留给单列表。Session Intent 主视觉区无需改动：它本就为空白会话渲染，其 WorkspaceChip 可以在首条消息前领养 Workspace。

## Alternatives considered

**为无 Workspace 会话注册一个伪 Workspace。** Host Workspace 以目录为所有权并按路径去重；合成路径会污染注册表语义、引导记账与拖拽排序，而这纯粹是客户端呈现层的需求。

**让桶保持尾部且仅在出现游离会话时渲染。** 第一个无 Workspace 的会话在被打开前不可见，零 Workspace 实例也保留着 New Session 死胡同。产品需求是一个专用的、始终可见、可直接开始会话的栏。

**开始无 Workspace 会话前强制选择 cwd。** 对最常见的「直接开写」情形是多余摩擦；Host `defaultCwd` 是合理落点，主视觉区的 chip 本就支持在首条提示词前领养 Workspace。

**冷启动在无 Workspace 时自动接通未关联桶。** 与最近 Workspace 的自动连接对称，但那会让每次无 Workspace 的启动都变成一次 `session/create` RPC：无关功能的全量组装测试台都得为它准备 create 规则，新用户也会看到一个自己从未要求过的会话。无会话的主视觉区已提供可用的输入界面，因此创建保持在显式意图上。

## Consequences

无 Workspace 的会话会把 Host `defaultCwd` 持久化在 session header 中，因此它永远不会自行加入某个 Workspace——领养只能通过主视觉区选择器或之后在 Workspace 内新建会话发生。分组树始终带有领先的桶头，浏览器测试的行索引随之偏移，空桶渲染一行空态文案而非空无一物。顺序与展开记账不变：桶保持浏览器本地的 Ungrouped 记账，其默认展开状态让位于任何显式持久化记录。New Session 现在总能产出可用的输入界面——能解析出 Workspace 时是 Workspace 会话，否则是未关联会话——而没有 Workspace 的冷启动仍落在无会话主视觉区，在用户主动操作前不创建任何会话。

## Testing

`tree.client.spec.ts` 钉住领先的常显桶及其空行；`workspaces-service.client.spec.ts` 钉住空白复用、在途合并、pending 基线下跳过工作区成员空白、未关联失败告警，以及无 Workspace 的冷启动不创建任何会话；`workspace-browser.client.spec.tsx` 钉住默认展开、激活的 ＋、`empty.unassigned` 文案、删除确认框措辞与偏移后的拖拽索引。包内每文件覆盖率保持 100%。

浏览器规格对领先桶做了适配：冷启动摘要的引导屏障改为等待常显组头旁的第一个会话行，不再等待组头本身；无工作区场景保持 `first()` 指向桶头（条件式展开）、`nth(1)` 指向会话行，而 Workspace 场景的位置式分组／行定位器整体加一；桶撤回断言反转为断言桶的空态文案；Sessions 树的 aria 金色快照新增桶头（桶内没有可见行时还包含空态文案行）。按子串匹配工作区标题的行过滤器现在通过 `[aria-expanded]` 限定到组头：标题投影尚未落地的会话行会读作所领养目录的 basename，而领先桶会把该行排在工作区头行之前。
