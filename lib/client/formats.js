/**
 * Display formatting helpers for the context-show panel.
 *
 * @module dsh-context-show/formats
 */
/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three
 * digits), mirroring the shipped conversation stats line.
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n) {
    const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
    if (n < 1_000)
        return String(n);
    if (n < 1_000_000)
        return scaled(n / 1_000) + 'K';
    return scaled(n / 1_000_000) + 'M';
}
/** Billed prompt-side input: the three disjoint input buckets summed. */
export function billedInputTokens(usage) {
    return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}
/** Whole-request cost of one usage bucket set: billed input plus output. */
export function totalTokensOf(usage) {
    return billedInputTokens(usage) + usage.outputTokens;
}
/**
 * Cache-hit share of billed prompt-side input.
 * @param usage - token-usage buckets.
 * @returns rounded integer percent, or null when no input was billed.
 */
export function cacheHitPercent(usage) {
    const billed = billedInputTokens(usage);
    return billed === 0 ? null : Math.round((usage.cacheReadTokens / billed) * 100);
}
/** Drop trailing zeros of a decimal string, and a trailing decimal point. */
function trimZeros(value) {
    if (!value.includes('.'))
        return value;
    return value.replace(/0+$/, '').replace(/\.$/, '');
}
/** Currency symbol of well-known ISO 4217 codes; falls back to the code. */
function currencySymbol(currency) {
    switch (currency.toUpperCase()) {
        case 'CNY':
        case 'CNH':
            return '¥';
        case 'USD':
            return '$';
        case 'EUR':
            return '€';
        case 'GBP':
            return '£';
        case 'JPY':
            return '¥';
        default:
            return currency.toUpperCase() + ' ';
    }
}
/**
 * Compact money amount: ¥0.0042, ¥0.42, ¥12.3, ¥1,234 (no trailing zeros).
 * @param value - cost in the configured currency.
 * @param currency - ISO 4217-style currency code.
 * @returns display string.
 */
export function formatMoney(value, currency) {
    const symbol = currencySymbol(currency);
    if (!Number.isFinite(value))
        return symbol + '—';
    if (value === 0)
        return symbol + '0';
    if (value < 0.0001)
        return '<' + symbol + '0.0001';
    if (value < 0.01)
        return symbol + trimZeros(value.toPrecision(2));
    if (value < 100)
        return symbol + trimZeros(value.toFixed(2));
    return symbol + Math.round(value).toLocaleString('en-US');
}
