---
description: "为 Web 和 Desktop 提供原生 Word、Excel、PowerPoint 创建、工作区文件历史与可选 Office 模板。"
kind: "package-reference"
---

# dsh-desktop-office

[English](README.md) | 中文

<a id="summary"></a>
## 概述

在 Web 与 Desktop 注册原生 Office 创建能力。创建对话框与 `office_create` 工具将用户提供的内容保存为真实 DOCX、XLSX 和 PPTX，无需调用模型或额外安装 Office 运行时。Word 每行对应一个段落；Excel 接受 TSV，将类似公式的输入保留为文本；PowerPoint 用空行分隔幻灯片，每页首行为标题，其余为正文。每次保存创建新的 `office-files/<id>/` 目录，不覆盖已有文件。

<a id="use-this-package"></a>
## 使用本包

挂载 `dsh-desktop-office` 并用绝对 `config.root` 保存私有界面状态。Web 与 Desktop 默认启用此行。`runtimeOwner` 默认为 `plugin`；Desktop 设为 `desktop`，由 Desktop Host 安装随包 Office skills 与依赖，未配置 `resources` 时也一样。当前会话须有可写工作区，写入进程受现有沙箱策略约束。`maxInputBytes`、`maxSlides`、`maxCells`、`timeoutMs`、`maxDocuments`、`maxActivities`、`maxStateBytes` 和 `maxDownloadBytes` 分别配置输入、执行、历史与下载的限额。

对话框显示同一真实工作区目录下各会话近期创建的文件，包括第一次模型轮次之前创建的文件，并保留原始会话 ID。刷新或在该工作区打开新会话后仍能找到文件，其他工作区的文件不会混入。打开操作使用文档侧栏；下载读取工作区中的实际文件。Word 与 PowerPoint 预览依赖现有 Office 转换服务，Excel 使用现有表格查看器。对话框负责创建文件，进一步的富文本编辑由代理工具或外部 Office 应用完成。

可选的绝对 `resources` 与 `cli` 路径启用已准备的模板、Word 模板编辑、业务 skills 和随包 Python 运行时。`pnpm run office:prepare` 准备安装资源；`apps/desktop/vendor/office/scripts/prepare-templates.mjs` 添加随包案例。资源目录属于安装，不相对于会话工作区解析。配置资源不存在时激活明确失败；未配置时原生创建仍可用，模板目录为空。

<a id="model-experience"></a>
## 模型体验

`office_create` 与对话框共用写入实现，返回供 `present` 使用的文件路径、格式、标题、字节数与 SHA-256。选择 Word 或 Excel 后，相关随包 skill 通过记录的 `user/message` 注入。模式选择与文件历史是独立的原子界面状态，不增加 Session 事件；模型可见的指令与工具结果均可从 Session 日志重建。PPT 模板创作继续使用现有 `pptd_*` 工具。

#### KV Cache 影响

插件激活期间工具 schema 稳定。切换模式在下一次模型请求中添加有日志记录的 skill 指令，不改写之前的消息。

<a id="validation"></a>
## 验证

`apps/desktop-host/tests/vendor-office-authoring.spec.ts` 以构建产物冒烟方式运行提交的 JavaScript 与原生写入进程。测试重新打开 Office 文件、检查 OOXML 内容、比较下载结果、验证并发保存与工作区隔离，并拒绝错误进程响应及只读写入。Web 验收位于 `apps/web/tests/office-creation.e2e.ts`。无密钥 `apps/web/tests/office-authoring.snapshot.ts` 回放模型调用，执行真实创建与 `present`，比较完整日志和 schema，并检查保存的 DOCX 压缩包中的每个成员。此用例只归一化已验证文件的身份信息与文档时间。

<a id="dev-note"></a>
## 开发备注

此 vendored 包直接维护已提交的 JavaScript。原生创建使用 `docx`、`exceljs` 和 `pptxgenjs`；可选的准备运行时继续兼容 Desktop 安装。
