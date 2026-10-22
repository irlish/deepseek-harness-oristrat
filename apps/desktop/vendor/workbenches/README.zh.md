---
description: "Oristrat 桌面产品的工作台目录、市场安装流程、侧边栏固定导航与会话原生框架。"
kind: "package-reference"
---

# dsh-desktop-workbenches

[English](README.md) | 中文


<a id="summary"></a>
## 概述

承载自 dataelement/dsh-desktop 移植的工作台产品层：基于已发布市场索引的目录读取、经桌面隔离 generation 边界记录于 `market-installs.json` 的安装/更新/卸载、侧边栏固定快捷入口，以及工作台渲染进入的会话框架。市场元数据只来自已发布的 protocol v2 索引；提供者只有在其注册描述中携带规范仓库 URL 时才被视为某市场条目的已安装形态。


<a id="table-of-contents"></a>
## 目录

- [概述](#summary)
- [使用本包](#use-this-package)
- [已知限制与延期工作](#known-limitations-and-deferred-work)


<a id="use-this-package"></a>
## 使用本包

以 `config.root` 指向 harness home 下工作台目录挂载 `dsh-desktop-workbenches` 行；客户端模块经 bundle 依赖加入 Web 名册，并注册侧边栏面板与会话框架座席。开发与上架指南以离线副本形式服务于 `/api/desktop-workbenches/` 下，并链接到官方阅读页。


Web 使用相同的市场、侧边栏切换器与工作台提供者注册。框架占用 root `main` 中 key 为 `conversation` 的入口并渲染 `conversation.main`，Session 切换时保留业务面板状态，原生输入框遵循其 Session 绑定。新建会话创建有归属的 Session，普通复用排除这些空白会话，选择已绑定的 Session 会恢复其工作台。市场安装依赖组合中的 `dsh-desktop-market-installer`；安装先持久化包，再提示重启 Host。

### 创建本地工作台

选择**制作我的工作台**，填写名称和用途，再点击**创建并打开**。基础工作台在原生 AI 会话旁提供共享笔记；笔记自动保存在 Host。创建操作将定义写入 `config.root/local-workbenches/<uuid>.json`，当前 profile 会立即加载，重启后也会重新加载。定义使用本地身份，不发布包，也不虚构仓库。同一个创建请求重试会返回已有定义。需要自定义界面时仍可使用进阶开发指令。

经过身份验证的 `GET /api/desktop-workbenches/local` 与 `POST /api/desktop-workbenches/local/create` 分别列出定义和通过 `{requestId, title, description}` 创建定义。名称最多 80 个字符，用途最多 1,000 个字符；空文本和无效 UUID 在写入前拒绝。已保存定义损坏时会停止加载并报告错误，而不覆盖数据。笔记与 Session 归属仍保存在现有 `state.json` 中。

<a id="dev-note"></a>
## 开发备注

自上游 experimental 包 vendored 并重命名到 @oristrat 作用域，以便产品组合选择它们；随包提交的 TypeScript 源码仍是源码面。


<a id="model-experience"></a>
## 模型体验

无：目录、导航与安装流程停留在客户端与宿主侧，不贡献模型上下文。

#### KV Cache 影响

本包不发起模型请求，提示词前缀缓存不受影响。


<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 市场目录端点为上游社区注册表；离线部署回退到已安装工作台并显示重试。
- 侧边栏快捷入口按 profile 持久；移除安装会保留会话与笔记。
