---
description: "安装态自持的 Office 创作能力：Word 模板工作流、模板库与业务 skills，服务 Oristrat 产品。"
kind: "package-reference"
---

# dsh-desktop-office

[English](README.md) | 中文


<a id="summary"></a>
## 概述

注册 Office 创作面：基于随包 office-skills 资产的模板库、Word 模板工作流工具，以及在会话中呈现模板的客户端座席（hero dock、composer accessory、用户消息页脚）。激活需要 `pnpm run office:prepare` 预备的绝对 `resources` 与 `cli` 配置路径；缺少二者的组合会禁用该行。


<a id="table-of-contents"></a>
## 目录

- [概述](#summary)
- [使用本包](#use-this-package)
- [已知限制与延期工作](#known-limitations-and-deferred-work)


<a id="use-this-package"></a>
## 使用本包

以 `config.resources` 与 `config.cli` 指向已预备运行时（primary-runtime 加 office-skills）与打包 Node 可执行文件来挂载 `dsh-desktop-office` 行。客户端模块经 bundle 依赖加入 Web 名册。


<a id="dev-note"></a>
## 开发备注

自上游 experimental 包 vendored 并重命名到 @oristrat 作用域，以便产品组合选择它们；随包提交的 TypeScript 源码仍是源码面。


<a id="model-experience"></a>
## 模型体验

间接：经 skill 与工具 seam——Office 模板工具与随包 skills 只在组合启用可选 Office 行时才进入模型请求，目录与 schema 渲染由 seam 拥有。

#### KV Cache 影响

Office 行保持禁用时前缀不变；启用时前缀一次性移动，随后目录与 schema 稳定。


<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 模板预备（`prepare-templates.mjs`）仍沿用上游基于 Electron 的 office CLI；未预备时模板库为空，通用创作工作流仍可用。
- resources 载荷归安装态所有：profile 路径与会话 cwd 永远不作为其锚点。
