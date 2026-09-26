# Agent Note: 为无任何描述的模型假定推理能力

Status: implemented

[English](2026-09-25-assumed-reasoning-for-undescribed-models.md) | 中文

## Problem

当所选模型在已安装的 pi-ai 目录中没有条目时——也就是手工声明路由的每一个模型——composer 的推理强度滑块会在切换模型后消失。`resolveModelReasoning` 只从目录条目读取模型能力，因此 `models` 列表列出了目录未提供的 id（`deepseek-v4.1-flash`、`MiniMax-M3`，或部署自有的网关词汇）的路由会解析出 `reasoning: false`，`reasoningInfo()` 不公布任何等级，客户端既不渲染滑块也不渲染推理强度值。网关清单只报告 id、容量与价格，从不报告模型以哪些等级推理，于是选择器唯一需要的事实，恰恰是任何部署都无法在不逐模型手写等级映射的情况下提供的事实。Oristrat 的 seed 及其启动迁移只为十个 glm id 声明了等级，这正是同一条路由上一个模型有滑块、下一个没有的原因（[Oristrat 轮次](../feature/2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.zh.md)）。

## Decision

`PiAiProviderProfile` 新增 `assumeReasoning`，默认取 `DEFAULT_ASSUME_REASONING`（`true`），并按路由物化进目录请求；于是没有已安装条目的模型解析出 `reasoning: true`，并采用 pi-ai 自身的默认档位——五个基础等级，不含 pi-ai 只为显式映射保留的 `xhigh` 与 `max` 拼写。假定仅限 `base === undefined` 的情形：已安装目录描述过的模型保留其记录在案的能力，因此已发布包的行为不变。未选择等级时不发送任何推理参数，这为「假定过多」的代价划定了上限。存在两个退出开关：路由的 `assumeReasoning: false` 让该路由列出的所有模型都不提供滑块，模型条目的 `reasoningEfforts: false` 只为该模型拒绝。二者都是普通的、经过校验的 schema 字段，与它们相邻的容量回退值一样可从 cordis.yml 修改。

## Alternatives considered

**在客户端推断等级。** 客户端看不到已安装目录，只能猜测它并不拥有的词汇；locale 包已经按 id 本地化等级，把「模型提供什么」的单一来源留在 Host 侧更合适。

**为假定的模型合成 `thinkingLevelMap`。** 映射必须把每个等级在协议上拼写出来；pi-ai 的默认处理已经为 OpenAI 兼容路由正确拼写了基础五档，而合成映射会固化网关可能不接受的拼写。

**把假定做成按需开启。** 按需开启会让每个不知道它存在的部署继续保留该缺陷——包括报告来源的那条路由，而 seed 无法改写它的配置文件。

**改为直接给上报部署的配置加 seed。** 改 `seed/settings.yaml` 只修好一个安装，之后新增的每条手工声明路由仍会落在同一处境。

## Consequences

路由列出却没有已安装条目的模型现在都会显示推理强度滑块，因此这类路由上真正不推理的模型需要显式写 `reasoningEfforts: false`。目录已知的模型、已发布的 seed 路由以及每一条已记录会话都保留原有能力。该假定是对模型能力的陈述而非一次选择：在用户或配置默认值选定等级之前，不会写入任何推理强度。

## Testing

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` 固定该假定、两个退出开关，以及不合成 `thinkingLevelMap`；`tests/config.spec.ts` 固定路由默认值及其对非布尔值的拒绝。`apps/web/tests/default-model.e2e.ts` 在真实浏览器中驱动一条手工声明路由，断言五档滑块、其未设定时的说明文字，以及其后的 `high` 提交；`apps/web/tests/declared-reasoning.e2e.ts` 继续固定显式声明的等级集合，`packages/client/ui-model-selection/tests` 的客户端用例固定滑块在面板中与键盘遍历中的位置。