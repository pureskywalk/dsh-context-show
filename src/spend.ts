/**
 * Cross-Session "today" spend aggregation for the panel. The host folds the
 * live Sessions' current `contextUsage` today cells on demand, so the figure
 * never depends on the browser's Session list or its projection cache.
 *
 * @module dsh-context-show/spend
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { ContextUsageProjection } from './projection.ts'
import type { SpendRouteRow, SpendSample, SpendSnapshot, SpendWorkspace } from './spend-protocol.ts'
import { dayKeyOf, type PricingSpec } from './usage-fold.ts'

/** Re-exported for consumers and tests that fold samples directly. */
export type { SpendSample }

/** Accumulate one route into a route table (same route sums its cost). */
function accumulate(into: Map<string, SpendRouteRow>, route: { provider: string; model: string; cost: number }): void {
  const key = route.provider + '\u0000' + route.model
  const existing = into.get(key)
  if (existing === undefined) into.set(key, { provider: route.provider, model: route.model, cost: route.cost })
  else existing.cost += route.cost
}

/** Cost-sorted route rows of a route table. */
function sortedRows(rows: Map<string, SpendRouteRow>): SpendRouteRow[] {
  return [...rows.values()].sort((left, right) => right.cost - left.cost || left.model.localeCompare(right.model))
}

/**
 * Fold per-Session samples into the panel snapshot. Samples whose billing day
 * is not the requested day contribute nothing, so a snapshot taken after
 * midnight never counts the previous day.
 * @param input - billing day, currency, and the per-Session samples.
 * @returns the global total plus the per-workspace scopes.
 */
export function summarizeSpend(input: {
  todayKey: string
  currency: string
  samples: readonly SpendSample[]
}): SpendSnapshot {
  const totalRoutes = new Map<string, SpendRouteRow>()
  const scopes = new Map<string, { cost: number; cumulative: number; routes: Map<string, SpendRouteRow> }>()
  let totalCost = 0
  let cumulativeTotal = 0
  for (const sample of input.samples) {
    const key = sample.cwd ?? ''
    const scope = scopes.get(key) ?? { cost: 0, cumulative: 0, routes: new Map<string, SpendRouteRow>() }
    if (sample.cumulative !== undefined) {
      cumulativeTotal += sample.cumulative
      scope.cumulative += sample.cumulative
    }
    const today = sample.today
    if (today !== undefined && today.date === input.todayKey) {
      totalCost += today.cost
      scope.cost += today.cost
      for (const route of today.routes) {
        accumulate(totalRoutes, route)
        accumulate(scope.routes, route)
      }
    }
    scopes.set(key, scope)
  }
  const workspaces: SpendWorkspace[] = [...scopes.entries()]
    .map(([cwd, scope]) => ({ cwd: cwd === '' ? undefined : cwd, cost: scope.cost, cumulative: scope.cumulative, routes: sortedRows(scope.routes) }))
    .sort((left, right) => right.cost - left.cost || (left.cwd ?? '').localeCompare(right.cwd ?? ''))
  return {
    date: input.todayKey,
    currency: input.currency,
    total: { cost: totalCost, routes: sortedRows(totalRoutes) },
    cumulativeTotal,
    workspaces,
  }
}

/** Host seams the collector reads (satisfied by the plugin host context). */
export interface SpendSources {
  /** Every Session currently attached to this host process. */
  listSessions(): readonly Session[]
  /** Read one Session current client-visible contextUsage value. */
  readContextUsage(session: Session): ContextUsageProjection | undefined
  /** The pricing spec in force (currency and clock). */
  spec(): PricingSpec
  /** Durable ledger of every Session ever observed, surviving restarts. */
  ledger: {
    samples(): readonly SpendSample[]
    observe(sessionId: string, sample: SpendSample, date: string): void
  }
}

/**
 * Build the on-demand snapshot reader the bridge serves.
 * @param sources - live Sessions, the projection reader, and the pricing spec.
 * @returns a function producing a fresh today snapshot per call.
 */
export function createSpendCollector(sources: SpendSources): () => SpendSnapshot {
  return () => {
    const spec = sources.spec()
    const todayKey = dayKeyOf(spec.now?.() ?? Date.now(), spec.timeZone)
    // Fold the live Sessions into the ledger first, then snapshot the ledger:
    // Sessions this process never loaded still contribute their last day.
    for (const session of sources.listSessions()) {
      const value = sources.readContextUsage(session)
      sources.ledger.observe(String(session.header.id), {
        cwd: session.header.cwd,
        today: value?.today,
        cumulative: value?.totalCost,
      }, todayKey)
    }
    return summarizeSpend({ todayKey, currency: spec.currency, samples: sources.ledger.samples() })
  }
}
