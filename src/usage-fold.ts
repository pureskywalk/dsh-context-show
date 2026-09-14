/**
 * Pure per-provider usage fold for the `contextUsage` session projection.
 *
 * The fold attributes every provider-reported usage sample (the usage an
 * `assistant/message` or `assistant/attempt` settlement reports, directly or
 * through the last usage chunk of its compact stream) to the provider/model
 * route in force at that step — the latest `request/context` or
 * `request/header` route record. Per (turn, step), a repeated sample
 * replaces the step's earlier value instead of double counting it, exactly
 * like the token-meter `tokenUsage` unit; `llm/retry-started` closes the
 * replacement slot so a retried attempt adds instead of replacing. Each
 * provider keeps its own last-sample slot because the session-log invariant
 * guarantees a step's usage samples are adjacent and share one route.
 *
 * Money pricing is time-aware: every sample is bucketed as peak or off-peak
 * by its event time (the configured peak-hour windows, evaluated in the
 * configured timezone), and the view prices each tier's buckets with the
 * tier's rate. A step that crosses a tier boundary (chunk before midnight,
 * final sample after) replaces the earlier contribution in the tier it
 * originally landed in, so totals never double count.
 *
 * State is plain JSON (the projection-cache precondition): the provider
 * table is a record keyed by `provider\0model` plus a first-use order list,
 * and each row keeps two bucket sets (peak / off-peak). Prices and peak
 * windows are NOT part of the fold state — the view prices the accumulated
 * tier buckets against the configured `PricingSpec`, so a price edit
 * re-derives every figure without replaying the log.
 *
 * @module dsh-context-show/usage-fold
 */

import { z } from 'zod'
import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the llm/retry-started key into the host SessionEventMap.
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ContextUsageProjection, ProviderUsageProjection } from './projection.ts'

/** Route separator inside the provider table key (never valid in a route id). */
const ROUTE_SEPARATOR = '\u0000'

/** Key of the provider table row for one route. */
const routeKeyOf = (provider: string, model: string): string => provider + ROUTE_SEPARATOR + model

/** Base price fields of one route, per 1M tokens in the configured currency. */
export interface TokenPriceBase {
  /** Per 1M uncached (cache-miss) input tokens. */
  inputPerM: number
  /** Per 1M cached-read (cache-hit) input tokens. */
  cacheReadPerM: number
  /** Per 1M cache-write tokens. */
  cacheWritePerM: number
  /** Per 1M output tokens. */
  outputPerM: number
}

/**
 * Prices per 1M tokens of one route, in the configured currency. The base
 * fields are the OFF-PEAK rate; the optional `peak` object overrides
 * individual fields for peak-hour samples (absent fields fall back to the
 * base, and an absent `peak` means flat pricing).
 */
export interface TokenPrice extends TokenPriceBase {
  /** Peak-hour rate overrides; missing fields fall back to the base rate. */
  peak?: Partial<TokenPriceBase>
}

/** Model-keyed price override map of one provider (model id → price). */
export type ProviderPriceMap = Record<string, TokenPrice>

/** Peak-hour window: inclusive `start`, exclusive `end`, 24h local hours. */
export interface PeakHourRange {
  start: number
  end: number
}

/** Price lookup face the projection view closes over. */
export interface PriceResolver {
  /**
   * Resolve the price of one route: model override, then provider entry,
   * then the fallback. Unknown providers price at the fallback instead of
   * failing, so a route added later keeps the panel honest with an
   * explicit "default price" label.
   * @param provider - registered provider route key.
   * @param model - provider-owned model id.
   * @returns the effective price.
   */
  resolve(provider: string, model: string): TokenPrice
}

/** Everything the fold's view needs to price the accumulated buckets. */
export interface PricingSpec {
  /** ISO 4217-style currency code, served to the client for formatting. */
  currency: string
  /** Route → price lookup (base = off-peak rate). */
  resolve(provider: string, model: string): TokenPrice
  /** Provider → official pricing page URL, when configured. */
  priceUrl?(provider: string): string | undefined
  /** Peak-hour windows; empty means flat pricing. */
  peakHours?: readonly PeakHourRange[]
  /** IANA timezone the peak windows are evaluated in. */
  timeZone?: string
  /** Whether the given event time falls in a peak window. */
  isPeakHour(timeMs: number): boolean
  /** Clock used to decide which day "today" is; defaults to `Date.now`. */
  now?(): number
}

/**
 * Default DeepSeek official pricing (deepseek-flash / V4.1-Flash tier, CNY —
 * the peak / off-peak scheme in force since 2026-09; off-peak = half of peak).
 * Base fields are the OFF-PEAK rate; `peak` overrides the peak-hour rate.
 * Cache writes bill at the cache-miss rate.
 */
export const DEFAULT_PRICE: TokenPrice = Object.freeze({
  inputPerM: 1,
  cacheReadPerM: 0.02,
  cacheWritePerM: 1,
  outputPerM: 4,
  peak: Object.freeze({
    inputPerM: 2,
    cacheReadPerM: 0.04,
    cacheWritePerM: 2,
    outputPerM: 8,
  }),
})

/** DeepSeek official route defaults for the shipped composition. */
export const DEFAULT_PROVIDER_PRICES: Record<string, TokenPrice> = Object.freeze({
  'deepseek-official': DEFAULT_PRICE,
})

/** DeepSeek peak hours (Beijing time, weekdays only): 9:00-12:00 and 14:00-18:00. */
export const DEFAULT_PEAK_HOURS: readonly PeakHourRange[] = Object.freeze([
  { start: 9, end: 12 },
  { start: 14, end: 18 },
])

/** Default timezone DeepSeek bills its peak hours in. */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/**
 * Build a price resolver from the plugin configuration.
 * @param prices - provider-keyed price entries.
 * @param modelPrices - `provider/model`-keyed model-level overrides.
 * @param fallback - price for unknown providers/models.
 * @returns the resolver.
 */
export function createPriceResolver(
  prices: Record<string, TokenPrice> = {},
  modelPrices: Record<string, TokenPrice> = {},
  fallback: TokenPrice = DEFAULT_PRICE,
): PriceResolver {
  return {
    resolve(provider, model) {
      return modelPrices[provider + '/' + model]
        ?? prices[provider]
        ?? fallback
    },
  }
}

/** Peak rate of one price: base fields overridden by the defined peak fields. */
export function effectivePeak(price: TokenPrice): TokenPrice {
  const { peak, ...base } = price
  if (peak === undefined) return base
  const merged: TokenPrice = { ...base }
  for (const key of ['inputPerM', 'cacheReadPerM', 'cacheWritePerM', 'outputPerM'] as const) {
    const value = peak[key]
    if (value !== undefined) merged[key] = value
  }
  return merged
}

/** Hour (0-23) of an epoch-ms instant in the given IANA timezone. */
function hourInTimeZone(timeMs: number, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(timeMs))
  return Number(hour)
}

/** Whether the instant is Saturday or Sunday in the given IANA timezone. */
function isWeekendInTimeZone(timeMs: number, timeZone: string): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(timeMs))
  return weekday === 'Sat' || weekday === 'Sun'
}

/**
 * Whether an instant falls in any peak window (supports ranges that wrap
 * midnight via start > end).
 * @param timeMs - epoch milliseconds.
 * @param ranges - peak windows; empty means never peak.
 * @param timeZone - IANA timezone the windows are evaluated in.
 * @returns whether the instant is a peak hour.
 */
export function isPeakHour(
  timeMs: number,
  ranges: readonly PeakHourRange[],
  timeZone = DEFAULT_TIME_ZONE,
): boolean {
  if (ranges.length === 0) return false
  // DeepSeek's peak windows apply on weekdays only; weekends are off-peak.
  if (isWeekendInTimeZone(timeMs, timeZone)) return false
  const hour = hourInTimeZone(timeMs, timeZone)
  for (const range of ranges) {
    if (range.start <= range.end
      ? hour >= range.start && hour < range.end
      : hour >= range.start || hour < range.end) return true
  }
  return false
}

/**
 * Build a `PricingSpec` from the plugin configuration: price resolution,
 * currency, official price links, and the peak/off-peak clock.
 * @param config - resolved plugin config.
 * @returns the pricing spec captured by the projection unit.
 */
export function createPricingSpec(config: {
  currency?: string
  prices?: Record<string, TokenPrice>
  modelPrices?: Record<string, TokenPrice>
  defaultPrice?: TokenPrice
  priceUrls?: Record<string, string>
  defaultPriceUrl?: string
  peakHours?: readonly PeakHourRange[]
  timeZone?: string
}): PricingSpec {
  const resolver = createPriceResolver(config.prices, config.modelPrices, config.defaultPrice)
  const peakHours = config.peakHours ?? []
  const timeZone = config.timeZone ?? DEFAULT_TIME_ZONE
  return {
    currency: config.currency ?? 'CNY',
    resolve: (provider, model) => resolver.resolve(provider, model),
    priceUrl: (provider) => config.priceUrls?.[provider] ?? config.defaultPriceUrl,
    isPeakHour: (timeMs) => isPeakHour(timeMs, peakHours, timeZone),
    now: () => Date.now(),
    ...(peakHours.length === 0 ? {} : { peakHours, timeZone }),
  }
}

const zeroBuckets = (): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/** One provider row's tiered bucket sets. */
interface TierBuckets {
  peak: TokenUsageProjection
  offPeak: TokenUsageProjection
}

const zeroTierBuckets = (): TierBuckets => ({ peak: zeroBuckets(), offPeak: zeroBuckets() })

const bucketsFrom = (usage: TokenUsage): TokenUsageProjection => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

const bucketsEqual = (left: TokenUsageProjection, right: TokenUsageProjection): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

const addBuckets = (target: TokenUsageProjection, source: TokenUsageProjection): TokenUsageProjection => ({
  uncachedInputTokens: target.uncachedInputTokens + source.uncachedInputTokens,
  outputTokens: target.outputTokens + source.outputTokens,
  cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
  cacheWriteTokens: target.cacheWriteTokens + source.cacheWriteTokens,
})

const subBuckets = (target: TokenUsageProjection, source: TokenUsageProjection): TokenUsageProjection => ({
  uncachedInputTokens: target.uncachedInputTokens - source.uncachedInputTokens,
  outputTokens: target.outputTokens - source.outputTokens,
  cacheReadTokens: target.cacheReadTokens - source.cacheReadTokens,
  cacheWriteTokens: target.cacheWriteTokens - source.cacheWriteTokens,
})

/** One usage sample keyed by its step, mirroring the token-meter unit. */
interface UsageSample {
  turn: number
  step: number
  buckets: TokenUsageProjection
  tier: 'peak' | 'offPeak'
  /** Billing day (`YYYY-MM-DD` in the pricing timezone) the sample landed on. */
  day: string
}

/** Per-day, per-route tiered buckets: day → route key (`provider\0model`, `` = unattributed) → buckets. */
type UsageDays = Record<string, Record<string, TierBuckets>>

/** One provider/model row of the fold state. */
interface ProviderState {
  provider: string
  model: string
  buckets: TierBuckets
  last: UsageSample | null
  steps: number
}

/** Plain-JSON fold state of the `contextUsage` unit. */
export interface ContextUsageState {
  /** Route in force for the next usage sample; undefined before any route record. */
  route: { provider: string; model: string } | undefined
  /** Provider rows keyed by `provider\0model`. */
  providers: Record<string, ProviderState>
  /** First-use order of the provider table keys. */
  order: string[]
  /** Usage samples that landed before any route was known. */
  unattributed: TierBuckets
  /** Last unattributed sample, for same-step replacement. */
  unattributedLast: UsageSample | null
  /**
   * Same samples keyed by billing day, so the panel can report "today"
   * without replaying: day → route key → tiered buckets. Same-step
   * replacement subtracts from the day the replaced sample landed on.
   */
  days: UsageDays
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    contextUsage: ContextUsageState
  }
}

const bucketSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

const providerSchema = z.object({
  provider: z.string(),
  model: z.string(),
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  priceUrl: z.string().optional(),
}).strict()

const peakHourSchema = z.object({
  start: z.number().int().min(0).max(23),
  end: z.number().int().min(0).max(24),
}).strict()

const usageSampleSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  buckets: bucketSchema,
  tier: z.enum(['peak', 'offPeak']),
  day: z.string(),
}).strict()

const tierBucketsSchema = z.object({
  peak: bucketSchema,
  offPeak: bucketSchema,
}).strict()

const providerStateSchema = z.object({
  provider: z.string(),
  model: z.string(),
  buckets: tierBucketsSchema,
  last: usageSampleSchema.nullable(),
  steps: z.number().int().nonnegative(),
}).strict()

const contextUsageStateSchema = z.object({
  route: z.object({ provider: z.string(), model: z.string() }).strict().optional(),
  providers: z.record(z.string(), providerStateSchema),
  order: z.array(z.string()),
  unattributed: tierBucketsSchema,
  unattributedLast: usageSampleSchema.nullable(),
  days: z.record(z.string(), z.record(z.string(), tierBucketsSchema)),
}).strict() as unknown as z.ZodType<ContextUsageState>

const contextUsageSchema = z.object({
  currency: z.string(),
  total: bucketSchema,
  providers: z.array(providerSchema),
  unattributed: bucketSchema,
  totalCost: z.number().nonnegative(),
  unattributedCost: z.number().nonnegative(),
  today: z.object({
    date: z.string(),
    cost: z.number().nonnegative(),
    total: bucketSchema,
  }).strict(),
  peakHours: z.array(peakHourSchema).optional(),
  timeZone: z.string().optional(),
}).strict() as unknown as z.ZodType<ContextUsageProjection>

/**
 * The usage one durable Assistant settlement reports for its attempt, if any:
 * the settlement's own `usage` field wins; otherwise the last usage chunk
 * embedded in its compact stream (mirrors the token-meter tokenUsage unit).
 */
function usageOf(event: SessionEvent): TokenUsage | undefined {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  // The settlement's own usage wins; otherwise the last usage chunk embedded
  // in its compact stream (same helper the token-meter unit uses).
  return lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
}

/** Billing day (`YYYY-MM-DD`) of one instant in the pricing timezone. */
export function dayKeyOf(timeMs: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(timeMs))
}

/** Add one sample's buckets to its day/route cell (returns a fresh `days`). */
function addToDays(
  days: UsageDays,
  day: string,
  route: string,
  tier: 'peak' | 'offPeak',
  buckets: TokenUsageProjection,
): UsageDays {
  const dayRow = days[day] ?? {}
  const cell = dayRow[route] ?? zeroTierBuckets()
  const nextCell: TierBuckets = { peak: cell.peak, offPeak: cell.offPeak }
  nextCell[tier] = addBuckets(cell[tier], buckets)
  return { ...days, [day]: { ...dayRow, [route]: nextCell } }
}

/** Subtract a replaced sample's buckets from its day/route cell. */
function subFromDays(
  days: UsageDays,
  day: string,
  route: string,
  tier: 'peak' | 'offPeak',
  buckets: TokenUsageProjection,
): UsageDays {
  const dayRow = days[day]
  const cell = dayRow?.[route]
  if (dayRow === undefined || cell === undefined) return days
  const nextCell: TierBuckets = { peak: cell.peak, offPeak: cell.offPeak }
  nextCell[tier] = subBuckets(cell[tier], buckets)
  return { ...days, [day]: { ...dayRow, [route]: nextCell } }
}

/** Resolve the price of a `provider\0model` day-cell key (`` = unattributed). */
function priceOfRouteKey(route: string, resolve: PricingSpec['resolve']): TokenPrice {
  const at = route.indexOf(ROUTE_SEPARATOR)
  return at === -1 ? resolve('', '') : resolve(route.slice(0, at), route.slice(at + 1))
}

/** Place one sample into a tiered bucket set, replacing a same-step sample in its original tier. */
function applySample(
  buckets: TierBuckets,
  last: UsageSample | null,
  sample: UsageSample,
): { buckets: TierBuckets; last: UsageSample } {
  const next: TierBuckets = { peak: buckets.peak, offPeak: buckets.offPeak }
  if (last !== null && last.turn === sample.turn && last.step === sample.step) {
    next[last.tier] = subBuckets(next[last.tier], last.buckets)
    next[sample.tier] = addBuckets(next[sample.tier], sample.buckets)
  } else {
    next[sample.tier] = addBuckets(next[sample.tier], sample.buckets)
  }
  return { buckets: next, last: sample }
}

/** Attribute one usage sample to the fold target, applying same-step replacement. */
function attribute(
  state: ContextUsageState,
  turn: number,
  step: number,
  usage: TokenUsage,
  isPeak: boolean,
  day: string,
): ContextUsageState {
  const buckets = bucketsFrom(usage)
  const sample: UsageSample = { turn, step, buckets, tier: isPeak ? 'peak' : 'offPeak', day }
  const route = state.route

  if (route === undefined) {
    const previous = state.unattributedLast
    const applied = applySample(state.unattributed, previous, sample)
    const unchanged = previous !== null
      && applied.last.tier === previous.tier
      && bucketsEqual(applied.last.buckets, previous.buckets)
    // Same-step replacement also moves the day bucket: subtract the replaced
    // sample from its own day before adding the new one.
    let days = state.days
    if (previous !== null && previous.turn === turn && previous.step === step) {
      days = subFromDays(days, previous.day, '', previous.tier, previous.buckets)
    }
    days = addToDays(days, day, '', sample.tier, sample.buckets)
    if (unchanged && days === state.days
      && bucketsEqual(applied.buckets[applied.last.tier], state.unattributed[applied.last.tier])) return state
    return { ...state, unattributed: applied.buckets, unattributedLast: applied.last, days }
  }

  const key = routeKeyOf(route.provider, route.model)
  const existing = state.providers[key]
  const previous = existing?.last ?? null
  const applied = applySample(existing?.buckets ?? zeroTierBuckets(), previous, sample)
  const replaced = previous !== null && previous.turn === turn && previous.step === step
  let days = state.days
  if (previous !== null && replaced) {
    days = subFromDays(days, previous.day, key, previous.tier, previous.buckets)
  }
  days = addToDays(days, day, key, sample.tier, sample.buckets)
  const nextEntry: ProviderState = {
    provider: route.provider,
    model: route.model,
    buckets: applied.buckets,
    last: applied.last,
    steps: (existing?.steps ?? 0) + (replaced ? 0 : 1),
  }
  return {
    ...state,
    providers: { ...state.providers, [key]: nextEntry },
    order: existing === undefined ? [...state.order, key] : state.order,
    days,
  }
}

/**
 * Close the same-step replacement slot for a retried attempt: a retry
 * re-runs the step, so its new usage sample must ADD to the totals instead of
 * replacing the abandoned attempt's sample. Mirrors the token-meter unit's
 * `llm/retry-started` handling; the buckets already accumulated stay put.
 */
function closeStep(state: ContextUsageState, turn: number, step: number): ContextUsageState {
  const route = state.route
  const key = route === undefined ? undefined : routeKeyOf(route.provider, route.model)
  const entry = key === undefined ? undefined : state.providers[key]
  const closesEntry = entry?.last !== null && entry !== undefined
    && entry.last !== null
    && entry.last.turn === turn
    && entry.last.step === step
  const closesUnattributed = state.unattributedLast !== null
    && state.unattributedLast.turn === turn
    && state.unattributedLast.step === step
  if (!closesEntry && !closesUnattributed) return state
  return {
    ...state,
    ...closesEntry && key !== undefined && entry !== undefined ? {
      providers: { ...state.providers, [key]: { ...entry, last: null } },
    } : {},
    ...closesUnattributed ? { unattributedLast: null } : {},
  }
}

const sumBuckets = (target: TokenUsageProjection, source: TokenUsageProjection): TokenUsageProjection => ({
  uncachedInputTokens: target.uncachedInputTokens + source.uncachedInputTokens,
  outputTokens: target.outputTokens + source.outputTokens,
  cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
  cacheWriteTokens: target.cacheWriteTokens + source.cacheWriteTokens,
})

/** Cost of one bucket set under one price, in the configured currency. */
function costOf(buckets: TokenUsageProjection, price: TokenPrice): number {
  return (
    buckets.uncachedInputTokens * price.inputPerM
    + buckets.cacheReadTokens * price.cacheReadPerM
    + buckets.cacheWriteTokens * price.cacheWritePerM
    + buckets.outputTokens * price.outputPerM
  ) / 1_000_000
}

/** Cost of one tiered bucket set: peak priced at the peak rate, off-peak at the base rate. */
function costOfTiered(buckets: TierBuckets, price: TokenPrice): number {
  return costOf(buckets.peak, effectivePeak(price)) + costOf(buckets.offPeak, price)
}

/**
 * Create the replayable `contextUsage` projection definition, priced by the
 * given spec. The spec is captured at registration time; a price or peak
 * window change re-registers the unit (same pattern as live-stats),
 * re-deriving every figure from the accumulated tier buckets without
 * replaying the log.
 * @param spec - pricing spec: currency, route prices, links, peak clock.
 * @returns the replayable `contextUsage` projection definition.
 */
export function createContextUsageProjectionDefinition(spec: PricingSpec) {
  return {
    key: 'contextUsage',
    stateSchema: contextUsageStateSchema,
    init: () => ({
      route: undefined,
      providers: {},
      order: [],
      unattributed: zeroTierBuckets(),
      unattributedLast: null,
      days: {},
    }),
    apply: (state, event) => {
      if (event.type === 'request/context') {
        const { provider, model } = event.data
        if (state.route?.provider === provider && state.route.model === model) return state
        return { ...state, route: { provider, model } }
      }
      if (event.type === 'request/header') {
        const { provider, model } = event.data.header.config
        if (state.route?.provider === provider && state.route.model === model) return state
        return { ...state, route: { provider, model } }
      }
      if (event.type === 'llm/retry-started') {
        return closeStep(state, event.data.turn, event.data.step)
      }
      // 0.1.3-alpha.1: usage rides the durable Assistant settlements only —
      // assistant/message carries it in `usage` or its compact stream, and
      // assistant/attempt carries a stream with no surface message.
      if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
      const usage = usageOf(event)
      if (usage === undefined) return state
      const { turn, step } = event.data
      return attribute(state, turn, step, usage, spec.isPeakHour(event.time), dayKeyOf(event.time, spec.timeZone))
    },
    wire: {
      viewSchema: contextUsageSchema,
      view: (state): ContextUsageProjection => {
        let total = zeroBuckets()
      let totalCost = 0
      const providers: ProviderUsageProjection[] = []
      for (const key of state.order) {
        const entry = state.providers[key]
        if (entry === undefined) continue
        const tiered = sumBuckets(entry.buckets.peak, entry.buckets.offPeak)
        total = sumBuckets(total, tiered)
        const price = spec.resolve(entry.provider, entry.model)
        const cost = costOfTiered(entry.buckets, price)
        totalCost += cost
        const priceUrl = spec.priceUrl?.(entry.provider)
        providers.push({
          provider: entry.provider,
          model: entry.model,
          ...tiered,
          steps: entry.steps,
          cost,
          ...(priceUrl === undefined ? {} : { priceUrl }),
        })
      }
      const unattributedTiered = sumBuckets(state.unattributed.peak, state.unattributed.offPeak)
      const unattributedCost = costOfTiered(state.unattributed, spec.resolve('', ''))
      // "Today" (pricing timezone) spend over the day's route cells. The
      // client sums these per-Session figures across the Session list to
      // report the current workspace's / every workspace's daily spend.
      const todayKey = dayKeyOf(spec.now?.() ?? Date.now(), spec.timeZone)
      const todayRow = state.days[todayKey] ?? {}
      let todayCost = 0
      let todayTotal = zeroBuckets()
      for (const [route, tiered] of Object.entries(todayRow)) {
        todayTotal = sumBuckets(todayTotal, sumBuckets(tiered.peak, tiered.offPeak))
        todayCost += costOfTiered(tiered, priceOfRouteKey(route, spec.resolve))
      }
      return {
        currency: spec.currency,
        total: sumBuckets(total, unattributedTiered),
        providers,
        unattributed: unattributedTiered,
        totalCost: totalCost + unattributedCost,
        unattributedCost,
        today: { date: todayKey, cost: todayCost, total: todayTotal },
        ...(spec.peakHours === undefined || spec.peakHours.length === 0 ? {} : {
          peakHours: spec.peakHours,
          timeZone: spec.timeZone,
        }),
        }
      },
    },
    // 3: settlement-stream usage (0.1.3-alpha.1). 4: per-day buckets for the
    // "today" spend figures, so any persisted cache must rebuild.
    stateVersion: 4,
  } satisfies ProjectionDefinition<'contextUsage', ContextUsageState>
}
