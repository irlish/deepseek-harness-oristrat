# Agent Note: Recent Sessions unassigned bucket

Status: implemented

[English](2026-09-15-recent-sessions-unassigned-bucket.md) | 中文

## Problem

Web GUI 没有任何路径可以开启一个不属于 Workspace 的会话。New Session 总要解析出一个 Workspace 目标——显式的、当前会话所属的或最近的——而当根本不存在任何 Workspace 时，`startSession()` 走进死胡同：清空选中并停在无会话视图上，没有任何可见的出路。Ungrouped 桶只是一个尾部兜底，仅在已有游离 Session 浮现时才渲染，因此无 Workspace 的会话在侧边栏没有常设的家，零 Workspace 的实例看起来像坏掉而不是空着。Host 其实早已支持这种情形：`SessionCommandController.create` 会从 Workspace 路径回退到显式 `cwd` 再回退到其 `defaultCwd`，Client 的 `sessions.create()` 也接受不带任何选项的调用。

## Decision

`UiWorkspaceService` 新增 `connectUnassigned()`：优先复用第一个不属于任何 Workspace、未被归档的空白 Session，否则不带选项调用 `sessions.create()`，让 Host 把会话落在其 `defaultCwd` 上；并发启动共享同一个在途 promise。`startSession()` 在解析不出 Workspace 目标时经 `openUnassigned(beforeOpen?)` 接通该桶——它是所有无 Workspace 启动背后的公共导航，导航替代守卫与 `openWorkspace` 相同，并执行同样的同步草稿携带准备。没有 Workspace 的冷启动保持无会话的主视觉区——其输入界面本就可用——因此未关联 Session 只在显式意图下创建。`deriveGroups` 现在始终把 Ungrouped 桶渲染在最前，即使为空。在浏览器侧，除非持久化 `groupExpansion` 中存在它自己的键，该桶默认展开；其 ＋ 会调用 `startSession()`（此前是惰性的）；展开且为空时显示 `empty.unassigned` 文案；工作区列表顶部的拖放边界锚定在第一个工作区分组而非领先的桶上。Locale 文案通过既有 `group.ungrouped` 键把该桶命名为 **Recent Sessions**（中文「最近会话」），新增 `empty.unassigned`，Workspace 删除确认框也说明保留的会话会显示在其下。全局 `empty.none` 空态只保留给单列表。Session Intent 主视觉区把该桶变成一等选择：其 Workspace 选择器在 owner 提供 `onPickUnassigned` 时于工作区行之上列出 **不关联工作区** 条目，零 Workspace 时的锚点手势因此打开一个两条目菜单，而不是直接跳进目录选择流程；没有归属 Workspace 的空白 Session 保留可用的输入界面，其 chip 显示 **未关联工作区**，不再锁在「先选工作区」的前提之后。

## Alternatives considered

**为无 Workspace 会话注册一个伪 Workspace。** Host Workspace 以目录为所有权并按路径去重；合成路径会污染注册表语义、引导记账与拖拽排序，而这纯粹是客户端呈现层的需求。

**让桶保持尾部且仅在出现游离会话时渲染。** 第一个无 Workspace 的会话在被打开前不可见，零 Workspace 实例也保留着 New Session 死胡同。产品需求是一个专用的、始终可见、可直接开始会话的栏。

**开始无 Workspace 会话前强制选择 cwd。** 对最常见的「直接开写」情形是多余摩擦；Host `defaultCwd` 是合理落点，主视觉区的 chip 本就支持在首条提示词前领养 Workspace。

**冷启动在无 Workspace 时自动接通未关联桶。** 与最近 Workspace 的自动连接对称，但那会让每次无 Workspace 的启动都变成一次 `session/create` RPC：无关功能的全量组装测试台都得为它准备 create 规则，新用户也会看到一个自己从未要求过的会话。无会话的主视觉区已提供可用的输入界面，因此创建保持在显式意图上。

## Consequences

无 Workspace 的会话会把 Host `defaultCwd` 持久化在 session header 中，因此它永远不会自行加入某个 Workspace——领养只能通过主视觉区选择器或之后在 Workspace 内新建会话发生。分组树始终带有领先的桶头，浏览器测试的行索引随之偏移，空桶渲染一行空态文案而非空无一物。顺序与展开记账不变：桶保持浏览器本地的 Ungrouped 记账，其默认展开状态让位于任何显式持久化记录。New Session 现在总能产出可用的输入界面——能解析出 Workspace 时是 Workspace 会话，否则是未关联会话——而没有 Workspace 的冷启动仍落在无会话主视觉区，在用户主动操作前不创建任何会话。主视觉区的选择器条目与未关联会话的可用输入界面把创建保持在显式意图上：被举起的 composer block 现在作用于未关联空白 Session，因为「先选工作区」的前提不再拥有 inert 姿态。

## Testing

`tree.client.spec.ts` 钉住领先的常显桶及其空行；`workspaces-service.client.spec.ts` 钉住空白复用、在途合并、pending 基线下跳过工作区成员空白、未关联失败告警、`openUnassigned` 的准备时序与导航替代，以及无 Workspace 的冷启动不创建任何会话；`workspace-browser.client.spec.tsx` 钉住默认展开、激活的 ＋、`empty.unassigned` 文案、删除确认框措辞与偏移后的拖拽索引；`workspace-picker.client.spec.tsx` 钉住「不关联工作区」条目（零 Workspace 时是真实菜单而非自动目录流程、选择回调、仅在被选中时出现尾部对勾）；`skeleton.client.spec.tsx` 钉住未关联空白 Session 的可用输入界面、chip 文案、选择器接线，以及被举起的 block 作用于它。包内每文件覆盖率保持 100%。

浏览器规格对领先桶做了适配：冷启动摘要的引导屏障改为等待常显组头旁的第一个会话行，不再等待组头本身；无工作区场景保持 `first()` 指向桶头（条件式展开）、`nth(1)` 指向会话行，而 Workspace 场景的位置式分组／行定位器整体加一；桶撤回断言反转为断言桶的空态文案；Sessions 树的 aria 金色快照新增桶头（桶内没有可见行时还包含空态文案行）。按子串匹配工作区标题的行过滤器现在通过 `[aria-expanded]` 限定到组头：标题投影尚未落地的会话行会读作所领养目录的 basename，而领先桶会把该行排在工作区头行之前。
