# Agent Note: Oristrat 轮次——思考等级滑块、WebSearch MCP、仓库环境面板与内嵌浏览器

Status: implemented

[English](2026-09-22-oristrat-thinking-slider-websearch-mcp-repo-browser-panels.md) | 中文

> 范围：(1) `ui-model-selection` 中 Codex 风格的推理强度滑块，以及让每个 `api.oristrat.com` 模型获得可调思考等级的桌面设置种子/迁移；(2) `mcp-client` 的 `authorizationEnv` 凭据引用与 desktop-host patch 中挂载的 DashScope WebSearch MCP；(3) `gui-repo` Remote BFF 与只读的 `ui-repo-panel` 右侧栏环境标签页；(4) 桌面 `WebContentsView` 桥与 `ui-browser-panel` 右侧栏内嵌浏览器标签页；以及新包所需的门禁规范化（tsconfig paths、manifest、README invariant 说明句、翻译配对记录）。

## 问题

fork 的产品负责人在一轮内要求四项用户可见能力：

- Oristrat 模型经 `api.oristrat.com` 可调整思考等级，但 GUI 没有按模型的推理控制：composer 菜单只能进入静态的 effort 子面板，种子模型名册不声明 `reasoningEfforts`，会话始终跟随提供方默认值。期望的交互是拖动过程中即时提交的 Codex 风格动画滑块。
- 智能体在封闭环境中运行：没有挂载任何外部 web search；DashScope WebSearch MCP 端点（`https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp`）以工作区密钥鉴权，密钥不得出现在提交的配置文件里。
- 项目挂载为工作区后，会话旁边没有任何仓库环境信息：分支、待提交变更合计、本机主机名、远程来源。产品决策为只读——面板不提供提交或推送。
- 右侧栏已有文件与终端但没有浏览器。本轮早先已否决 `webview` 标签与 iframe 方案（sandbox 与 CSP 面）；批准的方案是主进程 `WebContentsView`，由渲染进程驱动。

## 决策

### 思考等级滑块（F1）

- `apps/desktop/seed/settings.yaml` 为全部十个 glm 模型锚定同一份 `reasoningEfforts`（`low/medium/high/xhigh`），并设置路由 `compat.thinkingFormat: openai`；`settings-thinking-migration.ts` 在启动时对既有 `~/.oristrat/settings.yaml` 幂等地补齐同样事实，保留显式 `false`。
- `ModelSelect` 根面板以 `EffortSlider` 取代 effort 二级面板：适配器每公布一个等级一个档位，轨道填充、圆点滑动；未设定时呈空心圆点并标注提供方默认。指针拖动（window 级监听、ref 防陈旧闭包）与键盘（方向键/Home/End，stopPropagation）都经同一 `directory.select` 路径提交；成功提交推理强度后菜单仍按既有 settle 行为关闭。

### WebSearch MCP（F2）

- `StreamableHttpConfig` 新增 `authorizationEnv`：一个凭据引用，每次连接尝试时通过 credentials 服务解析并合并为 `Authorization: Bearer <value>`；凭据缺失或 credentials 服务缺失时严格启动即大声失败，重连自动采用轮换后的密钥而无需重启。
- desktop-host patch 挂载 `dashscope-websearch`（streamable-http，`failOnStartupError: false`），工具以 `mcp__dashscope-websearch__bailian_web_search` 出现。密钥只存在于 `$DSH_HOME/.env` 的 `DASHSCOPE_API_KEY`；配置文件只携带引用，永不携带机密。

### 仓库环境面板（F3）

- 新增 `api/gui-repo` Remote BFF（以 gui-terminal 为模板）：单个 `status` 动词经 `ctx.subprocess` 运行本地 git（`rev-parse --show-toplevel`、带 unborn/detached 回退的 `abbrev-ref HEAD`、`rev-list --left-right --count @{upstream}...HEAD`、`diff --numstat HEAD`、`ls-files --others`、`remote -v`），8 秒超时、1MB 收集上限；每项失败都降级为省略字段，非仓库目录返回 `repo: false`。
- `ui-repo-panel` 客户端包注册 `repo-env` 会话头部工具：气泡内含分支 + 领先/落后、`+X -Y · N 个文件`（已跟踪合计加未跟踪计数）、本机主机名与远程来源，外加可搜索本地分支、检出所选分支并创建检出新分支的分支子菜单；4 秒轮询。按产品决策，提交与推送仍然缺席（[第三轮 note](2026-09-23-oristrat-header-repo-menu-browser-view-reuse.zh.md) 记录头部位置与分支动词）。

### 内嵌浏览器（F4）

- `apps/desktop/src/browser-view.ts` 为每个应用窗口持有一个 `WebContentsView`：持久分区 `persist:dsh-embedded-browser`、拒绝弹出窗口（http(s) 目标改为视图内加载）、导航仅限 http(s)，并在每个导航事件推送状态（url/title/canGoBack/canGoForward/loading）。渲染进程提供的边界经 `sanitizeBounds`（有限、取整、钳制）。
- `preload-app.ts` 仅对 `dsh-app://app` 文档暴露 `browser` 面；新增 `DESKTOP_IPC.browser*` 通道由 `assertDesktopSender(event, ['app'])` 把守。
- 新增 `ui-browser-panel` 客户端包，注册右侧栏 `browser` 标签类型：工具栏（后退/前进/刷新、归一化为 http(s) 的地址栏）位于测量 surface 之上；ResizeObserver 加捕获阶段滚动、窗口 resize 与一次落定推送重新推送布局 offset 边界；卸载隐藏视图，下一次挂载重新附着同一实例且不重新加载，地址表单以回车导航、没有提交按钮（[第三轮 note](2026-09-23-oristrat-header-repo-menu-browser-view-reuse.zh.md) 记录该生命周期）。纯 Web 宿主上面板渲染仅桌面端可用的提示。

### 门禁规范化

- 为每条 fork 引入的 bundle 行补全 `tsconfig.base.json` paths 映射（`gui-terminal`、`gui-repo`、`ui-terminal-panel`、`ui-repo-panel`、`ui-browser-panel`、`oristrat-msce-norms`、`msce-gate`），使 `verify-cordis-config` 转绿。
- 新增与 fork 的 client/api manifest 规范化（MIT license、cordis peer+dev 成对、`dsh.client.inject` 对应 devDeps、`publishConfig.access`、repository directory、精确 files 列表）；README 补 invariant 说明句；刷新 `verify-translation-pairing` 记录，包括把两处已提交的既有漂移（ui-conversation README、work-mode Agent Note）按已发布内容重新记录。

## 考虑过的替代方案

- 推理强度选择：保留 effort 二级面板（多一层菜单、无拖动交互），或原生 `<input type="range">`（无法渲染档位圆点、填充轨道与空心未设定圆点，且与菜单样式冲突）。自定义档位滑块经未改动的 `directory.select` 路径提交，宿主侧选择语义零变化。
- MCP 鉴权：`headers: { Authorization: !!js ... }` 会把机密写进可提交的配置文件且轮换需重启；在配置解析时一次性展开环境变量则失去逐次解析。`authorizationEnv` 改为每次连接尝试都经 credentials 服务解析。
- 仓库事实来源：`git status --porcelain` 只有文件清单没有 +/- 合计；`diff --numstat HEAD` 直接给出合计。推送通道（fs watch 或 git hooks）对只读面板过重被否决；选择 4 秒轮询并把最多滞后一次轮询写入文档。
- 内嵌浏览器：`<webview>` 标签需要开启 `webviewTag` 并引入弃用标签的 sandbox 面；iframe 会被多数站点的 `X-Frame-Options`/CSP `frame-ancestors` 拒绝，也无法携带隔离的持久分区；`BrowserView` 已弃用。主进程 `WebContentsView` 加渲染进程推送边界，保持 sandbox 默认值与单一所有权点。

## 影响

- 每个新源文件保持逐文件 100% 覆盖率；确实不可达的防御分支带有说明理由的 `v8 ignore` 注释（detached HEAD 后的短 sha 回退、show-toplevel 之后的 remote 列表失败、rev-list 列守卫、stdout 收集器回退、effect 时点的 ref 守卫）。
- fork 既有红灯保持原样并记录在案：`apps/desktop/renderer/startup.js` 与 `OristratBrand.tsx` 的 `verify-client-ui-i18n` 命中、基线 HEAD 上即超时的 `main-startup.spec.ts`、`test:gui` 漂移（ui-layout/ui-settings-models/ui-settings-general/ui-chat/ui-deliverables），以及仅存在于 fork 文件的其余全仓 oxlint 错误。
- 内嵌浏览器仅桌面端可用；Web 宿主得到提示面板。每窗口单视图意味着第二个浏览器标签复用同一视图，隐藏标签保持浏览状态存活；状态仅随窗口销毁。
