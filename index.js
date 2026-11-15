/**
 * Trae Relay Usage — host half.
 *
 * The browser half draws the panel; this half owns the two things a page in the
 * Harness shell cannot do on its own:
 *
 *   1. read the relay's local data directory — `config.json` for the endpoint
 *      and key, `usage/usage-YYYYMMDD.jsonl` for the per-request ledger, which
 *      is the only place request accounting exists (the relay exposes no usage
 *      endpoint);
 *   2. query `GET /v1/status` on the relay's own port, so the panel never has to
 *      depend on the browser's cross-origin behaviour.
 *
 * Everything is read-only. The route answers `GET /trae-relay/api/state` and is
 * refused for cross-site and non-local `Host` requests, because the payload
 * carries the relay API key.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'

export const name = 'trae-relay-usage'
export const inject = ['webServer']

const ROUTE = '/trae-relay/api/state'
const CACHE_MS = 4000
const MAX_RECORDS = 6000
const RECENT_LIMIT = 40
const PROBE_TTL_MS = 5 * 60 * 1000
const PROBE_MISS_TTL_MS = 30 * 1000
const USAGE_FILE = /^usage-(\d{8})\.jsonl$/

let cache = { at: 0, value: null }
let probing = null
let probed = { at: 0, dir: '' }

// ── http plumbing ────────────────────────────────────────────────────────────

const EXTRA_HOSTS = String(process.env.TRAE_RELAY_ALLOWED_HOSTS ?? '')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean)

function hostOnly(value) {
  if (typeof value !== 'string' || value === '') return ''
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 0 ? value.slice(1, end).toLowerCase() : value.toLowerCase()
  }
  const colon = value.lastIndexOf(':')
  return (colon > 0 ? value.slice(0, colon) : value).toLowerCase()
}

function isLoopback(host) {
  return host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

function isPrivateLiteral(host) {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  return false
}

function isTrustedRequest(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== '' && site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false
  if (EXTRA_HOSTS.includes('*')) return true
  const host = hostOnly(req.headers.host)
  if (host === '') return true
  if (EXTRA_HOSTS.includes(host)) return true
  return isLoopback(host) || isPrivateLiteral(host)
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(text))
  res.end(text)
}

// ── data directory discovery ─────────────────────────────────────────────────

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function looksLikeDataDir(dir) {
  if (typeof dir !== 'string' || dir === '') return false
  if (await exists(path.join(dir, 'config.json'))) return true
  return exists(path.join(dir, 'usage'))
}

/**
 * The relay keeps its data next to the executable, so the running process is the
 * authority on where that is. `TRAE_RELAY_DIR` wins when the user moved things
 * around, and the process probe result is cached: a miss is retried soon (the
 * user may simply not have started the relay yet), a hit is kept for longer.
 */
async function detectDataDir() {
  const fromEnv = typeof process.env.TRAE_RELAY_DIR === 'string' ? process.env.TRAE_RELAY_DIR.trim() : ''
  if (fromEnv !== '' && (await looksLikeDataDir(fromEnv))) return fromEnv

  const ttl = probed.dir === '' ? PROBE_MISS_TTL_MS : PROBE_TTL_MS
  if (probed.at !== 0 && Date.now() - probed.at < ttl) return probed.dir
  if (probing !== null) return probing

  probing = (async () => {
    try {
      const executable = await probeExecutablePath()
      const dir = executable === '' ? '' : path.dirname(executable)
      probed = { at: Date.now(), dir: dir !== '' && (await looksLikeDataDir(dir)) ? dir : '' }
      return probed.dir
    } finally {
      probing = null
    }
  })()
  return probing
}

function probeExecutablePath() {
  if (process.platform !== 'win32') return Promise.resolve('')
  // PowerShell writes its console output in the OEM code page, which mangles any
  // non-ASCII directory (the relay is commonly unpacked into one). Forcing UTF-8
  // and decoding the raw bytes ourselves keeps the path intact.
  const script = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Process -Name TraeRelay -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path'
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, windowsHide: true, encoding: 'buffer' }, (error, stdout) => {
      if (error) return resolve('')
      const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout ?? '')
      const line = text.split(/\r?\n/).map(value => value.trim()).find(value => value !== '')
      resolve(line ?? '')
    })
  })
}

// ── ledger reading ───────────────────────────────────────────────────────────

async function readJsonFile(file) {
  if (typeof file !== 'string' || file === '') return null
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/**
 * Files are read newest-first and concatenated, so `records` is ordered newest
 * request first — the same order the relay itself serves its in-memory history.
 */
async function readUsage(dataDir) {
  if (dataDir === '') return { files: [], records: [] }
  const usageDir = path.join(dataDir, 'usage')
  let names
  try {
    names = await fs.readdir(usageDir)
  } catch {
    return { files: [], records: [] }
  }
  const files = names.filter(name => USAGE_FILE.test(name)).sort().reverse()
  const records = []
  for (const file of files) {
    let text
    try {
      text = await fs.readFile(path.join(usageDir, file), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        records.push(JSON.parse(trimmed))
      } catch {
        // A half-written trailing line is normal while the relay appends.
      }
      if (records.length >= MAX_RECORDS) return { files, records }
    }
  }
  return { files, records }
}

// ── pricing ──────────────────────────────────────────────────────────────────
// DeepSeek's published list price for deepseek-flash (the model the relay's
// `deepseek-v4.1-flash` id is served by), in CNY per million tokens. Peak hours
// are 09:00-12:00 and 14:00-18:00 Beijing time on weekdays; everything else,
// including weekends and Chinese public holidays, is off-peak at half price.
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing
export const PRICING = {
  model: 'deepseek-flash',
  modelVersion: 'DeepSeek-V4.1-Flash-1017',
  currency: 'CNY',
  peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  peakHours: [
    { from: 9, to: 12 },
    { from: 14, to: 18 },
  ],
  // Chinese public holidays fall outside peak hours in full. Kept as a small
  // maintained list rather than a dependency; add a year when it is announced.
  holidays: new Set([
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
  ]),
}

/** Beijing time parts for one instant, independent of the host time zone. */
function beijingParts(date) {
  const shifted = new Date(date.getTime() + 8 * 3600_000)
  return {
    day: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    // 0 = Sunday. Peak pricing applies Monday through Friday only.
    weekday: shifted.getUTCDay(),
  }
}

/** Whether an instant is billed at the peak rate. */
export function isPeak(date) {
  const { day, hour, weekday } = beijingParts(date)
  if (weekday === 0 || weekday === 6) return false
  if (PRICING.holidays.has(day)) return false
  return PRICING.peakHours.some(range => hour >= range.from && hour < range.to)
}

/**
 * Cost of one request in CNY. `in` already includes the cached prefix, so the
 * cache-miss share is the difference — charging both would double-count the hit.
 */
export function priceRequest(record, date) {
  const input = toNumber(record?.in)
  const output = toNumber(record?.out)
  const cacheHit = Math.min(toNumber(record?.cache), input)
  const cacheMiss = Math.max(0, input - cacheHit)
  const rate = isPeak(date) ? PRICING.peak : PRICING.offPeak
  return (cacheHit * rate.cacheHit + cacheMiss * rate.cacheMiss + output * rate.output) / 1_000_000
}

/** Ledger timestamps are local wall-clock text, e.g. "2026-11-14 20:17:37". */
function recordDate(record) {
  const text = String(record?.ts ?? '')
  const parsed = new Date(text.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function blank() {
  return { tokens: 0, credits: 0, cost: 0, requests: 0, input: 0, output: 0, cache: 0 }
}

function accumulate(bucket, record) {
  const input = toNumber(record?.in)
  const output = toNumber(record?.out)
  const cacheHit = toNumber(record?.cache)
  bucket.input += input
  bucket.output += output
  bucket.cache += cacheHit
  // The relay counts a request as input + output + cache.
  bucket.tokens += input + output + cacheHit
  bucket.requests += 1
  const known = record?.known === true || record?.known === 'true'
  const delta = toNumber(record?.delta)
  if (known && delta > 0) bucket.credits += delta
  bucket.cost += priceRequest(record, recordDate(record))
}

function merge(target, source) {
  target.tokens += source.tokens
  target.credits += source.credits
  target.cost += source.cost
  target.requests += source.requests
  target.input += source.input
  target.output += source.output
  target.cache += source.cache
}

function dayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDays(offset) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return dayKey(date)
}

function summarize(records) {
  const days = new Map()
  const total = blank()
  for (const record of records) {
    const key = String(record?.ts ?? '').slice(0, 10)
    let bucket = days.get(key)
    if (bucket === undefined) {
      bucket = blank()
      days.set(key, bucket)
    }
    accumulate(bucket, record)
    accumulate(total, record)
  }
  const todayKey = dayKey(new Date())
  const since7 = shiftDays(-6)
  const since30 = shiftDays(-29)
  const today = days.get(todayKey) ?? blank()
  const range7 = blank()
  const range30 = blank()
  for (const [key, bucket] of days) {
    if (key >= since7) merge(range7, bucket)
    if (key >= since30) merge(range30, bucket)
  }
  return { today, range7, range30, total, dayCount: days.size }
}

// ── relay status ─────────────────────────────────────────────────────────────

function relayConfig(config) {
  const service = config !== null && typeof config === 'object' && config.service !== null && typeof config.service === 'object' ? config.service : {}
  const host = typeof service.host === 'string' && service.host !== '' ? service.host : '127.0.0.1'
  const port = Number.isFinite(Number(service.port)) && Number(service.port) > 0 ? Number(service.port) : 8317
  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    apiKey: typeof service.apiKey === 'string' ? service.apiKey : '',
    allowAnyApiKey: service.allowAnyApiKey === true,
    allowLan: service.allowLan === true,
  }
}

async function readRelay(config) {
  const { baseUrl, apiKey } = relayConfig(config)
  const headers = { accept: 'application/json' }
  if (apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  const result = { baseUrl, reachable: false, health: false, status: null, error: '' }
  try {
    const response = await fetch(`${baseUrl}/v1/status`, { headers, signal: AbortSignal.timeout(4000) })
    if (response.ok) {
      result.status = await response.json()
      result.reachable = true
    } else {
      result.error = `HTTP ${response.status}`
    }
  } catch (error) {
    result.error = String(error?.message ?? error)
  }
  if (!result.reachable) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) })
      result.health = response.ok
    } catch {
      result.health = false
    }
  } else {
    result.health = true
  }
  return result
}

// ── state assembly ───────────────────────────────────────────────────────────

async function collect(force) {
  const now = Date.now()
  if (force !== true && cache.value !== null && now - cache.at < CACHE_MS) return cache.value

  const dataDir = await detectDataDir()
  const config = await readJsonFile(path.join(dataDir, 'config.json'))
  const usage = await readUsage(dataDir)
  const summary = summarize(usage.records)
  const relay = await readRelay(config)
  const sampledAt = new Date()
  const value = {
    ok: true,
    at: sampledAt.toISOString(),
    dataDir,
    relay,
    config: relayConfig(config),
    pricing: {
      model: PRICING.model,
      modelVersion: PRICING.modelVersion,
      currency: PRICING.currency,
      peak: isPeak(sampledAt),
      peakHours: PRICING.peakHours,
      rate: isPeak(sampledAt) ? PRICING.peak : PRICING.offPeak,
      peakRate: PRICING.peak,
      offPeakRate: PRICING.offPeak,
    },
    usage: {
      today: summary.today,
      range7: summary.range7,
      range30: summary.range30,
      total: summary.total,
      dayCount: summary.dayCount,
      files: usage.files.length,
      // Ledger files are appended chronologically, so the newest-first ordering
      // has to come from the parsed records, not from file or line position.
      recent: usage.records
        .slice()
        .sort((left, right) => String(right?.ts ?? '').localeCompare(String(left?.ts ?? '')))
        .slice(0, RECENT_LIMIT)
        .map(record => ({
          ...record,
          // Per-row estimate so the recent list can show the same money figure
          // the buckets are summed from.
          cost: priceRequest(record, recordDate(record)),
        })),
    },
  }
  cache = { at: sampledAt.getTime(), value }
  return value
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  if (!isTrustedRequest(req)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.end()
    return
  }
  let force = false
  try {
    force = new URL(req.url ?? ROUTE, 'http://localhost').searchParams.get('force') === '1'
  } catch {
    force = false
  }
  try {
    sendJson(res, 200, await collect(force))
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
  }
}

export function apply(ctx) {
  const webServer = ctx.webServer ?? ctx.get('webServer')
  ctx.effect(() => {
    const dispose = webServer.register({ kind: 'exact', path: ROUTE, handler: handle })
    return () => dispose()
  }, 'trae-relay-usage: routes')
}
