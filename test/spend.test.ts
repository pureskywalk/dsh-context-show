/**
 * Tests for the cross-Session "today" spend fold served over the bridge.
 */

import { describe, expect, it } from 'vitest'
import { summarizeSpend, type SpendSample } from '../src/spend.ts'

const zero = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const sample = (
  cwd: string | undefined,
  date: string,
  cost: number,
  routes: Array<{ provider: string; model: string; cost: number }>,
  cumulative = cost,
): SpendSample => ({
  cwd,
  today: { date, cost, total: zero, routes: routes.map(route => ({ ...route, total: zero })) },
  cumulative,
})

describe('summarizeSpend', () => {
  it('ignores samples from another billing day but keeps their cumulative spend', () => {
    const snapshot = summarizeSpend({
      todayKey: '2026-09-14',
      currency: 'CNY',
      samples: [
        sample('/w/a', '2026-09-13', 9, [{ provider: 'p', model: 'old', cost: 9 }]),
        sample('/w/a', '2026-09-14', 4, [{ provider: 'p', model: 'new', cost: 4 }]),
      ],
    })
    expect(snapshot.date).toBe('2026-09-14')
    expect(snapshot.total.cost).toBe(4)
    expect(snapshot.total.routes).toEqual([{ provider: 'p', model: 'new', cost: 4 }])
    expect(snapshot.cumulativeTotal).toBe(13)
    expect(snapshot.workspaces).toHaveLength(1)
    expect(snapshot.workspaces[0]?.cumulative).toBe(13)
  })

  it('groups by working directory and sums the global total', () => {
    const snapshot = summarizeSpend({
      todayKey: '2026-09-14',
      currency: 'CNY',
      samples: [
        sample('/w/a', '2026-09-14', 1, [{ provider: 'p', model: 'm1', cost: 1 }]),
        sample('/w/a', '2026-09-14', 2, [{ provider: 'p', model: 'm1', cost: 2 }]),
        sample('/w/b', '2026-09-14', 5, [{ provider: 'p', model: 'm2', cost: 5 }]),
        sample(undefined, '2026-09-14', 0.5, [{ provider: '', model: '', cost: 0.5 }]),
      ],
    })
    expect(snapshot.total.cost).toBe(8.5)
    expect(snapshot.cumulativeTotal).toBe(8.5)
    // Same route across Sessions merges into one cost-sorted row.
    expect(snapshot.total.routes).toEqual([
      { provider: 'p', model: 'm2', cost: 5 },
      { provider: 'p', model: 'm1', cost: 3 },
      { provider: '', model: '', cost: 0.5 },
    ])
    expect(snapshot.workspaces.map(scope => ({ cwd: scope.cwd, cost: scope.cost, cumulative: scope.cumulative }))).toEqual([
      { cwd: '/w/b', cost: 5, cumulative: 5 },
      { cwd: '/w/a', cost: 3, cumulative: 3 },
      { cwd: undefined, cost: 0.5, cumulative: 0.5 },
    ])
    expect(snapshot.workspaces[1]?.routes).toEqual([{ provider: 'p', model: 'm1', cost: 3 }])
  })

  it('returns an empty snapshot when nothing billed today', () => {
    const snapshot = summarizeSpend({
      todayKey: '2026-09-14',
      currency: 'CNY',
      samples: [sample("/w/a", "2026-09-12", 3, [{ provider: "p", model: "m", cost: 3 }])],
    })
    expect(snapshot.total).toEqual({ cost: 0, routes: [] })
    expect(snapshot.workspaces).toEqual([{ cwd: "/w/a", cost: 0, cumulative: 3, routes: [] }])
  })
})
