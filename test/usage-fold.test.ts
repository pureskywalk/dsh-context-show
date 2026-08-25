/**
 * Replay tests for the per-provider usage fold: route attribution, same-step
 * replacement, unattributed samples, peak / off-peak tiering, USD/CNY cost
 * pricing, totals, and replay determinism.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  createContextUsageProjectionDefinition,
  createPriceResolver,
  createPricingSpec,
  effectivePeak,
  isPeakHour,
  type ContextUsageState,
  type PricingSpec,
} from '../src/usage-fold.ts'

/** Resolver with distinctive prices so cost math is easy to eyeball. */
const TEST_PRICES = createPriceResolver(
  {
    'deepseek-official': { inputPerM: 1, cacheReadPerM: 0.5, cacheWritePerM: 1, outputPerM: 2 },
    openai: { inputPerM: 3, cacheReadPerM: 0.5, cacheWritePerM: 3, outputPerM: 6 },
  },
  {},
  { inputPerM: 10, cacheReadPerM: 0.5, cacheWritePerM: 10, outputPerM: 20 },
)

/** Flat (no tiering) spec — every sample prices at the base rate. */
const flatSpec = (): PricingSpec => ({
  currency: 'CNY',
  resolve: (provider, model) => TEST_PRICES.resolve(provider, model),
  isPeakHour: () => false,
})

/**
 * Tiered spec: times >= 1000 are peak, <= 999 off-peak; peak rate = base * 2
 * for the deepseek-official route.
 */
const tieredSpec = (): PricingSpec => ({
  currency: 'CNY',
  resolve: (provider, model) => provider === 'deepseek-official'
    ? { inputPerM: 1, cacheReadPerM: 0.5, cacheWritePerM: 1, outputPerM: 2, peak: { inputPerM: 2, cacheReadPerM: 1, cacheWritePerM: 2, outputPerM: 4 } }
    : TEST_PRICES.resolve(provider, model),
  isPeakHour: (timeMs) => timeMs >= 1000,
  peakHours: [{ start: 1, end: 2 }],
  timeZone: 'UTC',
})

/** Fold a synthetic log through the unit and read the projection value. */
function foldAll(events: readonly SessionEvent[], spec: PricingSpec = flatSpec()) {
  const definition = createContextUsageProjectionDefinition(spec)
  let state = definition.init()
  for (const event of events) {
    const next = definition.apply(state, event as SessionEvent)
    expect(next).not.toBeUndefined()
    state = next as ContextUsageState
  }
  return definition.wire.view(state)
}

const seq = { value: 0 }
const nextSeq = (): number => seq.value++
const TIME = { offPeak: 500, peak: 2000 }

function header(provider: string, model: string): SessionEvent {
  return {
    type: 'request/header',
    seq: nextSeq(),
    time: TIME.offPeak,
    data: {
      reason: 'initial',
      header: { config: { provider, model } },
    },
  } as SessionEvent
}

function context(provider: string, model: string): SessionEvent {
  return {
    type: 'request/context',
    seq: nextSeq(),
    time: TIME.offPeak,
    data: { provider, model, contextWindow: 64000 },
  } as SessionEvent
}

function messageUsage(turn: number, step: number, input: number, output: number, extra: { cacheRead?: number; cacheWrite?: number; time?: number } = {}): SessionEvent {
  return {
    type: 'assistant/message',
    seq: nextSeq(),
    time: extra.time ?? TIME.offPeak,
    data: {
      turn,
      step,
      message: { role: 'assistant', content: [], id: 'm' },
      usage: {
        inputTokens: input,
        outputTokens: output,
        ...(extra.cacheRead === undefined ? {} : { cacheReadTokens: extra.cacheRead }),
        ...(extra.cacheWrite === undefined ? {} : { cacheWriteTokens: extra.cacheWrite }),
      },
    },
  } as SessionEvent
}

describe('isPeakHour', () => {
  it('matches ranges in the configured timezone, including midnight wrap', () => {
    // 2026-08-18 (Tue) 10:00 UTC is inside 9-12
    const at10Utc = Date.UTC(2026, 7, 18, 10, 0)
    expect(isPeakHour(at10Utc, [{ start: 9, end: 12 }], 'UTC')).toBe(true)
    // 08:00 UTC outside
    const at8Utc = Date.UTC(2026, 7, 18, 8, 0)
    expect(isPeakHour(at8Utc, [{ start: 9, end: 12 }], 'UTC')).toBe(false)
    // Beijing 09:00 == UTC 01:00 -> inside 9-12 Asia/Shanghai window
    const beijing9 = Date.UTC(2026, 7, 18, 1, 0)
    expect(isPeakHour(beijing9, [{ start: 9, end: 12 }], 'Asia/Shanghai')).toBe(true)
    // Beijing 17:00 == UTC 09:00 -> outside
    const beijing17 = Date.UTC(2026, 7, 18, 9, 0)
    expect(isPeakHour(beijing17, [{ start: 9, end: 12 }], 'Asia/Shanghai')).toBe(false)
    // wrap: 22:00-02:00 includes 23:00 (Tue) and 01:00 (Wed), excludes 03:00
    expect(isPeakHour(Date.UTC(2026, 7, 18, 23, 0), [{ start: 22, end: 2 }], 'UTC')).toBe(true)
    expect(isPeakHour(Date.UTC(2026, 7, 19, 1, 0), [{ start: 22, end: 2 }], 'UTC')).toBe(true)
    expect(isPeakHour(Date.UTC(2026, 7, 19, 3, 0), [{ start: 22, end: 2 }], 'UTC')).toBe(false)
    // empty ranges -> never peak
    expect(isPeakHour(Date.UTC(2026, 7, 18, 10, 0), [], 'UTC')).toBe(false)
  })

  it('treats weekends as off-peak regardless of the hour', () => {
    // 2026-08-15 is Saturday, 2026-08-16 is Sunday
    expect(isPeakHour(Date.UTC(2026, 7, 15, 10, 0), [{ start: 9, end: 12 }], 'UTC')).toBe(false)
    expect(isPeakHour(Date.UTC(2026, 7, 16, 10, 0), [{ start: 9, end: 12 }], 'UTC')).toBe(false)
    // Monday 10:00 is peak again
    expect(isPeakHour(Date.UTC(2026, 7, 17, 10, 0), [{ start: 9, end: 12 }], 'UTC')).toBe(true)
  })
})

describe('effectivePeak', () => {
  it('merges only the defined peak fields onto the base rate', () => {
    const price = { inputPerM: 1, cacheReadPerM: 0.5, cacheWritePerM: 1, outputPerM: 2, peak: { inputPerM: 3 } }
    expect(effectivePeak(price)).toEqual({ inputPerM: 3, cacheReadPerM: 0.5, cacheWritePerM: 1, outputPerM: 2 })
    expect(effectivePeak({ inputPerM: 1, cacheReadPerM: 0.5, cacheWritePerM: 1, outputPerM: 2 }))
      .toEqual({ inputPerM: 1, cacheReadPerM: 0.5, cacheWritePerM: 1, outputPerM: 2 })
  })
})

describe('contextUsage fold', () => {
  it('attributes usage samples to the route in force at the step', () => {
    seq.value = 0
    const value = foldAll([
      header('deepseek-official', 'deepseek-v4-flash'),
      messageUsage(1, 1, 1100, 210),
      context('openai', 'gpt-4o'),
      messageUsage(2, 1, 500, 80),
    ])
    expect(value.providers).toHaveLength(2)
    expect(value.providers[0]).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      uncachedInputTokens: 1100,
      outputTokens: 210,
      steps: 1,
    })
    expect(value.providers[1]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      uncachedInputTokens: 500,
      outputTokens: 80,
      steps: 1,
    })
    expect(value.total).toEqual({
      uncachedInputTokens: 1600,
      outputTokens: 290,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(value.currency).toBe('CNY')
    expect(value.peakHours).toBeUndefined()
  })

  it('prices each provider row and the total at the configured rates', () => {
    seq.value = 0
    const value = foldAll([
      header('deepseek-official', 'deepseek-v4-flash'),
      messageUsage(1, 1, 1000, 100), // 0.001 input + 0.0002 output
      context('openai', 'gpt-4o'),
      messageUsage(2, 1, 2000, 100), // 0.006 input + 0.0006 output
    ])
    expect(value.providers[0]?.cost).toBeCloseTo(0.001 + 0.0002, 10)
    expect(value.providers[1]?.cost).toBeCloseTo(0.006 + 0.0006, 10)
    expect(value.totalCost).toBeCloseTo(0.001 + 0.0002 + 0.006 + 0.0006, 10)
    expect(value.unattributedCost).toBe(0)
  })

  it('prices peak-hour samples at the peak rate and exposes the tier clock', () => {
    seq.value = 0
    const value = foldAll([
      header('deepseek-official', 'deepseek-v4-flash'),
      messageUsage(1, 1, 1000, 100, { time: TIME.offPeak }), // base: 0.001 + 0.0002
      messageUsage(1, 2, 1000, 100, { time: TIME.peak }),   // peak: 0.002 + 0.0004
    ], tieredSpec())
    expect(value.providers[0]?.cost).toBeCloseTo(0.0012 + 0.0024, 10)
    expect(value.totalCost).toBeCloseTo(0.0036, 10)
    expect(value.peakHours).toEqual([{ start: 1, end: 2 }])
    expect(value.timeZone).toBe('UTC')
  })

  it('replaces a same-step sample across a tier boundary without double counting', () => {
    seq.value = 0
    const value = foldAll([
      header('deepseek-official', 'deepseek-v4-flash'),
      // chunk at off-peak time, final message at peak time — same step
      {
        type: 'assistant/chunk',
        seq: nextSeq(),
        time: TIME.offPeak,
        data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 100 } } },
      } as unknown as SessionEvent,
      messageUsage(1, 1, 1000, 100, { time: TIME.peak }),
      messageUsage(1, 2, 500, 50, { time: TIME.offPeak }),
    ], tieredSpec())
    expect(value.providers[0]).toMatchObject({ uncachedInputTokens: 1500, outputTokens: 150, steps: 2 })
    // step 1 billed at peak rate only (chunk replaced), step 2 at base
    expect(value.providers[0]?.cost).toBeCloseTo((0.002 + 0.0004) + (0.0005 + 0.0001), 10)
    expect(value.totalCost).toBeCloseTo(0.003, 10)
  })

  it('keeps usage samples that landed before any route in the unattributed bucket', () => {
    seq.value = 0
    const value = foldAll([
      messageUsage(0, 1, 100, 10),
      header('deepseek-official', 'deepseek-v4-flash'),
      messageUsage(1, 1, 200, 20),
    ])
    expect(value.providers).toHaveLength(1)
    expect(value.providers[0]).toMatchObject({
      provider: 'deepseek-official',
      uncachedInputTokens: 200,
      outputTokens: 20,
    })
    expect(value.unattributed).toEqual({
      uncachedInputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(value.total).toEqual({
      uncachedInputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    // unattributed priced at the default rate
    expect(value.unattributedCost).toBeCloseTo((100 * 10 + 10 * 20) / 1_000_000, 10)
  })

  it('carries cache buckets into per-provider rows and totals', () => {
    seq.value = 0
    const value = foldAll([
      context('openai', 'gpt-4o'),
      {
        type: 'assistant/message',
        seq: 1,
        time: 1,
        data: {
          turn: 1,
          step: 1,
          message: { role: 'assistant', content: [], id: 'm' },
          usage: { inputTokens: 500, outputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 200 },
        },
      } as unknown as SessionEvent,
    ])
    expect(value.providers[0]).toMatchObject({
      provider: 'openai',
      uncachedInputTokens: 500,
      cacheReadTokens: 300,
      cacheWriteTokens: 200,
    })
    expect(value.total).toEqual({
      uncachedInputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 300,
      cacheWriteTokens: 200,
    })
  })

  it('serves the official pricing page URL and currency as display metadata', () => {
    seq.value = 0
    const spec = createPricingSpec({
      currency: 'CNY',
      prices: { 'deepseek-official': { inputPerM: 1, cacheReadPerM: 0.5, cacheWritePerM: 1, outputPerM: 2 } },
      priceUrls: { 'deepseek-official': 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/' },
    })
    const definition = createContextUsageProjectionDefinition(spec)
    let state = definition.init()
    state = definition.apply(state, header('deepseek-official', 'deepseek-v4-flash') as SessionEvent)
    state = definition.apply(state, messageUsage(1, 1, 100, 10) as SessionEvent)
    const value = definition.wire.view(state as ContextUsageState)
    expect(value.providers[0]?.priceUrl).toBe('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/')
    expect(value.currency).toBe('CNY')
    expect(value.peakHours).toBeUndefined()
  })

  it('prices at the shipped flat default when no config is supplied', () => {
    seq.value = 0
    const spec = createPricingSpec({})
    const definition = createContextUsageProjectionDefinition(spec)
    let state = definition.init()
    state = definition.apply(state, header('deepseek-official', 'deepseek-v4-flash') as SessionEvent)
    state = definition.apply(state, messageUsage(1, 1, 1_000_000, 1_000_000, { cacheRead: 1_000_000, cacheWrite: 1_000_000 }) as SessionEvent)
    const value = definition.wire.view(state as ContextUsageState)
    // DEFAULT_PRICE off-peak base: miss 1.5, hit 0.05, write 1.5, output 4.5
    expect(value.currency).toBe('CNY')
    expect(value.peakHours).toBeUndefined()
    expect(value.providers[0]?.cost).toBeCloseTo(1.5 + 4.5 + 0.05 + 1.5, 10)
  })

  it('is deterministic under replay', () => {
    seq.value = 0
    const events = [
      header('deepseek-official', 'deepseek-v4-flash'),
      messageUsage(1, 1, 1100, 210, { time: TIME.offPeak }),
      messageUsage(1, 2, 400, 40, { time: TIME.peak }),
      context('openai', 'gpt-4o'),
      messageUsage(2, 1, 500, 80, { time: TIME.peak }),
    ]
    const first = foldAll(events, tieredSpec())
    seq.value = 0
    const second = foldAll(events, tieredSpec())
    expect(second).toEqual(first)
  })
})
