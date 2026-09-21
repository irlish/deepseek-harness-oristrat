# Agent Note：Oristrat 工作模式、按模型视觉声明与内置 PPTD bundle

Status: implemented

[English](2026-09-20-oristrat-work-mode-vision-and-pptd-bundles.md) | 中文

## Problem

本 fork 部署对所有会话都强制执行 MSCE 引擎开发规范，包括该规范并不描述的方案、文档与幻灯片类自由创作。Models 设置页的模型行没有图片输入声明，支持视觉的端点只能靠手改 `settings.yaml` 启用，而纯文本模型也会接受图片附件，直到 pi-ai 适配器在请求时拒绝。部署也没有基于模板的 PPTX 组合能力，而参考的 dsh-desktop 同代产品以两个 patch-layer bundle 的形式提供了它。

## Decision

一个部署级工作模式存放在 `oristrat` settings 命名空间（`mode: coding | work`，默认 `coding`），由 `dsh-context-oristrat-msce-norms` 注册；没有 settings 服务时两个消费者都失败关闭为 coding。work 模式下，规范 system-prompt 分节贡献空文本，`msce-gate` 守卫对每个 `tools/execute` 分派直接放行、不做检查。会话从不按模式过滤。

ui-sidebar 品牌行在品牌旁挂载一个 Codex 风格的模式 chip：它经 `ctx.settingsScope.bind` 从 settings 域的共享 describe 镜像派生该命名空间——自身不贡献线路读取，也不给冷启动 RPC 预算新增直连 `settings.describe` 调用方——只在写入被提交后移动，并在收起轨道上省略。

`ui-settings-models` 在两个目录编辑器中新增共享的按行图片输入开关（`ModelImageInputToggle`），显式写入适配器持有的模态列表：pi-ai 路由写 `input: ['text', 'image']` 或 `['text']`，DeepSeek 目录写 `inputModalities`。强制点保持在原处：pi-ai 适配器对解析后 `input` 缺少 `image` 的模型拒绝图片内容，端点声明的能力经目录解析流入，无需经过该开关。

`ui-conversation` 声明两个镜像参考装配的 session 作用域 list 座位：`conversation.hero.modeActions`（hero 模式簇，仅在会话 zone 存在时渲染）与 `conversation.input.accessory`（composer 附件座；owner 传入的 `accessory` prop 优先于该 slot）。无占用者的附件座保持布局中性：slot 容器为空时其包装隐藏，因此在占用者注册之前，已提交的卡片几何 golden 保持不变。

PPTD 路线以两个内置的参考同代 bundle 交付（`apps/desktop/vendor/ppt` 下的 `dsh-ppt` 与 `dsh-ppt-composer` 0.1.1-rc.2 tarball）。composer 作为内建前缀条目加入 `DESKTOP_PROFILE_BUNDLES` 而非 profile 插件，并由它自己以交集配置应用 `dsh-ppt`——单独的 `dsh-ppt` patch 条目会把其 skill provider 注册两次；根 `pnpm-workspace.yaml` overrides 把每一次解析——包括 composer 自己的依赖——钉到这些 tarball；`prepare-package-set` 以它们为闭包根，并把 vendor 目录作为 packed 输入读取；`migrateProfileBundles` 在 `applyRelease` 中把旧的两 bundle profile manifest（以及自行挂载 `dsh-ppt` 的 alpha manifest）重写为当前的三条目前缀，保留插件顺序，未知前缀则留给 `profilePluginNames` 大声拒绝。

## Alternatives considered

**把 PPTD bundle 安装为 profile 本地插件。** `validateDesktopPluginGraph` 拒绝共享链接的活动插件与符号链接的包容器，且 bundle 的第三方闭包在 runtime 树内解析；内建前缀则直接搭乘现有的共享包链接。

**采用 registry 上的 `dsh-ppt` 线（0.4.x）。** 它面向比本 fork 0.1.5-rc.2 包集更新的宿主代际；参考桌面自带的 0.1.1-rc.2 bundle 与代际完全匹配。

**在客户端按解析模型的模态禁用 composer 的图片附件。** 目前没有把按模型模态事实送到 InputBar 的响应式通道；为一道便利门禁跨域建通道并不值得，而适配器的拒绝在发送时已对用户可见。

**按会话划分模式或切换器。** 模式是存放在单一 settings 文档中的部署姿态；按会话划分会分裂 norms/gate 的读取，并与共享会话的需求矛盾。

## Consequences

`plugins-disable-all` 现在重置为四个内建条目，因此 fork bundle 不再能从插件面板被用户禁用。模式是部署级的：每个打开的会话都通过实时 settings 作用域立即看到切换效果。PPT 组合 chip 在两种模式下都可见（与参考一致）；只有 MSCE 规范与门禁按模式限定。旧两 bundle 代际的既有 profile 会在新版本首次启动时、读取 profile 状态之前被治愈。

## Testing

`packages/context/oristrat-msce-norms/tests/mode.spec.ts` 钉住失败关闭默认值、coding/work 分节文本与双向实时切换；`packages/guard/msce-gate/tests/mode.spec.ts` 钉住 work 模式在分派层的放行与 coding 模式不变的强制。ui-sidebar apply spec 驱动 scope 替身（种子提交节、以提交折叠为门的写入、失败写入保留上一个已提交模式、畸形与缺失节的失败关闭，以及监听器释放），shell spec 钉住 chip 菜单行为与轨道省略。input-bar spec 钉住附件座对扩展 zone 的分派与 prop 优先；skeleton spec 钉住 hero 模式簇的分派。`apps/desktop/tests/project-manager.spec.ts` 钉住 manifest 迁移及其幂等、大声失败的前缀与经 `applyRelease` 的端到端治愈；`prepare-package-set.spec.ts` 钉住 fork bundle 的闭包根。
