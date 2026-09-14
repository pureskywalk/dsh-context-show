/**
 * Client-safe vocabulary of the cross-Session "today" spend snapshot served
 * over the plugin loopback bridge. Types only: the host collector and the
 * browser panel share this file so neither drags the other half in.
 *
 * @module dsh-context-show/spend-protocol
 */
import type { ContextUsageProjection } from './projection.ts';
/** One Session contribution to a spend fold. */
export interface SpendSample {
    /** Working directory of the Session, when recorded. */
    cwd: string | undefined;
    /** The Session current contextUsage today cell, when it has one. */
    today: ContextUsageProjection['today'] | undefined;
    /** The Session cumulative spend (the panel headline), when known. */
    cumulative: number | undefined;
}
/** One route spend inside a scope (empty provider = unattributed). */
export interface SpendRouteRow {
    /** Registered provider route key. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
    /** Estimated spend of the scope for this route. */
    cost: number;
}
/** One working-directory scope of the day. */
export interface SpendWorkspace {
    /** Absolute working directory of the Sessions in this scope; undefined when unrecorded. */
    cwd: string | undefined;
    /** Estimated spend of the scope today. */
    cost: number;
    /** Cumulative (whole-log) spend of the scope, for the headline figure. */
    cumulative: number;
    /** Per-route breakdown of today, cost-sorted (largest first). */
    routes: SpendRouteRow[];
}
/** Today spend over every live Session of the host process. */
export interface SpendSnapshot {
    /** Billing day key (YYYY-MM-DD in the pricing timezone) this snapshot covers. */
    date: string;
    /** Currency the costs are denominated in. */
    currency: string;
    /** Global total over every live Session, with its per-route breakdown. */
    total: {
        cost: number;
        routes: SpendRouteRow[];
    };
    /** Cumulative (whole-log) spend over every live Session. */
    cumulativeTotal: number;
    /** Per-working-directory scopes, cost-sorted (largest first). */
    workspaces: SpendWorkspace[];
}
/** Bridge /spend result envelope (mirrors the settings bridge shape). */
export type BridgeSpendResult = {
    ok: true;
    value: SpendSnapshot;
} | {
    ok: false;
    code: string;
    message: string;
};
