/**
 * Cost-math verification: hand-computed official-rate examples plus the
 * fold invariants the panel figures rely on.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  createContextUsageProjectionDefinition,
  createPricingSpec,
  type ContextUsageState,
  type PricingSpec,
} from '../src/usage-fold.ts'

/** deepseek-flash (2026-09 rates), per 1M tokens, off-peak / peak. */
const FLASH = {
  inputPerM: 1,
  cacheReadPerM: 0.02,
  cacheWritePerM: 1,
  outputPerM: 4,
  peak: { inputPerM: 2, cacheReadPerM: 0.04, cacheWritePerM: 2, outputPerM: 8 },
}

const PEAK_AT = Date.UTC(2026, 8, 14, 4, 0)
const OFF_PEAK_AT = Date.UTC(2026, 8, 14, 2, 0)
const NOW = Date.UTC(2026, 8, 14, 6, 0)

const spec = (now = NOW): PricingSpec => ({
  currency: 'CNY',
  resolve: () => FLASH,
  isPeakHour: (timeMs) => timeMs >= PEAK_AT,
  peakHours: [{ start: 9, end: 12 }],
  timeZone: 'Asia/Shanghai',
  now: () => now,
})

let seq = 0

const header = (time: number = OFF_PEAK_AT): SessionEvent => ({
  type: 'request/header',
  seq: seq++,
  time,
  data: { reason: 'initial', header: { config: { provider: 'deepseek-official', model: 'deepseek-flash' } } },
} as unknown as SessionEvent)

const usage = (turn: number, step: number, time: number, buckets: {
  input?: number; cacheRead?: number; cacheWrite?: number; output?: number
}): SessionEvent => ({
  type: 'assistant/message',
  seq: seq++,
  time,
  data: {
    turn,
    step,
    message: { role: 'assistant', content: [] },
    stream: [],
    usage: {
      inputTokens: buckets.input ?? 0,
      outputTokens: buckets.output ?? 0,
      ...(buckets.cacheRead === undefined ? {} : { cacheReadTokens: buckets.cacheRead }),
      ...(buckets.cacheWrite === undefined ? {} : { cacheWriteTokens: buckets.cacheWrite }),
    },
  },
} as unknown as SessionEvent)

const fold = (events: readonly SessionEvent[], pricing = spec()): { value: ReturnType<ReturnType<typeof createContextUsageProjectionDefinition>['wire']['view']>; state: ContextUsageState } => {
  const definition = createContextUsageProjectionDefinition(pricing)
  let state = definition.init() as ContextUsageState
  for (const event of events) state = definition.apply(state, event) as ContextUsageState
  return { value: definition.wire.view(state), state }
}

describe('cost math (official flash rates)', () => {
  it('prices the four disjoint buckets at the off-peak rate', () => {
    seq = 0
    const { value } = fold([
      header(),
      // 1M miss * 1 + 0.5M hit * 0.02 + 0.2M write * 1 + 0.3M out * 4
      usage(1, 1, OFF_PEAK_AT, { input: 1_000_000, cacheRead: 500_000, cacheWrite: 200_000, output: 300_000 }),
    ])
    // = 1 + 0.01 + 0.2 + 1.2 = 2.41
    expect(value.totalCost).toBeCloseTo(2.41, 10)
    expect(value.providers[0]?.cost).toBeCloseTo(2.41, 10)
    expect(value.today.cost).toBeCloseTo(2.41, 10)
  })

  it('prices peak samples at the peak rate and sums both tiers', () => {
    seq = 0
    const { value } = fold([
      header(),
      usage(1, 1, OFF_PEAK_AT, { input: 1_000_000, output: 1_000_000 }), // 1 + 4 = 5
      header(PEAK_AT), // the next request starts inside the peak window
      usage(1, 2, PEAK_AT, { input: 1_000_000, output: 1_000_000 }), // 2 + 8 = 10
    ])
    expect(value.totalCost).toBeCloseTo(15, 10)
    expect(value.providers[0]?.cost).toBeCloseTo(15, 10)
  })

  it('never double counts a repeated sample of the same step', () => {
    seq = 0
    const { value } = fold([
      header(),
      usage(1, 1, OFF_PEAK_AT, { input: 1_000_000, output: 1_000_000 }), // 5
      usage(1, 1, OFF_PEAK_AT, { input: 1_000_000, output: 1_000_000 }), // replaces: still 5
    ])
    expect(value.providers[0]?.steps).toBe(1)
    expect(value.totalCost).toBeCloseTo(5, 10)
    expect(value.total).toEqual({ uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('keeps the per-day buckets consistent with the cumulative total', () => {
    seq = 0
    const yesterday = Date.UTC(2026, 8, 13, 2, 0)
    const { value, state } = fold([
      header(yesterday),
      usage(1, 1, yesterday, { input: 1_000_000, output: 0 }), // 1, billed on the previous day
      header(),
      usage(2, 1, OFF_PEAK_AT, { input: 0, output: 1_000_000, cacheRead: 1_000_000 }), // 4 + 0.02
    ])
    // `days` holds both days; only today shows in `today`.
    expect(value.today.date).toBe('2026-09-14')
    expect(value.today.cost).toBeCloseTo(4.02, 10)
    expect(value.totalCost).toBeCloseTo(5.02, 10)
    const dayKeys = Object.keys(state.days).sort()
    expect(dayKeys).toEqual(['2026-09-13', '2026-09-14'])
    // Everything folded into days is exactly the cumulative spend.
    const dayCost = Object.values(state.days).flatMap(row => Object.values(row)).reduce((sum, tiered) => {
      const peak = tiered.peak
      const off = tiered.offPeak
      return sum
        + (off.uncachedInputTokens * 1 + off.cacheReadTokens * 0.02 + off.cacheWriteTokens * 1 + off.outputTokens * 4) / 1_000_000
        + (peak.uncachedInputTokens * 2 + peak.cacheReadTokens * 0.04 + peak.cacheWriteTokens * 2 + peak.outputTokens * 8) / 1_000_000
    }, 0)
    expect(dayCost).toBeCloseTo(value.totalCost, 10)
  })

  it('skips usage inside a fork-inherited prefix', () => {
    seq = 0
    const definition = createContextUsageProjectionDefinition(spec())
    // Prefix length 2: the ancestor produced (and already paid for) these.
    let state = definition.init(undefined, 2) as ContextUsageState
    state = definition.apply(state, header()) as ContextUsageState
    state = definition.apply(state, usage(1, 1, OFF_PEAK_AT, { input: 1_000_000, output: 1_000_000 })) as ContextUsageState
    expect(definition.wire.view(state).totalCost).toBe(0)
    // This Session's own events still count.
    state = definition.apply(state, header()) as ContextUsageState
    state = definition.apply(state, usage(1, 1, OFF_PEAK_AT, { input: 1_000_000 })) as ContextUsageState
    const value = definition.wire.view(state)
    expect(value.totalCost).toBeCloseTo(1, 10)
    expect(value.providers).toHaveLength(1)
  })

  it('bills a settlement at its request time, not its completion time', () => {
    seq = 0
    const { value } = fold([
      // Request written off-peak; the settlement lands inside the peak window.
      header(),
      usage(1, 1, PEAK_AT, { input: 1_000_000, output: 1_000_000 }),
    ])
    // Off-peak rate (1 + 4), not the peak rate (2 + 8).
    expect(value.totalCost).toBeCloseTo(5, 10)
  })

  it('prices an unmatched route at the configured default rate', () => {
    seq = 0
    const pricing = createPricingSpec({
      currency: 'CNY',
      defaultPrice: FLASH,
      peakHours: [],
    })
    const { value } = fold([
      usage(1, 1, OFF_PEAK_AT, { input: 1_000_000, output: 1_000_000 }),
    ], pricing)
    // No route yet: the sample lands in the unattributed bucket at the default price.
    expect(value.unattributedCost).toBeCloseTo(5, 10)
    expect(value.totalCost).toBeCloseTo(5, 10)
  })
})
