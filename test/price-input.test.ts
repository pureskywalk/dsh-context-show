/**
 * Tests for price-cell parsing: typing "0.05" must survive the intermediate
 * "0." state that a number input would normalise away.
 */

import { describe, expect, it } from 'vitest'
import { formatPriceInput, parsePriceInput } from '../src/client/price-input.ts'

describe('parsePriceInput', () => {
  it('accepts digits with a trailing or leading decimal point', () => {
    expect(parsePriceInput('0')).toBe(0)
    expect(parsePriceInput('0.')).toBe(0)
    expect(parsePriceInput('0.0')).toBe(0)
    expect(parsePriceInput('0.05')).toBe(0.05)
    expect(parsePriceInput('.5')).toBe(0.5)
    expect(parsePriceInput('1.5')).toBe(1.5)
    expect(parsePriceInput(' 2.25 ')).toBe(2.25)
  })

  it('treats an empty cell as zero', () => {
    expect(parsePriceInput('')).toBe(0)
    expect(parsePriceInput('   ')).toBe(0)
  })

  it('rejects text that is not a non-negative decimal', () => {
    expect(parsePriceInput('abc')).toBeUndefined()
    expect(parsePriceInput('-1')).toBeUndefined()
    expect(parsePriceInput('1.2.3')).toBeUndefined()
    expect(parsePriceInput('1e3')).toBeUndefined()
  })

  it('formats stored numbers for display', () => {
    expect(formatPriceInput(0.05)).toBe('0.05')
    expect(formatPriceInput(1)).toBe('1')
    expect(formatPriceInput(Number.NaN)).toBe('')
  })
})
