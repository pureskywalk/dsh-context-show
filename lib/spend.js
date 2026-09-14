/**
 * Cross-Session "today" spend aggregation for the panel. The host folds the
 * live Sessions' current `contextUsage` today cells on demand, so the figure
 * never depends on the browser's Session list or its projection cache.
 *
 * @module dsh-context-show/spend
 */
import { dayKeyOf } from "./usage-fold.js";
/** Accumulate one route into a route table (same route sums its cost). */
function accumulate(into, route) {
    const key = route.provider + '\u0000' + route.model;
    const existing = into.get(key);
    if (existing === undefined)
        into.set(key, { provider: route.provider, model: route.model, cost: route.cost });
    else
        existing.cost += route.cost;
}
/** Cost-sorted route rows of a route table. */
function sortedRows(rows) {
    return [...rows.values()].sort((left, right) => right.cost - left.cost || left.model.localeCompare(right.model));
}
/**
 * Fold per-Session samples into the panel snapshot. Samples whose billing day
 * is not the requested day contribute nothing, so a snapshot taken after
 * midnight never counts the previous day.
 * @param input - billing day, currency, and the per-Session samples.
 * @returns the global total plus the per-workspace scopes.
 */
export function summarizeSpend(input) {
    const totalRoutes = new Map();
    const scopes = new Map();
    let totalCost = 0;
    let cumulativeTotal = 0;
    for (const sample of input.samples) {
        const key = sample.cwd ?? '';
        const scope = scopes.get(key) ?? { cost: 0, cumulative: 0, routes: new Map() };
        if (sample.cumulative !== undefined) {
            cumulativeTotal += sample.cumulative;
            scope.cumulative += sample.cumulative;
        }
        const today = sample.today;
        if (today !== undefined && today.date === input.todayKey) {
            totalCost += today.cost;
            scope.cost += today.cost;
            for (const route of today.routes) {
                accumulate(totalRoutes, route);
                accumulate(scope.routes, route);
            }
        }
        scopes.set(key, scope);
    }
    const workspaces = [...scopes.entries()]
        .map(([cwd, scope]) => ({ cwd: cwd === '' ? undefined : cwd, cost: scope.cost, cumulative: scope.cumulative, routes: sortedRows(scope.routes) }))
        .sort((left, right) => right.cost - left.cost || (left.cwd ?? '').localeCompare(right.cwd ?? ''));
    return {
        date: input.todayKey,
        currency: input.currency,
        total: { cost: totalCost, routes: sortedRows(totalRoutes) },
        cumulativeTotal,
        workspaces,
    };
}
/**
 * Build the on-demand snapshot reader the bridge serves.
 * @param sources - live Sessions, the projection reader, and the pricing spec.
 * @returns a function producing a fresh today snapshot per call.
 */
export function createSpendCollector(sources) {
    return () => {
        const spec = sources.spec();
        const todayKey = dayKeyOf(spec.now?.() ?? Date.now(), spec.timeZone);
        // Fold the live Sessions into the ledger first, then snapshot the ledger:
        // Sessions this process never loaded still contribute their last day.
        for (const session of sources.listSessions()) {
            const value = sources.readContextUsage(session);
            sources.ledger.observe(String(session.header.id), {
                cwd: session.header.cwd,
                today: value?.today,
                cumulative: value?.totalCost,
            }, todayKey);
        }
        return summarizeSpend({ todayKey, currency: spec.currency, samples: sources.ledger.samples() });
    };
}
