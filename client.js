/**
 * Trae Relay Usage — browser half.
 *
 * Two entry points, one panel:
 *   - a chip in the session header actions (credits · today's tokens);
 *   - an action at the sidebar foot, which collapses to a status dot when the
 *     sidebar is a rail.
 *
 * Clicking either opens the same panel. Everything in it comes from the relay
 * itself: account and credits from `GET /v1/status`, request accounting from the
 * relay's own `usage/*.jsonl` ledger, endpoint and key from its `config.json`.
 * All three are read by this plugin's host half, so the page needs no key and no
 * cross-origin access of its own.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` / `react-dom` the shell already provides.
 */
window.__ModuleLoader__.load({
  id: 'dsh-trae-relay-usage',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const ReactDOM = require('react-dom')
    const { createElement: h, Fragment, useState, useEffect, useCallback } = React

    const NS = 'trae-relay'
    const API = '/trae-relay/api/state'
    const POLL_MS = 20000
    const inject = ['slots', 'locale']

    // ── copy ────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        'meta.title': 'Trae Relay 用量',
        'meta.description': '读取本地 Trae Relay 的账号积分、今日 Token 与请求流水，在会话标题栏和侧边栏底部显示用量面板。',
        title: 'Trae Relay',
        subtitle: '本地反代 · 实时用量',
        refresh: '刷新',
        refreshing: '刷新中…',
        loading: '正在读取本地数据…',
        loadFailed: '无法连接插件后端',
        unreachable: 'Relay 未运行',
        reachable: 'Relay 在线',
        offlineHint: '未检测到 Trae Relay。启动 TraeRelay.exe 后会自动恢复。',
        retry: '重试',
        'acct.current': '当前账号',
        'acct.none': '未启用账号',
        'acct.noneHint': '请在 Trae Relay 的凭据管理中加载并启用一个账号。',
        'acct.credits': '积分',
        'acct.state': '状态',
        'acct.active': '请求中',
        'acct.idle': '正常',
        'acct.enterprise': '企业 SaaS',
        'acct.personal': '个人',
        'seg.today': '今日',
        'seg.d7': '近 7 天',
        'seg.d30': '近 30 天',
        'seg.total': '累计',
        tokens: 'Token',
        credits: '积分消耗',
        requests: '请求',
        cacheHit: '缓存命中',
        endpoint: '本地端点',
        endpointAddr: '端点',
        endpointKey: '密钥',
        copy: '复制',
        copied: '已复制',
        show: '显示',
        hide: '隐藏',
        anyKey: '任意 Key',
        recent: '最近请求',
        recentEmpty: '还没有请求记录。',
        'col.time': '时间',
        'col.model': '模型',
        'col.tokens': 'Token',
        'col.credits': '积分',
        'col.ms': '耗时',
        dataDir: '数据目录',
        updated: '更新于',
        partial: '积分待回填',
        dayCount: '有记录天数',
        files: '账本文件',
        aria: 'Trae Relay 用量',
        close: '关闭',
      },
      en: {
        'meta.title': 'Trae Relay Usage',
        'meta.description': "Reads the local Trae Relay's account credits, today's tokens and request ledger, and shows a usage panel in the session header and at the sidebar foot.",
        title: 'Trae Relay',
        subtitle: 'Local relay · live usage',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        loading: 'Reading local data…',
        loadFailed: 'Cannot reach the plugin backend',
        unreachable: 'Relay offline',
        reachable: 'Relay online',
        offlineHint: 'No Trae Relay detected. Start TraeRelay.exe and this recovers on its own.',
        retry: 'Retry',
        'acct.current': 'Current account',
        'acct.none': 'No active account',
        'acct.noneHint': 'Load and enable an account in the Trae Relay credential manager.',
        'acct.credits': 'Credits',
        'acct.state': 'State',
        'acct.active': 'Requesting',
        'acct.idle': 'Idle',
        'acct.enterprise': 'Enterprise SaaS',
        'acct.personal': 'Personal',
        'seg.today': 'Today',
        'seg.d7': '7 days',
        'seg.d30': '30 days',
        'seg.total': 'All time',
        tokens: 'Tokens',
        credits: 'Credits used',
        requests: 'Requests',
        cacheHit: 'Cache hits',
        endpoint: 'Local endpoint',
        endpointAddr: 'Endpoint',
        endpointKey: 'Key',
        copy: 'Copy',
        copied: 'Copied',
        show: 'Show',
        hide: 'Hide',
        anyKey: 'Any key',
        recent: 'Recent requests',
        recentEmpty: 'No requests recorded yet.',
        'col.time': 'Time',
        'col.model': 'Model',
        'col.tokens': 'Tokens',
        'col.credits': 'Credits',
        'col.ms': 'Took',
        dataDir: 'Data dir',
        updated: 'Updated',
        partial: 'Credits pending',
        dayCount: 'Days recorded',
        files: 'Ledger files',
        aria: 'Trae Relay usage',
        close: 'Close',
      },
    }

    // ── formatting (mirrors the relay's own rules) ───────────────────────────
    const UNITS = ['', 'K', 'M', 'B']

    function formatTokens(value) {
      let amount = Number(value)
      if (!Number.isFinite(amount)) amount = 0
      let unit = 0
      while (unit < UNITS.length - 1 && amount >= 999.95) {
        amount /= 1000
        unit += 1
      }
      return `${amount.toFixed(1)}${UNITS[unit]}`
    }

    function formatCredits(value) {
      const amount = Number(value)
      if (!Number.isFinite(amount) || amount < 0) return '--'
      return amount.toFixed(2)
    }

    function formatMs(value) {
      const amount = Number(value)
      if (!Number.isFinite(amount) || amount <= 0) return '--'
      return amount >= 1000 ? `${(amount / 1000).toFixed(1)}s` : `${Math.round(amount)}ms`
    }

    function formatClock(iso) {
      const date = iso instanceof Date ? iso : new Date(iso)
      if (Number.isNaN(date.getTime())) return '--'
      const pad = value => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    function shortTime(ts) {
      const text = String(ts ?? '')
      return text.length >= 19 ? text.slice(11, 19) : text
    }

    function maskKey(key) {
      const text = String(key ?? '')
      if (text.length <= 12) return text === '' ? '--' : '••••'
      // Keep the recognisable prefix (e.g. "sk-trae-") plus the tail so the value
      // can be identified without being readable in full.
      return `${text.slice(0, 8)}••••${text.slice(-4)}`
    }

    function cacheRate(bucket) {
      const input = Number(bucket?.input) || 0
      const cache = Number(bucket?.cache) || 0
      if (input <= 0) return '--'
      return `${Math.round((cache / input) * 100)}%`
    }

    // ── data ────────────────────────────────────────────────────────────────
    // The chip, the sidebar row and an open panel all read the same snapshot, so
    // the store lives at module scope: one fetch loop, many subscribers. Without
    // this, two mounted entries would poll the host route independently.
    const store = {
      state: { status: 'idle', data: null, error: '' },
      subscribers: new Set(),
      timer: null,
      inflight: null,
    }

    function publish(next) {
      store.state = next
      store.subscribers.forEach(notify => notify(next))
    }

    function load(force) {
      if (store.inflight !== null) return store.inflight
      const first = store.state.data === null
      publish({ ...store.state, status: first ? 'loading' : 'refreshing' })
      const url = force === true ? `${API}?force=1` : API
      store.inflight = fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json()
        })
        .then(payload => {
          if (payload?.ok !== true) throw new Error(String(payload?.error ?? 'unexpected payload'))
          publish({ status: 'ready', data: payload, error: '' })
        })
        .catch(error => {
          publish({
            status: store.state.data === null ? 'failed' : 'ready',
            data: store.state.data,
            error: String(error?.message ?? error),
          })
        })
        .then(() => { store.inflight = null })
      return store.inflight
    }

    function subscribe(notify) {
      store.subscribers.add(notify)
      notify(store.state)
      if (store.timer === null) {
        void load(false)
        store.timer = setInterval(() => { void load(false) }, POLL_MS)
      }
      return () => {
        store.subscribers.delete(notify)
        if (store.subscribers.size === 0 && store.timer !== null) {
          clearInterval(store.timer)
          store.timer = null
        }
      }
    }

    function useRelayState() {
      const [state, setState] = useState(store.state)
      useEffect(() => subscribe(setState), [])
      return { state, refresh: () => load(true) }
    }

    // ── panel ───────────────────────────────────────────────────────────────
    function Dot(props) {
      const tone = props.tone ?? 'idle'
      const color =
        tone === 'ok' ? 'var(--dsw-alias-state-success-primary, #3fa45b)'
        : tone === 'warn' ? 'var(--dsw-alias-state-warn-primary, #d99a1f)'
        : tone === 'error' ? 'var(--dsw-alias-state-error-primary, #d9534f)'
        : 'var(--dsw-alias-state-idle-primary, #8a8a8a)'
      return h('span', {
        className: 'dtr-dot',
        style: { background: color, width: props.size ?? 7, height: props.size ?? 7 },
      })
    }

    function Field(props) {
      return h('div', { className: 'dtr-field' },
        h('span', { className: 'dtr-field-label' }, props.label),
        h('span', { className: 'dtr-field-value' }, props.children))
    }

    function Metric(props) {
      return h('div', { className: 'dtr-metric' },
        h('span', { className: 'dtr-metric-label' }, props.label),
        h('span', { className: 'dtr-metric-value' }, props.value),
        props.note === undefined ? null : h('span', { className: 'dtr-metric-note' }, props.note))
    }

    function CopyButton(props) {
      const [done, setDone] = useState(false)
      const copy = useCallback(() => {
        const text = String(props.value ?? '')
        if (text === '') return
        const write = navigator.clipboard?.writeText
          ? navigator.clipboard.writeText(text)
          : Promise.reject(new Error('clipboard unavailable'))
        write.then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        }).catch(() => {
          // Clipboard permission is often denied for the shell page; select the
          // value instead so the user can copy it by hand.
          props.onFallback?.()
        })
      }, [props.value, props.onFallback])
      return h('button', { type: 'button', className: 'dtr-link', onClick: copy }, done ? props.t('copied') : props.t('copy'))
    }

    function AccountCard(props) {
      const { data, t } = props
      const accounts = Array.isArray(data?.relay?.status?.accounts) ? data.relay.status.accounts : []
      const account = accounts[0]
      const online = data?.relay?.reachable === true
      return h('section', { className: 'dtr-card' },
        h('header', { className: 'dtr-card-head' },
          h('span', { className: 'dtr-card-title' }, t('acct.current')),
          h('span', { className: 'dtr-badge' },
            h(Dot, { tone: online ? 'ok' : 'error' }),
            online ? t('reachable') : t('unreachable'))),
        account === undefined
          ? h('div', { className: 'dtr-empty' },
              h('strong', null, t('acct.none')),
              h('span', null, t('acct.noneHint')))
          : h(Fragment, null,
              h('div', { className: 'dtr-account' },
                h('span', { className: 'dtr-account-name' }, account.nickname || '—'),
                h('span', { className: 'dtr-account-kind' },
                  account.accountType === 'saas' ? t('acct.enterprise') : t('acct.personal')),
                account.tenantName ? h('span', { className: 'dtr-account-tenant' }, account.tenantName) : null),
              h('div', { className: 'dtr-account-grid' },
                h(Field, { label: t('acct.state') },
                  h('span', { className: 'dtr-inline' },
                    h(Dot, { tone: Number(account.active) > 0 ? 'warn' : 'ok' }),
                    Number(account.active) > 0 ? t('acct.active') : t('acct.idle'))),
                h(Field, { label: t('acct.credits') }, formatCredits(account.credits)),
                h(Field, { label: `${t('seg.today')} ${t('tokens')}` }, formatTokens(data?.usage?.today?.tokens)),
                h(Field, { label: `${t('seg.today')} ${t('credits')}` }, formatCredits(data?.usage?.today?.credits)))))
    }

    function RangeCard(props) {
      const { data, t } = props
      const usage = data?.usage ?? {}
      const rows = [
        { key: 'today', label: t('seg.today'), bucket: usage.today },
        { key: 'd7', label: t('seg.d7'), bucket: usage.range7 },
        { key: 'd30', label: t('seg.d30'), bucket: usage.range30 },
        { key: 'total', label: t('seg.total'), bucket: usage.total },
      ]
      return h('section', { className: 'dtr-card' },
        h('header', { className: 'dtr-card-head' }, h('span', { className: 'dtr-card-title' }, t('tokens'))),
        h('div', { className: 'dtr-ranges' }, rows.map(row => h('div', { className: 'dtr-range', key: row.key },
          h('span', { className: 'dtr-range-label' }, row.label),
          h('span', { className: 'dtr-range-value' }, formatTokens(row.bucket?.tokens)),
          h('span', { className: 'dtr-range-note' }, `${formatCredits(row.bucket?.credits)} · ${Number(row.bucket?.requests) || 0} ${t('requests')}`)))),
        h('div', { className: 'dtr-metrics' },
          h(Metric, { label: t('cacheHit'), value: formatTokens(usage.total?.cache), note: cacheRate(usage.total) }),
          h(Metric, { label: t('requests'), value: String(Number(usage.total?.requests) || 0) }),
          h(Metric, { label: t('dayCount'), value: String(Number(usage.dayCount) || 0) })))
    }

    function EndpointCard(props) {
      const { data, t } = props
      const config = data?.config ?? {}
      const [revealed, setRevealed] = useState(false)
      const endpoint = `${config.baseUrl ?? ''}/v1`
      return h('section', { className: 'dtr-card' },
        h('header', { className: 'dtr-card-head' },
          h('span', { className: 'dtr-card-title' }, t('endpoint')),
          config.allowAnyApiKey === true ? h('span', { className: 'dtr-tag' }, t('anyKey')) : null),
        h('div', { className: 'dtr-kv' },
          h('span', { className: 'dtr-kv-key' }, t('endpointAddr')),
          h('code', { className: 'dtr-code', title: endpoint }, endpoint),
          h(CopyButton, { value: endpoint, t, onFallback: () => {} })),
        h('div', { className: 'dtr-kv' },
          h('span', { className: 'dtr-kv-key' }, t('endpointKey')),
          h('code', { className: 'dtr-code' }, revealed ? (config.apiKey || '--') : maskKey(config.apiKey)),
          h('button', { type: 'button', className: 'dtr-link', onClick: () => setRevealed(value => !value) },
            revealed ? t('hide') : t('show')),
          h(CopyButton, { value: config.apiKey, t, onFallback: () => {} })))
    }

    function RecentCard(props) {
      const { data, t } = props
      const recent = Array.isArray(data?.usage?.recent) ? data.usage.recent : []
      return h('section', { className: 'dtr-card' },
        h('header', { className: 'dtr-card-head' }, h('span', { className: 'dtr-card-title' }, t('recent'))),
        recent.length === 0
          ? h('div', { className: 'dtr-empty' }, h('span', null, t('recentEmpty')))
          : h('div', { className: 'dtr-table' },
              h('div', { className: 'dtr-row dtr-row-head' },
                h('span', null, t('col.time')),
                h('span', null, t('col.model')),
                h('span', { className: 'dtr-num' }, t('col.tokens')),
                h('span', { className: 'dtr-num' }, t('col.credits')),
                h('span', { className: 'dtr-num' }, t('col.ms'))),
              recent.slice(0, 10).map((row, index) => h('div', { className: 'dtr-row', key: `${row.ts}-${index}` },
                h('span', { className: 'dtr-mono' }, shortTime(row.ts)),
                h('span', { className: 'dtr-model', title: String(row.model ?? '') }, String(row.model ?? '--')),
                h('span', { className: 'dtr-num' }, formatTokens((Number(row.in) || 0) + (Number(row.out) || 0) + (Number(row.cache) || 0))),
                h('span', { className: 'dtr-num' },
                  row.known === false || row.known === 'false' ? t('partial') : formatCredits(row.delta)),
                h('span', { className: 'dtr-num' }, formatMs(row.ms))))))
    }

    function PanelHeader(props) {
      const { t, status, refresh, close } = props
      const busy = status === 'refreshing'
      return h('header', { className: 'dtr-head' },
        h('div', { className: 'dtr-head-text' },
          h('strong', { className: 'dtr-head-title' }, t('title')),
          h('span', { className: 'dtr-head-sub' }, t('subtitle'))),
        h('div', { className: 'dtr-head-actions' },
          h('button', { type: 'button', className: 'dtr-btn', onClick: refresh, disabled: busy },
            busy ? t('refreshing') : t('refresh')),
          h('button', { type: 'button', className: 'dtr-icon-btn', onClick: close, 'aria-label': t('close') }, '×')))
    }

    function PanelBody(props) {
      const { t, data, status, error, refresh } = props
      if (status === 'loading' && data === null) {
        return h('div', { className: 'dtr-body dtr-state' }, t('loading'))
      }
      if (data === null) {
        return h('div', { className: 'dtr-body dtr-state' },
          h('span', null, error === '' ? t('loadFailed') : `${t('loadFailed')} · ${error}`),
          h('button', { type: 'button', className: 'dtr-btn', onClick: refresh }, t('retry')))
      }
      const offline = data.relay?.reachable !== true
      const notice = offline
        ? h('div', { className: 'dtr-notice' },
            data.relay?.error ? `${t('offlineHint')} · ${data.relay.error}` : t('offlineHint'))
        : null
      const foot = h('footer', { className: 'dtr-foot' },
        h('span', { className: 'dtr-foot-item', title: data.dataDir ?? '' }, `${t('dataDir')} · ${data.dataDir || '--'}`),
        h('span', { className: 'dtr-foot-item' }, `${t('files')} ${Number(data.usage?.files) || 0}`),
        h('span', { className: 'dtr-foot-item' }, `${t('updated')} ${formatClock(data.at)}`))
      return h('div', { className: 'dtr-body' },
        notice,
        h(AccountCard, { data, t }),
        h(RangeCard, { data, t }),
        h(EndpointCard, { data, t }),
        h(RecentCard, { data, t }),
        foot)
    }

    function Panel(props) {
      const { t, data, status, error, refresh, close } = props
      return h(Fragment, null,
        h('div', { className: 'dtr-scrim', onClick: close }),
        h('div', { className: 'dtr-panel', role: 'dialog', 'aria-label': t('aria') },
          h(PanelHeader, { t, status, refresh, close }),
          h(PanelBody, { t, data, status, error, refresh })))
    }

    // ── portal host ─────────────────────────────────────────────────────────
    // The header action row clips overflow and fades its tail, so the panel is
    // portalled out of the row instead of trying to escape it with z-index.
    function usePanel(t) {
      const [open, setOpen] = useState(false)
      const { state, refresh } = useRelayState()
      const toggle = useCallback(() => {
        setOpen(value => {
          // Opening re-reads: the chip may have been the only live surface for a
          // while, and the panel should never show a stale ledger on first paint.
          if (value === false) void refresh()
          return !value
        })
      }, [refresh])
      const close = useCallback(() => setOpen(false), [])
      useEffect(() => {
        if (!open) return
        const onKey = event => { if (event.key === 'Escape') setOpen(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])
      const node = open
        ? ReactDOM.createPortal(
            h(Panel, { t, data: state.data, status: state.status, error: state.error, refresh, close }),
            document.body)
        : null
      return { open, toggle, close, state, node }
    }

    // ── slot entries ────────────────────────────────────────────────────────
    function HeaderAction(props) {
      const { t } = props
      const panel = usePanel(t)
      const data = panel.state.data
      const account = Array.isArray(data?.relay?.status?.accounts) ? data.relay.status.accounts[0] : undefined
      const credits = formatCredits(account?.credits)
      const tokens = data === null ? null : formatTokens(data?.usage?.today?.tokens)
      const tone = data === null ? 'idle' : data.relay?.reachable === true ? 'ok' : 'error'
      return h(Fragment, null,
        h('button', {
          type: 'button',
          className: 'dtr-chip',
          onClick: panel.toggle,
          title: t('title'),
          'aria-expanded': panel.open,
        },
          h(Dot, { tone }),
          h('span', { className: 'dtr-chip-credits' }, credits),
          tokens === null ? null : h('span', { className: 'dtr-chip-sep' }, '·'),
          tokens === null ? null : h('span', { className: 'dtr-chip-tokens' }, tokens)),
        panel.node)
    }

    function SidebarAction(props) {
      const { t, wide } = props
      const panel = usePanel(t)
      const data = panel.state.data
      const account = Array.isArray(data?.relay?.status?.accounts) ? data.relay.status.accounts[0] : undefined
      const tone = data === null ? 'idle' : data.relay?.reachable === true ? 'ok' : 'error'
      if (wide === false) {
        return h(Fragment, null,
          h('button', {
            type: 'button',
            className: 'dtr-rail',
            onClick: panel.toggle,
            title: t('title'),
            'aria-label': t('aria'),
          }, h(Dot, { tone, size: 8 })),
          panel.node)
      }
      return h(Fragment, null,
        h('button', { type: 'button', className: 'dtr-side', onClick: panel.toggle, title: t('title') },
          h(Dot, { tone }),
          h('span', { className: 'dtr-side-label' }, t('title')),
          h('span', { className: 'dtr-side-value' }, formatCredits(account?.credits))),
        panel.node)
    }

    // ── styles ──────────────────────────────────────────────────────────────
    const CSS = `
.dtr-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a);font:inherit;font-size:11px;line-height:1;cursor:pointer}
.dtr-chip:hover{color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-border-l1,rgba(160,160,160,.5))}
.dtr-chip-credits{font-variant-numeric:tabular-nums}
.dtr-chip-tokens{font-variant-numeric:tabular-nums;opacity:.8}
.dtr-chip-sep{opacity:.45}
.dtr-dot{display:inline-block;border-radius:50%;flex:0 0 auto}
.dtr-rail{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:transparent;cursor:pointer}
.dtr-rail:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}
.dtr-side{display:flex;align-items:center;gap:6px;width:100%;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.dtr-side:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#e6e6e6)}
.dtr-side-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtr-side-value{font-variant-numeric:tabular-nums;opacity:.75}
.dtr-scrim{position:fixed;inset:0;z-index:2147483000;background:transparent}
.dtr-panel{position:fixed;top:52px;right:16px;z-index:2147483001;display:flex;flex-direction:column;width:392px;max-width:calc(100vw - 32px);max-height:calc(100vh - 80px);overflow:hidden;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));border-radius:14px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#1c1c1c));color:var(--dsw-alias-label-primary,#e6e6e6);box-shadow:0 18px 48px rgba(0,0,0,.42);font-size:12px}
.dtr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22))}
.dtr-head-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dtr-head-title{font-size:13px}
.dtr-head-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-head-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.dtr-btn{padding:3px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:11px;cursor:pointer}
.dtr-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}
.dtr-btn:disabled{opacity:.55;cursor:default}
.dtr-icon-btn{width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:15px;line-height:1;cursor:pointer}
.dtr-icon-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#e6e6e6)}
.dtr-body{display:flex;flex-direction:column;gap:10px;padding:12px 14px;overflow-y:auto}
.dtr-state{align-items:center;gap:8px;padding:26px 14px;color:var(--dsw-alias-label-secondary,#8a8a8a);text-align:center}
.dtr-notice{padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-state-warn-primary,rgba(217,154,31,.5));color:var(--dsw-alias-state-warn-primary,#d99a1f);font-size:11px;line-height:1.5}
.dtr-card{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.09))}
.dtr-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dtr-card-title{font-size:11px;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-tag{padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-empty{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#8a8a8a);line-height:1.5}
.dtr-empty strong{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px}
.dtr-account{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}
.dtr-account-name{font-size:13px;font-weight:600}
.dtr-account-kind{padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-base,rgba(128,128,128,.18));font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-account-tenant{font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.dtr-field{display:flex;flex-direction:column;gap:2px;min-width:0}
.dtr-field-label{font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtr-field-value{font-size:13px;font-variant-numeric:tabular-nums}
.dtr-inline{display:inline-flex;align-items:center;gap:5px;font-size:12px}
.dtr-ranges{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.dtr-range{display:flex;flex-direction:column;gap:1px;min-width:0}
.dtr-range-label{font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-range-value{font-size:13px;font-variant-numeric:tabular-nums}
.dtr-range-note{font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
.dtr-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2))}
.dtr-metric{display:flex;flex-direction:column;gap:1px;min-width:0}
.dtr-metric-label{font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-metric-value{font-size:12px;font-variant-numeric:tabular-nums}
.dtr-metric-note{font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-kv{display:flex;align-items:center;gap:7px;min-width:0}
.dtr-kv-key{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-code{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.dtr-link{flex:0 0 auto;padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4f8cff);font:inherit;font-size:10px;cursor:pointer}
.dtr-link:hover{text-decoration:underline}
.dtr-table{display:flex;flex-direction:column;gap:2px}
.dtr-row{display:grid;grid-template-columns:52px minmax(0,1fr) 54px 52px 44px;align-items:center;gap:6px;font-size:11px;font-variant-numeric:tabular-nums}
.dtr-row-head{color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:10px}
.dtr-row-head .dtr-num{text-align:right}
.dtr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtr-num{text-align:right}
.dtr-foot{display:flex;flex-wrap:wrap;gap:4px 10px;padding-top:2px;font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dtr-foot-item{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
`

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'trae-relay-usage: dictionaries')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-trae-relay-usage')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'trae-relay-usage: styles')

      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'trae-relay-usage',
        order: 22,
        label: () => t('title'),
        locale: NS,
      }, props => h(HeaderAction, { ...props, t })))

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'trae-relay-usage',
        order: 18,
        label: () => t('title'),
        locale: NS,
      }, props => h(SidebarAction, { ...props, t })))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'trae-relay-usage'
    // Test seam for scripts/render.mjs: the panel is rendered headlessly with
    // fixture payloads, so the pure presentational parts have to be reachable.
    exports.__test = { Panel, AccountCard, RangeCard, EndpointCard, RecentCard, formatTokens, formatCredits, formatMs, cacheRate, maskKey }
    return module.exports
  },
})
