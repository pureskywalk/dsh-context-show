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
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client';
/** Base price fields of one route, per 1M tokens in the configured currency. */
export interface TokenPriceBase {
    /** Per 1M uncached (cache-miss) input tokens. */
    inputPerM: number;
    /** Per 1M cached-read (cache-hit) input tokens. */
    cacheReadPerM: number;
    /** Per 1M cache-write tokens. */
    cacheWritePerM: number;
    /** Per 1M output tokens. */
    outputPerM: number;
}
/**
 * Prices per 1M tokens of one route, in the configured currency. The base
 * fields are the OFF-PEAK rate; the optional `peak` object overrides
 * individual fields for peak-hour samples (absent fields fall back to the
 * base, and an absent `peak` means flat pricing).
 */
export interface TokenPrice extends TokenPriceBase {
    /** Peak-hour rate overrides; missing fields fall back to the base rate. */
    peak?: Partial<TokenPriceBase>;
}
/** Model-keyed price override map of one provider (model id → price). */
export type ProviderPriceMap = Record<string, TokenPrice>;
/** Peak-hour window: inclusive `start`, exclusive `end`, 24h local hours. */
export interface PeakHourRange {
    start: number;
    end: number;
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
    resolve(provider: string, model: string): TokenPrice;
}
/** Everything the fold's view needs to price the accumulated buckets. */
export interface PricingSpec {
    /** ISO 4217-style currency code, served to the client for formatting. */
    currency: string;
    /** Route → price lookup (base = off-peak rate). */
    resolve(provider: string, model: string): TokenPrice;
    /** Provider → official pricing page URL, when configured. */
    priceUrl?(provider: string): string | undefined;
    /** Peak-hour windows; empty means flat pricing. */
    peakHours?: readonly PeakHourRange[];
    /** IANA timezone the peak windows are evaluated in. */
    timeZone?: string;
    /** Whether the given event time falls in a peak window. */
    isPeakHour(timeMs: number): boolean;
}
/**
 * Default DeepSeek official pricing (deepseek-v4-flash tier, CNY — the
 * peak / off-peak scheme effective 2026-08-17; off-peak = half of peak).
 * Base fields are the OFF-PEAK rate; `peak` overrides the peak-hour rate.
 */
export declare const DEFAULT_PRICE: TokenPrice;
/** DeepSeek official route defaults for the shipped composition. */
export declare const DEFAULT_PROVIDER_PRICES: Record<string, TokenPrice>;
/** DeepSeek peak hours (Beijing time): 9:00-12:00 and 14:00-18:00. */
export declare const DEFAULT_PEAK_HOURS: readonly PeakHourRange[];
/** Default timezone DeepSeek bills its peak hours in. */
export declare const DEFAULT_TIME_ZONE = "Asia/Shanghai";
/**
 * Build a price resolver from the plugin configuration.
 * @param prices - provider-keyed price entries.
 * @param modelPrices - `provider/model`-keyed model-level overrides.
 * @param fallback - price for unknown providers/models.
 * @returns the resolver.
 */
export declare function createPriceResolver(prices?: Record<string, TokenPrice>, modelPrices?: Record<string, TokenPrice>, fallback?: TokenPrice): PriceResolver;
/** Peak rate of one price: base fields overridden by the defined peak fields. */
export declare function effectivePeak(price: TokenPrice): TokenPrice;
/**
 * Whether an instant falls in any peak window (supports ranges that wrap
 * midnight via start > end).
 * @param timeMs - epoch milliseconds.
 * @param ranges - peak windows; empty means never peak.
 * @param timeZone - IANA timezone the windows are evaluated in.
 * @returns whether the instant is a peak hour.
 */
export declare function isPeakHour(timeMs: number, ranges: readonly PeakHourRange[], timeZone?: string): boolean;
/**
 * Build a `PricingSpec` from the plugin configuration: price resolution,
 * currency, official price links, and the peak/off-peak clock.
 * @param config - resolved plugin config.
 * @returns the pricing spec captured by the projection unit.
 */
export declare function createPricingSpec(config: {
    currency?: string;
    prices?: Record<string, TokenPrice>;
    modelPrices?: Record<string, TokenPrice>;
    defaultPrice?: TokenPrice;
    priceUrls?: Record<string, string>;
    defaultPriceUrl?: string;
    peakHours?: readonly PeakHourRange[];
    timeZone?: string;
}): PricingSpec;
/** One provider row's tiered bucket sets. */
interface TierBuckets {
    peak: TokenUsageProjection;
    offPeak: TokenUsageProjection;
}
/** One usage sample keyed by its step, mirroring the token-meter unit. */
interface UsageSample {
    turn: number;
    step: number;
    buckets: TokenUsageProjection;
    tier: 'peak' | 'offPeak';
}
/** One provider/model row of the fold state. */
interface ProviderState {
    provider: string;
    model: string;
    buckets: TierBuckets;
    last: UsageSample | null;
    steps: number;
}
/** Plain-JSON fold state of the `contextUsage` unit. */
export interface ContextUsageState {
    /** Route in force for the next usage sample; undefined before any route record. */
    route: {
        provider: string;
        model: string;
    } | undefined;
    /** Provider rows keyed by `provider\0model`. */
    providers: Record<string, ProviderState>;
    /** First-use order of the provider table keys. */
    order: string[];
    /** Usage samples that landed before any route was known. */
    unattributed: TierBuckets;
    /** Last unattributed sample, for same-step replacement. */
    unattributedLast: UsageSample | null;
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
export declare function createContextUsageProjectionDefinition(spec: PricingSpec): ProjectionDefinition<'contextUsage', ContextUsageState>;
export {};
