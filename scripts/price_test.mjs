/**
 * Pricing checks: peak-window detection and the per-request CNY estimate.
 *
 * Run: node scripts/price_test.mjs
 */
import { isPeak, priceRequest, PRICING } from '../index.js'

let bad = 0
function check(label, actual, expected) {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) < 1e-12 : actual === expected
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} = ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

// Beijing time, Monday-Friday 09:00-12:00 and 14:00-18:00 are peak; weekends and
// Chinese public holidays are off-peak in full.
const peakCases = [
  ['2026-11-16T09:30:00', true],   // Monday, inside the morning window
  ['2026-11-16T11:59:00', true],   // Monday, last minute of the window
  ['2026-11-16T12:00:00', false],  // Monday, window closed
  ['2026-11-16T13:59:00', false],  // Monday, between windows
  ['2026-11-16T14:00:00', true],   // Monday, afternoon window opens
  ['2026-11-16T17:59:00', true],   // Monday, last minute of the window
  ['2026-11-16T18:00:00', false],  // Monday, afternoon window closed
  ['2026-11-15T10:00:00', false],  // Sunday
  ['2026-11-14T10:00:00', false],  // Saturday
  ['2026-10-01T10:00:00', false],  // National Day (Thursday)
  ['2026-01-01T10:00:00', false],  // New Year (Thursday)
]
for (const [iso, expected] of peakCases) check(`isPeak(${iso})`, isPeak(new Date(iso)), expected)

// Rates are CNY per million tokens. Off-peak: 0.02 / 1 / 4. Peak: 0.04 / 2 / 8.
const offPeak = new Date('2026-11-15T10:00:00')
const peak = new Date('2026-11-16T10:00:00')

check('off-peak 1M cache-miss + 1M output', priceRequest({ in: 1_000_000, out: 1_000_000, cache: 0 }, offPeak), 5)
check('peak 1M cache-miss + 1M output', priceRequest({ in: 1_000_000, out: 1_000_000, cache: 0 }, peak), 10)
check('off-peak 1M cache hit only', priceRequest({ in: 1_000_000, out: 0, cache: 1_000_000 }, offPeak), 0.02)
check('peak 1M cache hit only', priceRequest({ in: 1_000_000, out: 0, cache: 1_000_000 }, peak), 0.04)

// A real ledger row, priced at off-peak: 71424 hits + 1173 misses + 3824 output.
const real = priceRequest({ in: 72597, out: 3824, cache: 71424 }, new Date('2026-11-14T20:17:37'))
check('real ledger row', real, (71424 * 0.02 + (72597 - 71424) * 1 + 3824 * 4) / 1e6)

// Defensive: a cache figure above the input must not create negative misses.
const odd = priceRequest({ in: 100, out: 0, cache: 500 }, offPeak)
check('cache above input stays non-negative', odd >= 0, true)

// Empty/absent rows cost nothing rather than NaN.
check('empty row costs zero', priceRequest({}, offPeak), 0)

console.log('holidays loaded:', PRICING.holidays.size)
console.log(bad === 0 ? 'all pricing checks passed' : `${bad} check(s) failed`)
process.exit(bad === 0 ? 0 : 1)
