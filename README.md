# dsh-context-show

实时上下文占用面板（DSH Web 客户端插件 + 主机投影插件）。

在会话头部右侧添加一个占用指示按钮（圆环 + 百分比），点击展开/收起**可拖动的面板**，实时展示：

- **上下文占用**：`projectedTokens / contextWindow` 占用百分比（供应商上报锚定 + 表面增量，随 compaction 即时收缩），圆环按占用程度变色（<70% 中性、70–89% 琥珀、≥90% 红）。
- **来源构成**：系统提示词 / 工具定义 / 对话消息的启发式 token 构成（来自 token-meter 的 `contextBreakdown` 投影），分段进度条 + 明细行（详细版）。
- **工具占用**：按工具名聚合的占用列表（bash / glob / read …），显示调用次数与约 token 数，不展示原始内容（详细版为表格，省略版为前 3 个工具一行）。
- **花费金额**：按配置单价（每百万 token，默认人民币 CNY）估算的累计花费，**按每次请求的发生时间自动区分高峰 / 非高峰计价**（未启用峰谷时按平价）；详细版按花费降序列出**每个模型**的金额（模型名醒目 + 供应商 + 官方价格链接 + 输入/输出 token 明细），省略版显示 top 2 模型花费与总花费。
- **各供应商用量**：按 provider/model 路由归因的累计用量（本插件自带的 `contextUsage` 会话投影，主机侧对 durable 日志折叠），每次请求的 usage 归入当时生效的路由，同一步的重复样本按最后一次替换。

## 单价在哪里配置

**推荐：Web 设置页的插件配置**。打开 DSH Web 的「设置」面板，进入 **插件 → 插件配置**，找到最后一张卡片 **「上下文占用 · 单价配置」**（默认收起，点击标题行展开），可直接编辑：

- 币种（CNY / USD / CNH / EUR / GBP / JPY）；
- 是否启用峰谷计价（启用后显示高峰时段与时区输入）；
- 默认价（未配置供应商的兜底价）；
- 供应商单价与模型级覆盖（`provider/model`），每个条目一张 闲时/高峰 表；
- 「保存」即时生效（主机投影按新 spec 重新计价，无需重启）；「恢复默认」清空用户层回退到 bundle 默认值。

> **rc.6 宿主说明**：0.1.0-rc.6 的 host-apiproxy 只放行硬编码的官方设置命名空间，第三方命名空间会被 RPC 层拒绝。因此本插件在主机侧额外注册了一对**仅回环、仅 POST** 的桥路由 `/api/dsh-context-show/settings/describe|mutate`，直接走宿主 settings seam（保留官方校验、版本冲突、持久化与事件），客户端在官方 scope 报 unavailable 时自动回退到该桥。宿主升级后若 apiproxy 已放行第三方命名空间，官方 scope 自动保持主路径，桥不会启用。

也可以直接编辑 patch 配置（从上到下优先级递增，后一层整段覆盖前一层的同一行 config）：

1. **插件默认值**：`dsh-context-show/cordis.patch.yml`（随插件分发）。
2. **profile 用户层**：`$DSH_HOME/profiles/web/cordis.patch.yml`（已预置一份当前峰谷价格配置）。
3. `$DSH_HOME/cordis.patch.yml` 与命令行 `--patch`。

## 当前默认价格

依据 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ ，DeepSeek 采用**峰谷计价**（人民币 / 每百万 token）：高峰时段为北京时间**周一至周五** 9:00–12:00、14:00–18:00，周末与其余时段为闲时；闲时 = 高峰价的一半。

| 模型 | 时段 | 缓存命中 | 缓存未命中 | 输出 |
| --- | --- | --- | --- | --- |
| deepseek-v4-flash | 闲时 | ¥0.05 | ¥1.5 | ¥4.5 |
| deepseek-v4-flash | 高峰 | ¥0.10 | ¥3.0 | ¥9.0 |
| deepseek-v4-pro | 闲时 | ¥0.15 | ¥4.5 | ¥13.5 |
| deepseek-v4-pro | 高峰 | ¥0.30 | ¥9.0 | ¥27.0 |
| deepseek-v4-flash-vision-exp | 同 flash | ¥0.05/0.10 | ¥1.5/3.0 | ¥4.5/9.0 |

本插件默认已启用峰谷计价（`peakHours: 9–12 / 14–18`，`timeZone: Asia/Shanghai`，且**周末自动按闲时**），并预置上述闲时/高峰两套价格（`base` = 闲时，`peak` = 高峰）。价格后续调整直接在设置页改数字即可；若想改回平价，在设置页关闭「启用峰谷计价」或把 `peakHours` 清空。

## 面板交互

- **持久显示**：展开后不会因失焦 / 点击外部收起，只有再次点击按钮或按 Escape 关闭。
- **可拖动**：按住面板左上角的抓手（⠿）可把面板拖到任意位置，松手后保持（拖动后为 fixed 定位，仅关闭再打开会回到锚点）。
- **省略版 / 详细版**：面板头部 ▾/▴ 切换。省略版只显示**上下文占用与总花费**；详细版显示来源构成、工具占用表格、各模型花费（含官方价格链接与分时计价说明）、Token 用量。

所有数值均通过会话投影推送实时更新（`useProjection`），对话快照变化时工具列表同步刷新。

## 安装

```sh
# 从本地路径安装到 web profile（推荐，与 dsh-agent-teams 相同的 link: 方式）
dsh plugin --profile web add "C:\path\to\dsh-context-show"

# 或从 npm / Git 安装
dsh plugin --profile web add dsh-context-show
dsh plugin --profile web add github:<owner>/<repo>
```

安装后**重启目标 profile**（host 插件与 client bundle 都要求重启；仅 bundle 内容变化才支持 client HMR）。设置页保存的价格修改走 settings seam，保存后即时生效，无需重启。

> 疑难排查：若 pnpm 报 `ERR_PNPM_UNEXPECTED_STORE`（本机 store 路径与 profile 不一致），给 add 追加 `--store-dir=<你的 pnpm store>`（可用 `pnpm store path` 查询）。本机示例：`--store-dir=C:\path\to\pnpm-store\v11`。

依赖：`@deepseek-ai/dsh-token-meter` 的 `tokenUsage` / `contextPressure` / `contextBreakdown` 投影、`@deepseek-ai/dsh-settings`（`dsh-base` bundle 已内置），以及 host 侧的 `webServer` 服务（桥路由用，`dsh-base` / web 组合已提供）。缺少本插件主机半时，面板自动降级为仅展示 token-meter 已有的投影；缺少 token-meter 时面板显示空态。

## 开发

```sh
pnpm install
pnpm typecheck   # host + client 双 tsc program
pnpm test        # vitest：usage-fold 重放语义 + 分时计价 + 金额计算 + 快照估价 + 工具聚合 + 格式化
pnpm build       # tsc 双 program + tsdown 产出 lib/client.js（ModuleLoader 包裹）
pnpm verify      # typecheck + test + build
```

构建产物 `lib/` 直接可被 profile 以 path/link 方式加载（无需 install 脚本）。

## 架构

- `src/index.ts` —— host 插件入口：`inject = ['sessionProjections']`（必需服务）+ Config（币种 + 分时时段 + 价格表 + 官方价格链接，schemastery schema）+ `installSettingsSection` 注册 `context-show` 设置命名空间（设置页读写 + 改后热重注册投影）+ 直接 `ctx.sessionProjections.register(...)` 注册带定价 spec 的 `contextUsage` 投影单元（改价时 dispose 旧单元再注册新 spec，重新折叠计价）+ 挂载 loopback 设置桥路由。
- `src/usage-fold.ts` —— 纯函数折叠：`request/header` 与 `request/context` 记录当前路由，`assistant/chunk` usage 与 `assistant/message` usage 按事件时间归入高峰 / 闲时桶并归因到当时路由；状态为纯 JSON（投影缓存前提），按 `provider\0model` 建表 + 首次使用顺序，每 provider 一个 last-sample 槽做同一步替换（跨档位替换不重复计费）；金额、币种、时段与官方价格链接在 `view()` 阶段从累计桶计算，不进入折叠状态。
- `src/projection.ts` —— 共享类型 + `SessionProjectionMap` 表 merge（host 注册、client `useProjection('contextUsage')` 共用同一类型表）。
- `src/bridge.ts` —— host 侧的 loopback 设置桥：`/api/dsh-context-show/settings/describe|mutate`（仅回环、仅 POST），直连 settings seam，镜像官方错误码。
- `src/bridge-protocol.ts` —— host / client 共享的桥线协议类型（纯类型 + 前缀常量，双 tsc program 共用）。
- `src/client/index.ts` —— 浏览器半：locale 注册 + `conversation.session.header.utilities` 槽注册（面板）+ `settings.plugin.item` 槽注册（插件配置卡片，`order: 1000` 排在最后）。
- `src/client/bridge-scope.ts` —— rc.6 兼容 settings scope：官方 scope 为主，报 unavailable 且浏览器为回环时回退到桥控制器（串行队列 + revision 栅栏 + 失败重读）。
- `src/client/ContextShowMeter.tsx` —— 触发器 + 可拖动持久面板（抓手 pointer 拖拽、fixed 定位、省略/详细两态、Escape / 按钮关闭，`aria-*`，focus-visible）。
- `src/client/ContextShowSettings.tsx` —— 插件配置卡片：**默认收起的可折叠外壳**（对齐官方 PluginCard 样式），展开后编辑币种、峰谷开关与时段、默认价 / 供应商价 / 模型级覆盖（闲时+高峰双列表格）、保存 / 恢复默认。
- `src/client/estimate.ts` —— 客户端快照估价（与 token-meter 固定密度启发式同口径）+ 按工具名聚合。
- `src/client/formats.ts` —— token 紧凑格式 + 币种感知金额格式（CNY/USD/EUR/…）。
- `cordis.patch.yml` —— bundle 层：`context-show` 行插入配置树，含当前峰谷默认价格表与官方价格链接。

## 验证

`pnpm verify` 覆盖：双 tsc 类型检查、usage-fold 的重放确定性 / 路由归因 / 同一步替换（含跨高峰档位替换）/ 未归属桶 / 缓存桶 / 分时与平价金额计算 / 默认价回退 / 币种与官方价格链接 / 高峰时段判定（含跨午夜与北京时区）、快照估价与工具聚合、token/金额格式化。

另外：

- `node test/smoke-built.mjs` / `test/smoke-config.mjs` / `test/smoke-real-log.mjs` 校验构建产物、patch 配置与真实日志折叠；
- 桥路由用假 settings seam 验证 describe / mutate / unset / 非回环 403；
- 无头浏览器（Playwright）验证：设置 → 插件 → 插件配置 中卡片**位于最后**、默认收起、点击展开显示表单、卡片背景色与官方卡片一致，且控制台无崩溃。
