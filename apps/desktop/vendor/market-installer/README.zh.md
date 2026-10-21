---
description: "Oristrat 桌面产品可选工作台市场插件的固定目标安装器入口。"
kind: "package-reference"
---

# dsh-desktop-market-installer

[English](README.md) | 中文


<a id="summary"></a>
## 概述

负责可选社区市场插件的固定目标安装、更新与卸载流程；Harness 重启后该插件替换工作台市场占位界面。`ORISTRAT_MARKET` 为 `0` 时插件保持关闭。


<a id="table-of-contents"></a>
## 目录

- [概述](#summary)
- [使用本包](#use-this-package)
- [已知限制与延期工作](#known-limitations-and-deferred-work)


<a id="use-this-package"></a>
## 使用本包

通过组合 patch 挂载 `dsh-desktop-market-installer` 行；客户端半区经 bundle 依赖加入 Web 模块名册。状态与安装路由位于 `/dsh-desktop/market-installer/` 下。


<a id="dev-note"></a>
## 开发备注

自上游 experimental 包 vendored 并重命名到 @oristrat 作用域，以便产品组合选择它们；随包提交的 TypeScript 源码仍是源码面。


<a id="model-experience"></a>
## 模型体验

无：安装器只搬运插件 generation 并记录安装状态，不贡献模型上下文。

#### KV Cache 影响

本包不发起模型请求，提示词前缀缓存不受影响。


<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 市场注册表端点为上游社区注册表；隔离网络部署会看到干净的拒绝并保留占位界面。
- 当包管理器报告插件占用时，卸载会在下次 Harness 重启时移除该插件 generation。
