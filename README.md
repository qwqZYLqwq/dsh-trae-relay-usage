# dsh-trae-relay-usage

在 DeepSeek Harness 里显示本地 [Trae Relay](https://github.com/Santonin205/Trae-Relay) 反代的实时用量。

## 数据来源

全部取自正在运行的 Trae Relay，不做任何估算：

| 面板内容 | 来源 |
| --- | --- |
| 账号名 / 类型 / 积分 / 状态 | `GET /v1/status`（由插件 Host 半身代发，页面不需要 key） |
| 今日 / 近 7 天 / 近 30 天 / 累计 Token、积分与**预估花费** | Relay 自己的 `usage/usage-YYYYMMDD.jsonl` 账本 |
| 最近请求明细（含每条花费） | 同上，取最新 40 条 |
| 端点地址 / 密钥 / 任意 Key | Relay 的 `config.json` |

口径与 Relay 桌面端一致：`Token = in + out + cache`；积分只累加已回填（`known: true`）且大于 0 的 `delta`；按本地零点切日；`formatTokens` 用 999.95 进位、单位 `""/K/M/B`、保留一位小数。

## 花费换算（人民币）

把账本里的 token 按 DeepSeek 官方价目表换算成人民币，价目来自
<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>（`deepseek-flash`，
即 `deepseek-v4.1-flash` 实际服务的 `DeepSeek-V4.1-Flash-1017`）：

| 元 / 百万 tokens | 空闲时段 | 高峰时段 |
| --- | --- | --- |
| 输入 · 缓存命中 | 0.02 | 0.04 |
| 输入 · 缓存未命中 | 1 | 2 |
| 输出 | 4 | 8 |

- 高峰时段＝北京时间周一至周五 `09:00-12:00`、`14:00-18:00`；其余时间、周末与中国法定节假日全天按空闲价（高峰价的一半）。
- 账本里 `in` 已包含缓存部分，所以缓存未命中量按 `in - cache` 计算，不会重复计费。
- 每条请求按它自己的时间戳判断峰谷，因此跨时段的历史记录不会被当前时段的价格重算。
- 界面上的「空闲价 / 高峰价」标签只表示**当前时刻**的档位；明细表里每条记录的花费已按各自时段算好。

节假日表维护在 `index.js` 的 `PRICING.holidays`（当前为 2026 年），官方公布新一年安排后补进去即可；表里没有的日期按普通工作日处理。

## 界面

- 会话标题栏右侧一枚胶囊：`● 2797.11`（状态点 · 积分），点击展开面板。
- 侧边栏底部一项 `Trae Relay`；侧边栏收成 56px 轨道时只剩一个状态点。
- 面板内四块：当前账号（含今日预估花费）、Token 与花费区间、本地端点（可显示/复制密钥）、最近请求。
- 面板通过 `react-dom` 的 `createPortal` 挂到 `document.body`，因为标题栏动作行会裁剪溢出内容。

旧插件里依赖 DeepSeek 平台的东西（余额与赠送、平台 Token 配置、书签取 token、API Key 筛选、余额不足提醒、长按拖动排序、60s 轮询配置、语言切换开关）全部没有移植——本插件的数据源里不存在这些概念。

## 安装

```bash
plugin_manager install_bundle target=D:\DSH_plugins\dsh-trae-relay-usage
```

## 配置（可选环境变量）

| 变量 | 作用 |
| --- | --- |
| `TRAE_RELAY_DIR` | 指定 Relay 数据目录，覆盖自动探测 |
| `TRAE_RELAY_ALLOWED_HOSTS` | 额外允许访问路由的 Host，逗号分隔；`*` 关闭校验 |

自动探测：先看 `TRAE_RELAY_DIR`，再用 PowerShell 查询 `TraeRelay` 进程的可执行文件路径，数据目录取它的父目录（Relay 把 `config.json` 和 `usage/` 放在 exe 旁边）。探测命中缓存 5 分钟，未命中 30 秒后重试，所以先开面板后启 Relay 也能自动恢复。

## 路由

`GET /trae-relay/api/state`（`?force=1` 绕过 4 秒缓存）。

返回值里含 Relay 的 API Key，因此路由会拒绝跨站请求（`sec-fetch-site`）与非本地 Host（防 DNS rebinding）。只支持 GET/HEAD。

## 已知边界

- 面板本身无法在无浏览器控制的环境里截图验证，视觉细节以实际页面为准。
- Relay 只在内存里保留最近 100 条记录、磁盘保留 30 天，所以"累计"是账本留存量，不是账号历史总量。
- 未启用账号或 Relay 未运行时，面板显示对应的空态/离线提示，不显示假数据。
- 花费是**按官方刊例价估算**的参考值，不是账单：Trae 侧的积分扣减口径由 Trae 决定，两者不是同一个计价体系。
- 官方价格调整后需要同步 `index.js` 的 `PRICING`；插件不会联网拉取价目表。
