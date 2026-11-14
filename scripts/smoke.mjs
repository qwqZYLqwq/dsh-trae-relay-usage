/**
 * Host-half smoke test: mount the plugin against a stub webServer, call the
 * route handler with a fake request, and print what the browser half would get.
 * Run: node scripts/smoke.mjs
 */
import { apply } from '../index.js'

const routes = new Map()

const ctx = {
  webServer: {
    register(route) {
      routes.set(`${route.kind}:${route.path}`, route.handler)
      return () => routes.delete(`${route.kind}:${route.path}`)
    },
  },
  effect(fn, _label) {
    const dispose = fn()
    return () => dispose?.()
  },
}

apply(ctx)

const handler = routes.get('exact:/trae-relay/api/state')
if (handler === undefined) {
  console.error('route not registered')
  process.exit(1)
}

function call(url, headers = {}) {
  return new Promise(resolve => {
    const req = { method: 'GET', url, headers: { host: '127.0.0.1:54792', ...headers } }
    const chunks = []
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value },
      end(chunk) {
        if (chunk !== undefined) chunks.push(Buffer.from(chunk))
        resolve({ status: this.statusCode, body: Buffer.concat(chunks).toString('utf8') })
      },
    }
    Promise.resolve(handler(req, res)).catch(error => resolve({ status: 0, body: String(error) }))
  })
}

const main = await call('/trae-relay/api/state?force=1')
console.log('status:', main.status)
const payload = JSON.parse(main.body)
console.log('ok:', payload.ok, '| dataDir:', payload.dataDir)
console.log('relay:', JSON.stringify({ reachable: payload.relay.reachable, health: payload.relay.health, error: payload.relay.error }))
console.log('config:', JSON.stringify(payload.config))
console.log('today:', JSON.stringify(payload.usage.today))
console.log('range7:', JSON.stringify(payload.usage.range7))
console.log('total:', JSON.stringify(payload.usage.total))
console.log('days:', payload.usage.dayCount, '| files:', payload.usage.files, '| recent:', payload.usage.recent.length)
console.log('newest recent:', JSON.stringify(payload.usage.recent[0]))
console.log('oldest recent:', JSON.stringify(payload.usage.recent[payload.usage.recent.length - 1]))
const order = payload.usage.recent.map(row => row.ts)
const sorted = [...order].sort().reverse()
console.log('recent order newest-first:', JSON.stringify(order) === JSON.stringify(sorted))

const crossSite = await call('/trae-relay/api/state', { 'sec-fetch-site': 'cross-site' })
console.log('cross-site:', crossSite.status, crossSite.body)
const foreignHost = await call('/trae-relay/api/state', { host: 'evil.example.com' })
console.log('foreign host:', foreignHost.status, foreignHost.body)
const post = await new Promise(resolve => {
  const req = { method: 'POST', url: '/trae-relay/api/state', headers: { host: '127.0.0.1:54792' } }
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk) { resolve({ status: this.statusCode, body: String(chunk ?? '') }) },
  }
  Promise.resolve(handler(req, res))
})
console.log('POST:', post.status, post.body)
