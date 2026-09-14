/**
 * Cross-Session "today" spend aggregation for the panel. The host folds the
 * live Sessions' current `contextUsage` today cells on demand, so the figure
 * never depends on the browser's Session list or its projection cache.
 *
 * @module dsh-context-show/spend
 */
import type { Session } from '@deepseek-ai/dsh-session';
import type { ContextUsageProjection } from './projection.ts';
import type { SpendSample, SpendSnapshot } from './spend-protocol.ts';
import { type PricingSpec } from './usage-fold.ts';
/** Re-exported for consumers and tests that fold samples directly. */
export type { SpendSample };
/**
 * Fold per-Session samples into the panel snapshot. Samples whose billing day
 * is not the requested day contribute nothing, so a snapshot taken after
 * midnight never counts the previous day.
 * @param input - billing day, currency, and the per-Session samples.
 * @returns the global total plus the per-workspace scopes.
 */
export declare function summarizeSpend(input: {
    todayKey: string;
    currency: string;
    samples: readonly SpendSample[];
}): SpendSnapshot;
/** Host seams the collector reads (satisfied by the plugin host context). */
export interface SpendSources {
    /** Every Session currently attached to this host process. */
    listSessions(): readonly Session[];
    /** Read one Session current client-visible contextUsage value. */
    readContextUsage(session: Session): ContextUsageProjection | undefined;
    /** The pricing spec in force (currency and clock). */
    spec(): PricingSpec;
    /** Durable ledger of every Session ever observed, surviving restarts. */
    ledger: {
        samples(): readonly SpendSample[];
        observe(sessionId: string, sample: SpendSample, date: string): void;
    };
}
/**
 * Build the on-demand snapshot reader the bridge serves.
 * @param sources - live Sessions, the projection reader, and the pricing spec.
 * @returns a function producing a fresh today snapshot per call.
 */
export declare function createSpendCollector(sources: SpendSources): () => SpendSnapshot;
