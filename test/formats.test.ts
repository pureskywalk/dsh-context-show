/**
 * Tests for the display formatters: compact tokens and currency-aware
 * money amounts.
 */

import { describe, expect, it } from 'vitest'
import { billedInputTokens, formatMoney, formatTokens, totalTokensOf } from '../src/client/formats.ts'

describe('formatTokens', () => {
  it('formats compactly', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_200)).toBe('12.2K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})

describe('formatMoney', () => {
  it('formats zero and tiny CNY amounts', () => {
    expect(formatMoney(0, 'CNY')).toBe('¥0')
    expect(formatMoney(0.00423, 'CNY')).toBe('¥0.0042')
    expect(formatMoney(0.00005, 'CNY')).toBe('<¥0.0001')
  })
  it('formats cents and dollars without trailing zeros', () => {
    expect(formatMoney(0.5, 'USD')).toBe('$0.5')
    expect(formatMoney(1.2, 'USD')).toBe('$1.2')
    expect(formatMoney(12.34, 'USD')).toBe('$12.34')
    expect(formatMoney(2, 'CNY')).toBe('¥2')
    expect(formatMoney(8, 'CNY')).toBe('¥8')
  })
  it('formats large amounts and unknown currencies', () => {
    expect(formatMoney(1234, 'USD')).toBe('$1,234')
    expect(formatMoney(12.5, 'EUR')).toBe('€12.5')
    expect(formatMoney(12.5, 'KRW')).toBe('KRW 12.5')
  })
})

describe('bucket sums', () => {
  it('sums billed input and total tokens', () => {
    const usage = { uncachedInputTokens: 100, outputTokens: 40, cacheReadTokens: 30, cacheWriteTokens: 20 }
    expect(billedInputTokens(usage)).toBe(150)
    expect(totalTokensOf(usage)).toBe(190)
  })
})
