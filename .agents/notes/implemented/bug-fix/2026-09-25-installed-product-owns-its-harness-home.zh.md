# Agent Note: 已安装产品拥有自己的 Harness home 与提供方集合

Status: implemented

[English](2026-09-25-installed-product-owns-its-harness-home.md) | 中文

## Problem

打包后的应用会沿用启动者传入的 `DSH_HOME`：`main()` 只在该变量未设置时才把它指向 `~/.oristrat`。因此，任何来自另一个 Harness 安装内部 shell 的启动——DSH Desktop 应用、支持终端、为 CLI 导出该变量的脚本——都会让本产品运行在*另一个*安装的 home 上。该 home 的 `profiles/desktop/node_modules` 链接指向 `/Applications/DSH Desktop.app`，于是 Host 从另一个构建解析本产品的插件：typert 参数 codec 未通过 zod 校验，六个插件停留在 `sessionPersistence` 与 `workspaceRegistry` 等待状态，启动以“1 required plugin did not activate”中止并弹出崩溃对话框。同一个 home 还带有另一个安装的 `settings.yaml`，因此模型设置页在随产品发布的提供方之外列出了它手工声明的提供方（`oristrat`），其默认模型也选择了一个本产品并不随附的路由。两个安装互相配置了对方。[旧链接迁移](2026-09-25-desktop-legacy-profile-link-migration.zh.md)处理的是同一失败签名中由 profile 自己记录的链接；本说明处理的是它从未拥有的链接。

## Decision

打包后的应用在每次启动时都执行 `process.env.DSH_HOME = resolveProductHome()`，替换继承来的值而不是让位于它；`resolveProductHome()` 返回 `~/.oristrat`，除非 `ORISTRAT_HOME` 指定了别的 home。未打包启动保留环境中的 home，因为 `dev:desktop` 使用检出目录内的一次性 profile。模型设置页在自己这一层加上对应的边界：Host 配置 `providerEditing`（默认 `true`）随现有引导载荷下发，只要 Electron preload 标记存在，Client 就将其关闭，于是 Desktop 产品只列出它随附的提供方——可读、可编辑密钥、不可删除——并且完全不提供“添加模型提供商”入口。两处改动都让产品拥有自己的环境，而不是继承一个环境。

## Alternatives considered

**保留 `=== undefined` 判断并修复 profile。** [旧链接迁移](2026-09-25-desktop-legacy-profile-link-migration.zh.md)只删除 profile 记录在自己状态文件里的链接；外来链接属于写出它们的安装，所以下一次 DSH 启动会恢复该状态。

**用 profile 名称区分两个产品。** profile 的父级 `node_modules` 与插件解析范围由同一 home 下的所有 profile 共享，换一个 profile 名仍会读到另一个产品的链接。

**检测外来 home 并告警。** 告警留下的仍是一个无法启动、用户也修不好的应用。

**整体隐藏模型设置区。** 该页同时是缺少密钥时的诊断界面，隐藏它会让首次使用的用户得不到任何解释；只有添加与删除属于部署的选择。

**在组件里硬编码桌面壳判断。** 通过经过校验的 Host 选项加上 preload 标记，既能让 profile 补丁配置该选择，也能在没有浏览器的情况下测试它。

## Consequences

已安装应用的任何启动方式——Finder、终端或 DSH 会话——都使用 `~/.oristrat`，而 DSH 安装保持自己的 home 不受影响。支持与测试用 `ORISTRAT_HOME` 把应用指向其他 home。在 Desktop 上，模型设置页无法添加提供方，也无法删除随附的提供方；Web 构建与 `dsh web` 保留完整的提供方编辑能力，需要恢复添加入口的部署可在自己的 profile 补丁里设置 `providerEditing`。

## Testing

`apps/desktop/tests/main-startup.spec.ts` 固定三项行为：打包启动用产品 home 替换继承的 `DSH_HOME`、未打包启动保留环境中的 home、`ORISTRAT_HOME` 优先；其 `paths.ts` 模块替身改为展开真实模块，使该辅助函数持续被覆盖。`packages/client/ui-settings-models/tests/apply.client.spec.ts` 固定下发的引导载荷、schema 默认值、对非布尔值的拒绝，以及桌面标记会关闭提供方编辑；`tests/components.client.spec.tsx` 固定锁定后的页面——随附的提供方行仍然可见可编辑，而添加与删除控件不存在。