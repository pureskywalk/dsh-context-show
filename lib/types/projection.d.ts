/**
 * Pure client-safe vocabulary of the context-show per-provider usage
 * projection, plus its session-projection table merge.
 *
 * @module dsh-context-show/projection
 */
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client';
/** One route's usage and spend on a single billing day. */
export interface ProviderTodayUsage {
    /** Registered provider route key (`` for the unattributed bucket). */
    provider: string;
    /** Provider-owned model id (`` for the unattributed bucket). */
    model: string;
    /** Estimated spend of the day for this route. */
    cost: number;
    /** Tokens billed on the day for this route. */
    total: TokenUsageProjection;
}
/**
 * Cumulative usage attributed to one provider/model route of a session log.
 *
 * The four buckets are disjoint: `uncachedInputTokens` is uncached input
 * only; cached input is reported separately as `cacheReadTokens` /
 * `cacheWriteTokens` (billed input = sum of the three). `outputTokens`
 * already includes reasoning output, mirroring the token-meter buckets.
 */
export interface ProviderUsageProjection {
    /** Registered provider route key (e.g. `deepseek-official`). */
    provider: string;
    /** Provider-owned model id (e.g. `deepseek-v4-flash`). */
    model: string;
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Steps whose usage sample was attributed to this route. */
    steps: number;
    /** Estimated spend for this route, in the configured currency. */
    cost: number;
    /** Official pricing page of the provider, when configured (display link). */
    priceUrl?: string;
}
/**
 * Whole-session per-provider usage as served to the client projection.
 *
 * `total` is the sum over every attributed provider row and equals the
 * token-meter `tokenUsage` totals for the same log by construction (both
 * folds apply the same last-sample-replacement semantics). `unattributed`
 * collects usage samples that landed before any `request/header` or
 * `request/context` route was known — a rare log prefix, kept separate so
 * the panel can label it honestly instead of inventing a provider.
 */
/** Peak-hour window: inclusive `start`, exclusive `end`, 24h hours. */
export interface PeakHourRange {
    start: number;
    end: number;
}
/**
 * Whole-session per-provider usage as served to the client projection.
 *
 * `total` is the sum over every attributed provider row and equals the
 * token-meter `tokenUsage` totals for the same log by construction (both
 * folds apply the same last-sample-replacement semantics). `unattributed`
 * collects usage samples that landed before any `request/header` or
 * `request/context` route was known — a rare log prefix, kept separate so
 * the panel can label it honestly instead of inventing a provider.
 *
 * When peak/off-peak billing is configured, `peakHours` and `timeZone`
 * describe the clock the per-sample tiering used; costs already reflect the
 * tier split.
 */
export interface ContextUsageProjection {
    /** ISO 4217-style currency code the prices and costs are denominated in. */
    currency: string;
    /** Sum over every attributed provider row. */
    total: TokenUsageProjection;
    /** One row per distinct provider/model route in first-use order. */
    providers: readonly ProviderUsageProjection[];
    /** Usage samples that landed before any route was known (rare). */
    unattributed: TokenUsageProjection;
    /** Estimated spend over every provider row, in the configured currency. */
    totalCost: number;
    /** Estimated spend of the unattributed bucket (default price). */
    unattributedCost: number;
    /**
     * Spend of the current billing day (the pricing timezone's `YYYY-MM-DD`),
     * so the client can sum today across Sessions for workspace / global totals.
     */
    today: {
        /** Billing day key this figure was computed for. */
        date: string;
        /** Estimated spend of the day, in the configured currency. */
        cost: number;
        /** Tokens billed on the day. */
        total: TokenUsageProjection;
        /** Per-route breakdown of the day, sorted by descending cost. */
        routes: readonly ProviderTodayUsage[];
    };
    /** Peak-hour windows used for tiering; absent means flat pricing. */
    peakHours?: readonly PeakHourRange[];
    /** IANA timezone the peak hours were evaluated in. */
    timeZone?: string;
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /** Per-provider cumulative usage of the complete durable log. */
        contextUsage: ContextUsageProjection;
    }
}
