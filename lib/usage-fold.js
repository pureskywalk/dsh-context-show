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
import { z } from 'zod';
import { expandAssistantStream } from '@deepseek-ai/dsh-llm';
/** Route separator inside the provider table key (never valid in a route id). */
const ROUTE_SEPARATOR = '\u0000';
/** Key of the provider table row for one route. */
const routeKeyOf = (provider, model) => provider + ROUTE_SEPARATOR + model;
/**
 * Default DeepSeek official pricing (deepseek-v4-flash tier, CNY — the
 * peak / off-peak scheme effective 2026-08-17; off-peak = half of peak).
 * Base fields are the OFF-PEAK rate; `peak` overrides the peak-hour rate.
 */
export const DEFAULT_PRICE = Object.freeze({
    inputPerM: 1.5,
    cacheReadPerM: 0.05,
    cacheWritePerM: 1.5,
    outputPerM: 4.5,
    peak: Object.freeze({
        inputPerM: 3,
        cacheReadPerM: 0.1,
        cacheWritePerM: 3,
        outputPerM: 9,
    }),
});
/** DeepSeek official route defaults for the shipped composition. */
export const DEFAULT_PROVIDER_PRICES = Object.freeze({
    'deepseek-official': DEFAULT_PRICE,
});
/** DeepSeek peak hours (Beijing time, weekdays only): 9:00-12:00 and 14:00-18:00. */
export const DEFAULT_PEAK_HOURS = Object.freeze([
    { start: 9, end: 12 },
    { start: 14, end: 18 },
]);
/** Default timezone DeepSeek bills its peak hours in. */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
/**
 * Build a price resolver from the plugin configuration.
 * @param prices - provider-keyed price entries.
 * @param modelPrices - `provider/model`-keyed model-level overrides.
 * @param fallback - price for unknown providers/models.
 * @returns the resolver.
 */
export function createPriceResolver(prices = {}, modelPrices = {}, fallback = DEFAULT_PRICE) {
    return {
        resolve(provider, model) {
            return modelPrices[provider + '/' + model]
                ?? prices[provider]
                ?? fallback;
        },
    };
}
/** Peak rate of one price: base fields overridden by the defined peak fields. */
export function effectivePeak(price) {
    const { peak, ...base } = price;
    if (peak === undefined)
        return base;
    const merged = { ...base };
    for (const key of ['inputPerM', 'cacheReadPerM', 'cacheWritePerM', 'outputPerM']) {
        const value = peak[key];
        if (value !== undefined)
            merged[key] = value;
    }
    return merged;
}
/** Hour (0-23) of an epoch-ms instant in the given IANA timezone. */
function hourInTimeZone(timeMs, timeZone) {
    const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(timeMs));
    return Number(hour);
}
/** Whether the instant is Saturday or Sunday in the given IANA timezone. */
function isWeekendInTimeZone(timeMs, timeZone) {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(timeMs));
    return weekday === 'Sat' || weekday === 'Sun';
}
/**
 * Whether an instant falls in any peak window (supports ranges that wrap
 * midnight via start > end).
 * @param timeMs - epoch milliseconds.
 * @param ranges - peak windows; empty means never peak.
 * @param timeZone - IANA timezone the windows are evaluated in.
 * @returns whether the instant is a peak hour.
 */
export function isPeakHour(timeMs, ranges, timeZone = DEFAULT_TIME_ZONE) {
    if (ranges.length === 0)
        return false;
    // DeepSeek's peak windows apply on weekdays only; weekends are off-peak.
    if (isWeekendInTimeZone(timeMs, timeZone))
        return false;
    const hour = hourInTimeZone(timeMs, timeZone);
    for (const range of ranges) {
        if (range.start <= range.end
            ? hour >= range.start && hour < range.end
            : hour >= range.start || hour < range.end)
            return true;
    }
    return false;
}
/**
 * Build a `PricingSpec` from the plugin configuration: price resolution,
 * currency, official price links, and the peak/off-peak clock.
 * @param config - resolved plugin config.
 * @returns the pricing spec captured by the projection unit.
 */
export function createPricingSpec(config) {
    const resolver = createPriceResolver(config.prices, config.modelPrices, config.defaultPrice);
    const peakHours = config.peakHours ?? [];
    const timeZone = config.timeZone ?? DEFAULT_TIME_ZONE;
    return {
        currency: config.currency ?? 'CNY',
        resolve: (provider, model) => resolver.resolve(provider, model),
        priceUrl: (provider) => config.priceUrls?.[provider] ?? config.defaultPriceUrl,
        isPeakHour: (timeMs) => isPeakHour(timeMs, peakHours, timeZone),
        ...(peakHours.length === 0 ? {} : { peakHours, timeZone }),
    };
}
const zeroBuckets = () => ({
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
});
const zeroTierBuckets = () => ({ peak: zeroBuckets(), offPeak: zeroBuckets() });
const bucketsFrom = (usage) => ({
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
});
const bucketsEqual = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens;
const addBuckets = (target, source) => ({
    uncachedInputTokens: target.uncachedInputTokens + source.uncachedInputTokens,
    outputTokens: target.outputTokens + source.outputTokens,
    cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
    cacheWriteTokens: target.cacheWriteTokens + source.cacheWriteTokens,
});
const subBuckets = (target, source) => ({
    uncachedInputTokens: target.uncachedInputTokens - source.uncachedInputTokens,
    outputTokens: target.outputTokens - source.outputTokens,
    cacheReadTokens: target.cacheReadTokens - source.cacheReadTokens,
    cacheWriteTokens: target.cacheWriteTokens - source.cacheWriteTokens,
});
const bucketSchema = z.object({
    uncachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
}).strict();
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
}).strict();
const peakHourSchema = z.object({
    start: z.number().int().min(0).max(23),
    end: z.number().int().min(0).max(24),
}).strict();
const usageSampleSchema = z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    buckets: bucketSchema,
    tier: z.enum(['peak', 'offPeak']),
}).strict();
const tierBucketsSchema = z.object({
    peak: bucketSchema,
    offPeak: bucketSchema,
}).strict();
const providerStateSchema = z.object({
    provider: z.string(),
    model: z.string(),
    buckets: tierBucketsSchema,
    last: usageSampleSchema.nullable(),
    steps: z.number().int().nonnegative(),
}).strict();
const contextUsageStateSchema = z.object({
    route: z.object({ provider: z.string(), model: z.string() }).strict().optional(),
    providers: z.record(z.string(), providerStateSchema),
    order: z.array(z.string()),
    unattributed: tierBucketsSchema,
    unattributedLast: usageSampleSchema.nullable(),
}).strict();
const contextUsageSchema = z.object({
    currency: z.string(),
    total: bucketSchema,
    providers: z.array(providerSchema),
    unattributed: bucketSchema,
    totalCost: z.number().nonnegative(),
    unattributedCost: z.number().nonnegative(),
    peakHours: z.array(peakHourSchema).optional(),
    timeZone: z.string().optional(),
}).strict();
/**
 * The usage one durable Assistant settlement reports for its attempt, if any:
 * the settlement's own `usage` field wins; otherwise the last usage chunk
 * embedded in its compact stream (mirrors the token-meter tokenUsage unit).
 */
function usageOf(event) {
    if (event.type === 'assistant/message' && event.data.usage !== undefined)
        return event.data.usage;
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt')
        return undefined;
    // Scan the compact stream backwards for its last usage chunk (ES2022-safe:
    // no Array.prototype.toReversed in the host program's lib).
    const members = expandAssistantStream(event.data.stream);
    for (let index = members.length - 1; index >= 0; index -= 1) {
        const member = members[index];
        if (member === undefined)
            continue;
        if (member.chunk.type === 'usage')
            return member.chunk.usage;
    }
    return undefined;
}
/** Place one sample into a tiered bucket set, replacing a same-step sample in its original tier. */
function applySample(buckets, last, sample) {
    const next = { peak: buckets.peak, offPeak: buckets.offPeak };
    if (last !== null && last.turn === sample.turn && last.step === sample.step) {
        next[last.tier] = subBuckets(next[last.tier], last.buckets);
        next[sample.tier] = addBuckets(next[sample.tier], sample.buckets);
    }
    else {
        next[sample.tier] = addBuckets(next[sample.tier], sample.buckets);
    }
    return { buckets: next, last: sample };
}
/** Attribute one usage sample to the fold target, applying same-step replacement. */
function attribute(state, turn, step, usage, isPeak) {
    const buckets = bucketsFrom(usage);
    const sample = { turn, step, buckets, tier: isPeak ? 'peak' : 'offPeak' };
    const route = state.route;
    if (route === undefined) {
        const applied = applySample(state.unattributed, state.unattributedLast, sample);
        const unchanged = state.unattributedLast !== null
            && applied.last.tier === state.unattributedLast.tier
            && bucketsEqual(applied.last.buckets, state.unattributedLast.buckets);
        if (unchanged && bucketsEqual(applied.buckets[applied.last.tier], state.unattributed[applied.last.tier]))
            return state;
        return { ...state, unattributed: applied.buckets, unattributedLast: applied.last };
    }
    const key = routeKeyOf(route.provider, route.model);
    const existing = state.providers[key];
    const applied = applySample(existing?.buckets ?? zeroTierBuckets(), existing?.last ?? null, sample);
    const replaced = existing?.last !== null && existing !== undefined
        && existing.last !== null
        && existing.last.turn === turn
        && existing.last.step === step;
    const nextEntry = {
        provider: route.provider,
        model: route.model,
        buckets: applied.buckets,
        last: applied.last,
        steps: (existing?.steps ?? 0) + (replaced ? 0 : 1),
    };
    return {
        ...state,
        providers: { ...state.providers, [key]: nextEntry },
        order: existing === undefined ? [...state.order, key] : state.order,
    };
}
/**
 * Close the same-step replacement slot for a retried attempt: a retry
 * re-runs the step, so its new usage sample must ADD to the totals instead of
 * replacing the abandoned attempt's sample. Mirrors the token-meter unit's
 * `llm/retry-started` handling; the buckets already accumulated stay put.
 */
function closeStep(state, turn, step) {
    const route = state.route;
    const key = route === undefined ? undefined : routeKeyOf(route.provider, route.model);
    const entry = key === undefined ? undefined : state.providers[key];
    const closesEntry = entry?.last !== null && entry !== undefined
        && entry.last !== null
        && entry.last.turn === turn
        && entry.last.step === step;
    const closesUnattributed = state.unattributedLast !== null
        && state.unattributedLast.turn === turn
        && state.unattributedLast.step === step;
    if (!closesEntry && !closesUnattributed)
        return state;
    return {
        ...state,
        ...closesEntry && key !== undefined && entry !== undefined ? {
            providers: { ...state.providers, [key]: { ...entry, last: null } },
        } : {},
        ...closesUnattributed ? { unattributedLast: null } : {},
    };
}
const sumBuckets = (target, source) => ({
    uncachedInputTokens: target.uncachedInputTokens + source.uncachedInputTokens,
    outputTokens: target.outputTokens + source.outputTokens,
    cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
    cacheWriteTokens: target.cacheWriteTokens + source.cacheWriteTokens,
});
/** Cost of one bucket set under one price, in the configured currency. */
function costOf(buckets, price) {
    return (buckets.uncachedInputTokens * price.inputPerM
        + buckets.cacheReadTokens * price.cacheReadPerM
        + buckets.cacheWriteTokens * price.cacheWritePerM
        + buckets.outputTokens * price.outputPerM) / 1_000_000;
}
/** Cost of one tiered bucket set: peak priced at the peak rate, off-peak at the base rate. */
function costOfTiered(buckets, price) {
    return costOf(buckets.peak, effectivePeak(price)) + costOf(buckets.offPeak, price);
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
export function createContextUsageProjectionDefinition(spec) {
    return {
        key: 'contextUsage',
        stateSchema: contextUsageStateSchema,
        init: () => ({
            route: undefined,
            providers: {},
            order: [],
            unattributed: zeroTierBuckets(),
            unattributedLast: null,
        }),
        apply: (state, event) => {
            if (event.type === 'request/context') {
                const { provider, model } = event.data;
                if (state.route?.provider === provider && state.route.model === model)
                    return state;
                return { ...state, route: { provider, model } };
            }
            if (event.type === 'request/header') {
                const { provider, model } = event.data.header.config;
                if (state.route?.provider === provider && state.route.model === model)
                    return state;
                return { ...state, route: { provider, model } };
            }
            if (event.type === 'llm/retry-started') {
                return closeStep(state, event.data.turn, event.data.step);
            }
            // 0.1.3-alpha.1: usage rides the durable Assistant settlements only —
            // assistant/message carries it in `usage` or its compact stream, and
            // assistant/attempt carries a stream with no surface message.
            if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt')
                return state;
            const usage = usageOf(event);
            if (usage === undefined)
                return state;
            const { turn, step } = event.data;
            return attribute(state, turn, step, usage, spec.isPeakHour(event.time));
        },
        wire: {
            viewSchema: contextUsageSchema,
            view: (state) => {
                let total = zeroBuckets();
                let totalCost = 0;
                const providers = [];
                for (const key of state.order) {
                    const entry = state.providers[key];
                    if (entry === undefined)
                        continue;
                    const tiered = sumBuckets(entry.buckets.peak, entry.buckets.offPeak);
                    total = sumBuckets(total, tiered);
                    const price = spec.resolve(entry.provider, entry.model);
                    const cost = costOfTiered(entry.buckets, price);
                    totalCost += cost;
                    const priceUrl = spec.priceUrl?.(entry.provider);
                    providers.push({
                        provider: entry.provider,
                        model: entry.model,
                        ...tiered,
                        steps: entry.steps,
                        cost,
                        ...(priceUrl === undefined ? {} : { priceUrl }),
                    });
                }
                const unattributedTiered = sumBuckets(state.unattributed.peak, state.unattributed.offPeak);
                const unattributedCost = costOfTiered(state.unattributed, spec.resolve('', ''));
                return {
                    currency: spec.currency,
                    total: sumBuckets(total, unattributedTiered),
                    providers,
                    unattributed: unattributedTiered,
                    totalCost: totalCost + unattributedCost,
                    unattributedCost,
                    ...(spec.peakHours === undefined || spec.peakHours.length === 0 ? {} : {
                        peakHours: spec.peakHours,
                        timeZone: spec.timeZone,
                    }),
                };
            },
        },
        // Fold semantics changed with 0.1.3-alpha.1 (settlement-stream usage),
        // so any persisted projection cache must rebuild.
        stateVersion: 3,
    };
}
