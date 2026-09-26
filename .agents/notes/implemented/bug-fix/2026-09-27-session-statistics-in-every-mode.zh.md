# Agent Note：会话统计在 Oristrat 的两种模式下都渲染

Status: implemented

[English](2026-09-27-session-statistics-in-every-mode.md) | 中文

## 问题

输入框下方的统计行——轮次与步数带速度、会话 Token 总量带缓存命中率，以及它们背后的两个弹窗（`会话统计`：模型用时、工具调用用时、首 token 平均、TPS；`Token 用量`：各计费桶明细）——在默认安装里从不出现。Oristrat 只在部署模式为 `work`（`oristrat-msce-norms.mode`）时把 Session 的时点输入区域传给输入框的 accessory 与 dock 座位，而随产品发布的默认值是 `coding`。于是第一方统计被一道本为扩展项设计的闸门挡住：coding 模式下 dock 从未派发，`StatsPills` 无法挂载，两个弹窗都点不开。参考的桌面产品在两种模式下都展示它们。

## 决策

统计 dock 跟随 Session，而不是部署模式：只要有 Session 与输入状态，`InputBar` 就把 Session 区域传给 `conversation.composer.dock`；`conversation.input.accessory` 的扩展项仍仅限工作模式，属主直接传入的 accessory 内容仍与模式无关。dock 是第一方读数（目前只有 `StatsPills`）的座位，因此它的可用性属于 Session 生命周期，而不是某个扩展面。展示偏好不变：`ui-chat` 的 `performanceUsage` 默认仍是 `detailed`，用户选 Compact 后仍然只显示纯读数。

## 考虑过的其他方案

**把部署默认改成 `work`。** 工作模式同时带来 MSCE 规范的挂起、扩展座位与相应文案；一个统计行不该选择另一套 agent 提示词。

**为新座位单独渲染 dock。** 第二个输入框行会为唯一一个 contribution 重复 dock 的布局、样式与弹窗定位，而现有座位本来就带正确的 Session 区域。

**把 `StatsPills` 注册到 `conversation.input.right`。** 那个座位属于输入框右侧控制行；统计行属于输入框下方、紧邻上下文仪表的位置，也正是参考产品的摆放位置。

## 影响

两个弹窗在 coding 与 work 模式下都可打开，位置是输入框底部那一行，Oristrat 应用与 Web 构建一致。注册在 `conversation.input.accessory` 上的扩展项仍然只在工作模式出现。想让 dock 再次消失的部署无法通过配置切换；将来若要加座位级开关，必须显式点名该 dock。

## 测试

`packages/client/ui-conversation/tests/input-bar.client.spec.tsx` 把“keeps the extension seats unmounted outside Work mode”一例替换为固定这一分工的用例：没有 `workMode` 时 accessory 座位仍不派发，而 dock 用同一个 Session 区域派发；没有区域时两者都不派发。重新生成的 `cordis-client-runner` 客户端目录与 `ui-conversation` 的双语 README 记录了这一座位契约的变化。
