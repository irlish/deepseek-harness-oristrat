# Agent Note: 移除 Desktop 生产启动前的核心包清理

Status: implemented

[English](2026-09-19-remove-desktop-profile-core-cleanup.md) | 中文

## Problem

2026-09-15 起，生产版 Desktop 在启动 Host 前按运行时描述符列出的包名清理 profile：删除 `$DSH_HOME/profiles/desktop/node_modules` 里的同名条目，剪掉 manifest 对这些名字的依赖声明与 pnpm overrides，包状态变化时丢弃锁文件，并按 `desktop-runtime-state.json` 记录一次性移除开发期链接。它针对两类残留：更早的 Desktop 曾把核心包做成本地 tarball 用 pnpm 装进 profile 并写入声明、overrides 与锁文件；Link 后端的开发模式曾把安装闭包投影进同一个 profile 的 `node_modules`。在最近者优先的解析下，这些副本会压过应用自带的运行时，把旧 Web 前端与新插件组合在一起。

核心包残留只存在于内部开发与测试机器上，因为没有任何发布版 Desktop 把核心包装进过 profile；运行时随应用打包后，新 profile 也不再包含核心包。链接残留则不止于这些机器：已发布的 Oristrat 0.1.5 会把安装闭包投影进已安装应用的 profile，被移除清理的这一半已恢复为[旧 profile 链接迁移](../bug-fix/2026-09-25-desktop-legacy-profile-link-migration.zh.md)。核心包清理每次生产启动都要重跑，并与下一次 pnpm 操作按保留的依赖重新安装形成拉锯。

## Decision

删除 `apps/desktop/src/profile-core-cleanup.ts` 及其 spec。`DesktopProjectManager.applyRelease` 校验运行时描述符、迁移 profile 设置、创建 profile 文件，并通过共享的 `removeLinkProjections` 与恢复的[旧链接迁移](../bug-fix/2026-09-25-desktop-legacy-profile-link-migration.zh.md)删除早期 Link 时期发布写下的投影；除此之外，启动不改动 profile 的 `node_modules`，也不改动 manifest、overrides 与锁文件。

profile 内的解析按[查找顺序 Note](../architecture/2026-09-19-profile-resolution-lookup-order.zh.md)：profile 自己 `node_modules` 里的包最近者优先，本体包名在 `$DSH_HOME/profiles/node_modules` 的位置由 generation 占据。装进 profile 的包若在 `dependencies` 里声明了 `@deepseek-ai/*`，pnpm 会把副本装进 profile，这些副本按其自身版本运行。官方包只把纯函数包放在 `dependencies`，带模块级身份的包一律声明为 peer；第三方插件把身份敏感的 dsh 包写成实依赖，是该插件自身的打包选择。

放弃的能力：旧版 Desktop 装进 profile 的核心包副本及其声明需要手工删除一次。Link 后端写下的投影由共享的 profile 加载一次性删除，见[查找顺序 Note](../architecture/2026-09-19-profile-resolution-lookup-order.zh.md)，`desktop-runtime-state.json` 记录的链接由[旧链接迁移](../bug-fix/2026-09-25-desktop-legacy-profile-link-migration.zh.md)删除。

重新引入的条件：官方包改变依赖声明约定，使 profile 内出现与运行时争抢身份的副本。核心包条件（外部用户的 profile 曾被某个发布版 Desktop 写入核心包副本）尚未发生；链接条件已经发生，记录在后续 Note 中。

## Alternatives considered

**保留原清理。** 它服务的残留不再产生，却在每次生产启动删除目录、剪声明并丢弃锁文件，与随后的 pnpm 操作反复拉锯。

**只删除 profile `node_modules` 里的同名目录，不动声明与锁文件。** 2026-09-15 的决策已经否决：pnpm 会按保留的声明与 overrides 重装相同的旧包。

**让 generation 中的 `@deepseek-ai/*` 条目绝对优先于 profile 内的同名副本。** 这会覆盖插件自带的版本，是解析规则的新决策，不在移除清理的范围内。

**只在安装器中清理。** 2026-09-15 的决策已经否决：遗漏其他 profile，也管不到安装后重新产生的副本。

## Verification

- [project-manager.spec.ts](../../../../apps/desktop/tests/project-manager.spec.ts) 断言一次启动准备后，profile 里已安装的核心包目录、第三方插件目录、manifest 声明与锁文件逐字节不变，且指向旧安装的记录链接被移除而不触碰其目标。
- 仓库中不再有 `cleanProfileCorePackages` 与 `CLEAN_PROFILE_CORE_PACKAGES` 的引用；`migrateDesktopProfileLinks` 与 `DESKTOP_PROFILE_STATE` 位于 `apps/desktop/src/profile-packages.ts`，由后续 Note 拥有。

## Consequences

买到的：生产启动不再写 profile，没有临时启用开关，Desktop 与 CLI 对 profile 内副本采用同一套规则。付出的：旧版 Desktop 装进 profile 的核心包副本靠手工清理；第三方插件以实依赖带进 profile 的 dsh 副本按其自身版本运行。
