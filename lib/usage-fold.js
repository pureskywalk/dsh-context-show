/**
 * Pure per-provider usage fold for the `contextUsage` session projection.
 *
 * The fold attributes every provider-reported usage sample
 * (`assistant/chunk` usage chunks and `assistant/message` usage) to the
 * provider/model route in force at that step — the latest `request/context`
 * or `request/header` route record. Per (turn, step), a repeated sample
 * replaces the step's earlier value instead of double counting it, exactly
 * like the token-meter `tokenUsage` unit; each provider keeps its own
 * last-sample slot because the session-log invariant guarantees a step's
 * usage samples are adjacent and share one route.
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
/** Route separator inside the provider table key (never valid in a route id). */
const ROUTE_SEPARATOR = '\u0000';
/** Key of the provider table row for one route. */
const routeKeyOf = (provider, model) => provider + ROUTE_SEPARATOR + model;
/**
 * Default DeepSeek official pricing (deepseek-v4-flash tier, CNY, FLAT —
 * the current pre-2026-08-17 rate: cache hit 0.02, cache miss 1.0, output
 * 2.0 per 1M tokens). The peak/off-peak scheme announced for 2026-08-17 is
 * opt-in via `peakHours` (see `DEFAULT_PEAK_HOURS` and the settings page).
 */
export const DEFAULT_PRICE = Object.freeze({
    inputPerM: 1,
    cacheReadPerM: 0.02,
    cacheWritePerM: 1,
    outputPerM: 2,
});
/** DeepSeek official route defaults for the shipped composition. */
export const DEFAULT_PROVIDER_PRICES = Object.freeze({
    'deepseek-official': DEFAULT_PRICE,
});
/** DeepSeek peak hours (Beijing time): 9:00-12:00 and 14:00-18:00. */
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
/** The usage a chunk or finalized message reports for its step, if any. */
const usageOf = (event) => event.type === 'assistant/chunk' && event.data.chunk.type === 'usage'
    ? event.data.chunk.usage
    : event.type === 'assistant/message'
        ? event.data.usage
        : undefined;
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
        schema: contextUsageSchema,
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
            let turn;
            let step;
            let usage;
            if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
                ;
                ({ turn, step } = event.data);
                usage = event.data.chunk.usage;
            }
            else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
                ;
                ({ turn, step, usage } = event.data);
            }
            else {
                return state;
            }
            return attribute(state, turn, step, usage, spec.isPeakHour(event.time));
        },
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
        stateVersion: 2,
    };
}
