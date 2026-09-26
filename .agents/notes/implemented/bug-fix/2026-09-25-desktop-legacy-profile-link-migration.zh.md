# Agent Note: 迁移早期 Oristrat 版本投影进 Desktop profile 的链接

Status: implemented

[English](2026-09-25-desktop-legacy-profile-link-migration.md) | 中文

## Problem

0.1.5 及更早的 Desktop 版本使用 Link 后端：shell 把安装的包闭包以符号链接投影进自己的 profile 的 `$DSH_HOME/profiles/desktop/node_modules`，并把每个链接记录在 `desktop-runtime-state.json` 里。解析会先读 profile 自己的 `node_modules`，再走 runtime resolution，因此这些链接优先于应用自带的运行时：后续版本在这样的 profile 上启动时，会用自带的 `cordis` 与 `dsh` 加载上一个版本的插件。

把 Oristrat AI Stem 0.1.7-rc.2 安装在已装好的 0.1.5 之上，因此在 Host 启动前就失败：`settings: TypeError: this.load is not a function`、`session-persistence-jsonl: format catalog v3 does not match Session v4`、`ctx.sessions.registerMessageProjection is not a function`，以及若干 typert 贡献者因缺少 zod v4 schema 而失败。原生恢复对话框报告"应用无法启动或已意外停止"并建议重新安装，而重新安装会复现同一故障。[链接清理移除](../simplification/2026-09-19-remove-desktop-profile-core-cleanup.zh.md)删掉了处理该状态的迁移，其前提是 Link 时期残留只存在于内部机器上；已发布的 0.1.5 Desktop 会把它写进外部用户的 profile，正是该移除 Note 自己列出的重新引入条件。

## Decision

`DesktopProjectManager.applyRelease` 在每次启动时、持有 profile 锁且 Host 启动之前运行 `migrateDesktopProfileLinks`，与处理 `.dsh-module-fallback` 的共享 `removeLinkProjections` 并列。该迁移读取 `desktop-runtime-state.json`，解除 profile `node_modules` 下每一个当前目标与记录目标一致的链接，然后删除该状态文件。

只有记录声明拥有的链接会被解除。pnpm 安装的真实目录、目标已改变的链接、位于被重定向的包父目录之下的链接，以及未被记录的链接都会保留。记录中若出现非法包名或相对目标，则在删除任何链接之前抛出错误，使准备过程明确停止，而不是删错条目。消费该记录的那一次启动之后，后续启动找不到状态文件，不做任何改动。

profile 还可能带有由共享同一 home 的*另一个*安装写入的链接。该状态超出本记录的范围，由[已安装产品自己的 Harness home](2026-09-25-installed-product-owns-its-harness-home.zh.md)中的 home 归属规则处理。

## Alternatives considered

**删除 profile `node_modules` 下所有解析到 profile 之外的符号链接。** 比记录所声明的所有权更宽，会删掉用户自己的 `link:` 包依赖，而那是 profile 的正当内容。

**只在安装器中清理。** 安装器够不到属于其他 home 或其他用户的 profile，也无法修复安装之后重新产生的残留。

**保留残留，让用户手工清理。** 已发布的升级路径继续损坏，而恢复对话框提供的修复都够不到 profile。

## Consequences

买到的：已安装的 0.1.7 版本能在更早版本准备过的 profile 上启动，包括上一个应用已被移动或删除的情况。付出的：profile 长期保留一个当前版本不再写入的状态的迁移步骤，且共享的 `.dsh-module-fallback` 清理与本迁移都位于启动准备阶段。早期 Desktop 以真实目录装进 profile 的核心包副本仍需手工删除；本 Note 只恢复了被移除清理中的链接那一半。

## Testing

[profile-packages.spec.ts](../../../../apps/desktop/tests/profile-packages.spec.ts) 覆盖记录链接的移除、断链目标、pnpm 安装目录替换记录链接、目标已改变与未记录的链接、未初始化的 profile、越界包名，以及位于被重定向包父目录之下的链接。[project-manager.spec.ts](../../../../apps/desktop/tests/project-manager.spec.ts) 固化：在带有指向旧安装的记录链接的 profile 上启动，会移除该链接而不触碰其目标，同时已安装的包、依赖声明与锁文件保持不变。