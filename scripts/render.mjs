/**
 * Headless render check for the browser half.
 *
 * Loads the ModuleLoader bundle against a stub slot/locale context, then renders
 * the panel and each card with fixture payloads using the real React. Catches
 * crashes, bad props and missing locale keys without needing a browser.
 *
 * The bundle's `apply` registers closures that close over the locale-bound `t`,
 * so this renders the components through the test seam the bundle exports.
 *
 * Run from a directory that has react + react-dom installed:
 *   node scripts/render.mjs [path/to/client.js]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = process.argv[2] ?? path.join(here, '..', 'client.js')

// ── shell stubs ─────────────────────────────────────────────────────────────
// react-dom needs a real DOM even for static markup (it probes vendor-prefixed
// style names at import time), so the harness runs on jsdom rather than on a
// hand-rolled document stub.
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html lang="zh-CN"><head></head><body></body></html>', { url: 'http://127.0.0.1:54792/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node

const dictionaries = {}
const registrations = []
const missing = new Set()

const loader = {
  load({ id, factory }) {
    const mod = factory(specifier => {
      if (specifier === 'react') return React
      if (specifier === 'react-dom') return require('react-dom')
      throw new Error(`unexpected require: ${specifier}`)
    })
    globalThis.__loaded = { id, mod }
  },
}
globalThis.__ModuleLoader__ = loader
// The bundle resolves `window` from the DOM window, not from globalThis.
dom.window.__ModuleLoader__ = loader

new Function(fs.readFileSync(clientPath, 'utf8'))()

const loaded = globalThis.__loaded
if (loaded === undefined) {
  console.error('bundle did not call __ModuleLoader__.load')
  process.exit(1)
}

const translate = ns => (key, vars) => {
  const value = dictionaries[ns]?.['zh']?.[key]
  if (value === undefined) {
    missing.add(`${ns}:${key}`)
    return key
  }
  return vars === undefined ? value : value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`))
}

loaded.mod.apply({
  locale: {
    bind: translate,
    register(ns, dicts) { dictionaries[ns] = dicts },
    getLocale: () => ({ active: 'zh-CN', locales: ['zh-CN'], revision: 1 }),
  },
  slots: {
    inject(_name, fn) { fn() },
    register(meta, component) { registrations.push({ meta, component }) },
  },
  effect(fn) { fn() },
})

console.log('module id:', loaded.id)
console.log('exports:', Object.keys(loaded.mod).join(', '))
console.log('inject:', JSON.stringify(loaded.mod.inject))
const styleTags = [...document.head.querySelectorAll('style[data-plugin="dsh-trae-relay-usage"]')]
console.log('style:', styleTags.length === 0
  ? 'FAIL not injected'
  : `${styleTags[0].textContent.length} chars injected`)
console.log('dictionaries:', Object.keys(dictionaries).map(ns => `${ns}(${Object.keys(dictionaries[ns]).join('/')})`).join(', '))
console.log('registrations:', registrations.map(entry => `${entry.meta.name}#${entry.meta.id}@${entry.meta.order}`).join(', '))

const test = loaded.mod.__test
if (test === undefined) {
  console.error('bundle has no __test seam')
  process.exit(1)
}

// ── fixtures ────────────────────────────────────────────────────────────────
// `cost` is what the host half computes for the same tokens; kept here so the
// render check exercises the money path with realistic magnitudes.
const bucket = (tokens, credits, requests, input, output, cache, cost) => ({ tokens, credits, cost, requests, input, output, cache })
const usage = {
  today: bucket(20807386, 69.63, 192, 10603896, 200418, 10003072, 12.84),
  range7: bucket(20807386, 69.63, 192, 10603896, 200418, 10003072, 12.84),
  range30: bucket(40931948, 111.03, 319, 20909299, 259193, 19763456, 25.31),
  total: bucket(40931948, 111.03, 319, 20909299, 259193, 19763456, 25.31),
  dayCount: 2,
  files: 2,
  recent: [
    { ts: '2026-11-14 20:51:16', account: 'Trae-0298', model: 'deepseek-v4.1-flash', ep: '/v1/chat/completions', in: 87262, out: 126, cache: 86656, before: 3022.22, after: 3022.11, delta: 0.11, known: true, merged: false, ms: 2388, ok: true, enterprise: false, cost: 0.00183 },
    { ts: '2026-11-14 20:44:32', account: 'Trae-0298', model: 'deepseek-v4.1-flash', ep: '/v1/chat/completions', in: 72597, out: 3824, cache: 71424, before: 3042.06, after: 3041.35, delta: 0.71, known: false, merged: true, ms: 29427, ok: true, enterprise: false, cost: 0.01790 },
  ],
}
const emptyUsage = {
  today: bucket(0, 0, 0, 0, 0, 0, 0),
  range7: bucket(0, 0, 0, 0, 0, 0, 0),
  range30: bucket(0, 0, 0, 0, 0, 0, 0),
  total: bucket(0, 0, 0, 0, 0, 0, 0),
  dayCount: 0,
  files: 0,
  recent: [],
}
const online = {
  ok: true,
  at: new Date().toISOString(),
  dataDir: 'F:\\迅雷下载',
  relay: {
    baseUrl: 'http://127.0.0.1:8317', reachable: true, health: true, error: '',
    status: {
      service: { host: '127.0.0.1', port: 8317, allowLan: false },
      settings: { reasoningEffort: null, isMaxMode: 0 },
      accounts: [{ nickname: 'Trae-0298', edition: 'cn', credits: 3022.11, accountType: 'personal', active: 0, lastUsed: 1794658627 }],
    },
  },
  config: { host: '127.0.0.1', port: 8317, baseUrl: 'http://127.0.0.1:8317', apiKey: 'sk-trae-000000000000000000000000', allowAnyApiKey: true, allowLan: false },
  pricing: {
    model: 'deepseek-flash',
    modelVersion: 'DeepSeek-V4.1-Flash-1017',
    currency: 'CNY',
    peak: false,
    peakHours: [{ from: 9, to: 12 }, { from: 14, to: 18 }],
    rate: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    peakRate: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeakRate: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  usage,
}
const fixtures = {
  'ready/online': online,
  'ready/peak': {
    ...online,
    pricing: { ...online.pricing, peak: true, rate: { cacheHit: 0.04, cacheMiss: 2, output: 8 } },
  },
  'ready/offline': {
    ok: true, at: new Date().toISOString(), dataDir: '',
    relay: { baseUrl: 'http://127.0.0.1:8317', reachable: false, health: false, error: 'fetch failed', status: null },
    config: { host: '127.0.0.1', port: 8317, baseUrl: 'http://127.0.0.1:8317', apiKey: '', allowAnyApiKey: false, allowLan: false },
    usage: emptyUsage,
  },
  'ready/noAccount': {
    ...online,
    relay: { ...online.relay, status: { service: {}, settings: {}, accounts: [] } },
  },
  'ready/saas': {
    ...online,
    relay: {
      ...online.relay,
      status: { ...online.relay.status, accounts: [{ nickname: 'Acme', edition: 'cn', credits: null, accountType: 'saas', tenantName: 'Acme Inc', active: 2, lastUsed: 0 }] },
    },
  },
}

const cases = [
  ['AccountCard', { data: 'data', t: 't' }],
  ['RangeCard', { data: 'data', t: 't' }],
  ['EndpointCard', { data: 'data', t: 't' }],
  ['RecentCard', { data: 'data', t: 't' }],
  ['Panel', { data: 'data', status: 'ready', error: '', refresh() {}, close() {}, t: 't' }],
]

let failures = 0
function attempt(label, fn) {
  try {
    const html = fn()
    if (typeof html !== 'string' || html === '') throw new Error('empty output')
    console.log(`ok   ${label} → ${html.length} chars`)
    return html
  } catch (error) {
    failures += 1
    console.error(`FAIL ${label}: ${error.message}`)
    return ''
  }
}

const t = translate('trae-relay')
for (const [label, data] of Object.entries(fixtures)) {
  for (const [name, props] of cases) {
    const element = React.createElement(test[name], {
      ...props,
      ...(props.data === 'data' ? { data } : {}),
      ...(props.t === 't' ? { t } : {}),
    })
    attempt(`${label} / ${name}`, () => renderToStaticMarkup(element))
  }
}

attempt('loading / Panel', () => renderToStaticMarkup(React.createElement(test.Panel, { data: null, status: 'loading', error: '', refresh() {}, close() {}, t })))
attempt('failed / Panel', () => renderToStaticMarkup(React.createElement(test.Panel, { data: null, status: 'failed', error: 'HTTP 500', refresh() {}, close() {}, t })))
attempt('header action', () => renderToStaticMarkup(React.createElement(registrations.find(entry => entry.meta.name === 'conversation.session.header.actions').component, {})))
attempt('sidebar action wide', () => renderToStaticMarkup(React.createElement(registrations.find(entry => entry.meta.name === 'sidebar.footer.action').component, { wide: true })))
attempt('sidebar action rail', () => renderToStaticMarkup(React.createElement(registrations.find(entry => entry.meta.name === 'sidebar.footer.action').component, { wide: false })))

// ── formatting rules, mirrored from the relay's own C++ ─────────────────────
const formatCases = [
  [0, '0.0'],
  [999.94, '999.9'],
  [999.95, '1.0K'],
  [1000, '1.0K'],
  [999949, '999.9K'],
  [999950, '1.0M'],
  [20807386, '20.8M'],
  [999950000, '1.0B'],
]
for (const [input, expected] of formatCases) {
  const actual = test.formatTokens(input)
  if (actual === expected) console.log(`ok   formatTokens(${input}) = ${actual}`)
  else {
    failures += 1
    console.error(`FAIL formatTokens(${input}) = ${actual}, expected ${expected}`)
  }
}
if (test.formatCredits(3022.11) === '3022.11') console.log('ok   formatCredits(3022.11)')
else { failures += 1; console.error(`FAIL formatCredits: ${test.formatCredits(3022.11)}`) }
if (test.formatCredits(-1) === '--') console.log('ok   formatCredits(-1) = --')
else { failures += 1; console.error(`FAIL formatCredits(-1): ${test.formatCredits(-1)}`) }
if (test.cacheRate({ input: 100, cache: 25 }) === '25%') console.log('ok   cacheRate')
else { failures += 1; console.error(`FAIL cacheRate: ${test.cacheRate({ input: 100, cache: 25 })}`) }
if (test.maskKey('sk-trae-000000000000000000000000') === 'sk-trae-••••0000') console.log('ok   maskKey')
else { failures += 1; console.error(`FAIL maskKey: ${test.maskKey('sk-trae-000000000000000000000000')}`) }

// ── money formatting ────────────────────────────────────────────────────────
const moneyCases = [
  [0, '¥0.00'],
  [0.00003, '¥0.0000'],
  [0.00183, '¥0.0018'],
  [0.01790, '¥0.018'],
  [0.1234, '¥0.123'],
  [1.5, '¥1.50'],
  [12.84, '¥12.84'],
  [1234.5, '¥1234.50'],
  [-1, '--'],
]
for (const [input, expected] of moneyCases) {
  const actual = test.formatMoney(input)
  if (actual === expected) console.log(`ok   formatMoney(${input}) = ${actual}`)
  else {
    failures += 1
    console.error(`FAIL formatMoney(${input}) = ${actual}, expected ${expected}`)
  }
}

console.log('missing locale keys:', missing.size === 0 ? 'none' : [...missing].join(', '))
if (missing.size !== 0) failures += 1
process.exit(failures === 0 ? 0 : 1)
