/**
 * Tests for the durable spend ledger: restart-safe storage of each Session's
 * last observed day.
 */

import { describe, expect, it } from 'vitest'
import { emptyLedger, ledgerSamples, observeSession, parseLedgerDoc } from '../src/spend-ledger.ts'
import { summarizeSpend } from '../src/spend.ts'
import type { SpendSample } from '../src/spend-protocol.ts'

const zero = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const sample = (cwd: string | undefined, date: string, cost: number, model: string, cumulative = cost): SpendSample => ({
  cwd,
  today: { date, cost, total: zero, routes: [{ provider: 'p', model, cost, total: zero }] },
  cumulative,
})

describe('parseLedgerDoc', () => {
  it('degrades to an empty ledger for unknown or damaged documents', () => {
    expect(parseLedgerDoc(null)).toEqual(emptyLedger())
    expect(parseLedgerDoc({ version: 2, entries: {} })).toEqual(emptyLedger())
    expect(parseLedgerDoc({ version: 1, entries: 'nope' })).toEqual(emptyLedger())
  })

  it('keeps well-formed rows and drops malformed ones', () => {
    const doc = parseLedgerDoc({
      version: 1,
      entries: {
        a: { date: '2026-09-14', cwd: '/w/a', cost: 1.5, cumulative: 9, routes: [{ provider: 'p', model: 'm', cost: 1.5 }] },
        b: { cost: 2 },
        c: { date: '2026-09-14', cost: 'x', routes: [{ provider: 'p' }] },
      },
    })
    expect(Object.keys(doc.entries)).toEqual(['a', 'c'])
    expect(doc.entries.a).toEqual({ date: '2026-09-14', cwd: '/w/a', cost: 1.5, routes: [{ provider: 'p', model: 'm', cost: 1.5 }], cumulative: 9 })
    expect(doc.entries.c).toEqual({ date: '2026-09-14', cost: 0, routes: [], cumulative: 0 })
  })
})

describe('observeSession', () => {
  it('records a Session and refreshes it on the newest observation', () => {
    let doc = observeSession(emptyLedger(), 's1', sample('/w/a', '2026-09-14', 1, 'm1'), '2026-09-14')
    doc = observeSession(doc, 's1', sample('/w/a', '2026-09-14', 2.5, 'm1', 10), '2026-09-14')
    doc = observeSession(doc, 's2', sample('/w/b', '2026-09-14', 3, 'm2'), '2026-09-14')
    expect(Object.keys(doc.entries).sort()).toEqual(['s1', 's2'])
    expect(doc.entries.s1?.cost).toBe(2.5)
    expect(doc.entries.s1?.cumulative).toBe(10)
  })

  it('replaces the stored row instead of accumulating it', () => {
    let doc = observeSession(emptyLedger(), 's1', sample('/w/a', '2026-09-14', 4, 'm1'), '2026-09-14')
    doc = observeSession(doc, 's1', sample('/w/a', '2026-09-14', 1, 'm1'), '2026-09-14')
    expect(doc.entries.s1?.cost).toBe(1)
  })

  it('keeps the known day when a Session reports only its cumulative spend', () => {
    let doc = observeSession(emptyLedger(), 's1', sample('/w/a', '2026-09-14', 4, 'm1'), '2026-09-14')
    doc = observeSession(doc, 's1', { cwd: '/w/a', today: undefined, cumulative: 12 }, '2026-09-15')
    expect(doc.entries.s1?.date).toBe('2026-09-14')
    expect(doc.entries.s1?.cost).toBe(4)
    expect(doc.entries.s1?.cumulative).toBe(12)
  })

  it('ignores a Session with nothing to report', () => {
    const doc = emptyLedger()
    expect(observeSession(doc, 's1', { cwd: undefined, today: undefined, cumulative: undefined }, '2026-09-14')).toBe(doc)
  })
})

describe('ledger round trip through the spend fold', () => {
  it('survives a JSON restart and keeps every workspace', () => {
    let doc = observeSession(emptyLedger(), 's1', sample('/w/a', '2026-09-14', 1.5, 'flash', 20), '2026-09-14')
    doc = observeSession(doc, 's2', sample('/w/a', '2026-09-14', 2.5, 'flash', 30), '2026-09-14')
    doc = observeSession(doc, 's3', sample('/w/b', '2026-09-14', 5, 'pro', 50), '2026-09-14')
    // A restart re-reads exactly the serialized document.
    const restored = parseLedgerDoc(JSON.parse(JSON.stringify(doc)))
    const snapshot = summarizeSpend({ todayKey: '2026-09-14', currency: 'CNY', samples: ledgerSamples(restored) })
    expect(snapshot.total.cost).toBe(9)
    expect(snapshot.cumulativeTotal).toBe(100)
    expect(snapshot.workspaces.map(scope => ({ cwd: scope.cwd, cost: scope.cost, cumulative: scope.cumulative }))).toEqual([
      { cwd: '/w/b', cost: 5, cumulative: 50 },
      { cwd: '/w/a', cost: 4, cumulative: 50 },
    ])
    expect(snapshot.total.routes).toEqual([
      { provider: 'p', model: 'pro', cost: 5 },
      { provider: 'p', model: 'flash', cost: 4 },
    ])
  })

  it('drops a day that is no longer today from the today figures', () => {
    const doc = observeSession(emptyLedger(), 's1', sample('/w/a', '2026-09-13', 7, 'flash', 40), '2026-09-13')
    const snapshot = summarizeSpend({ todayKey: '2026-09-14', currency: 'CNY', samples: ledgerSamples(doc) })
    expect(snapshot.total.cost).toBe(0)
    // The cumulative figure still stands for the headline.
    expect(snapshot.cumulativeTotal).toBe(40)
  })
})
