# dsh-trae-relay-usage

在 DeepSeek Harness 里显示本地 [Trae Relay](https://github.com/Santonin205/Trae-Relay) 反代的实时用量。

## 数据来源

全部取自正在运行的 Trae Relay，不做任何估算：

| 面板内容 | 来源 |
| --- | --- |
| 账号名 / 类型 / 积分 / 状态 | `GET /v1/status`（由插件 Host 半身代发，页面不需要 key） |
| 今日 / 近 7 天 / 近 30 天 / 累计 Token 与积分 | Relay 自己的 `usage/usage-YYYYMMDD.jsonl` 账本 |
| 最近请求明细 | 同上，取最新 40 条 |
| 端点地址 / 密钥 / 任意 Key | Relay 的 `config.json` |

口径与 Relay 桌面端一致：`Token = in + out + cache`；积分只累加已回填（`known: true`）且大于 0 的 `delta`；按本地零点切日；`formatTokens` 用 999.95 进位、单位 `""/K/M/B`、保留一位小数。

## 界面

- 会话标题栏右侧一枚胶囊：`● 3022.11 · 20.8M`（状态点 · 积分 · 今日 Token），点击展开面板。
- 侧边栏底部一项 `Trae Relay`；侧边栏收成 56px 轨道时只剩一个状态点。
- 面板内四块：当前账号、Token 与积分区间、本地端点（可显示/复制密钥）、最近请求。
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
