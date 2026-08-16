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
export declare function formatTokens(n: number): string;
/** Billed prompt-side input: the three disjoint input buckets summed. */
export declare function billedInputTokens(usage: {
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}): number;
/** Whole-request cost of one usage bucket set: billed input plus output. */
export declare function totalTokensOf(usage: {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}): number;
/**
 * Cache-hit share of billed prompt-side input.
 * @param usage - token-usage buckets.
 * @returns rounded integer percent, or null when no input was billed.
 */
export declare function cacheHitPercent(usage: {
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}): number | null;
/**
 * Compact money amount: ¥0.0042, ¥0.42, ¥12.3, ¥1,234 (no trailing zeros).
 * @param value - cost in the configured currency.
 * @param currency - ISO 4217-style currency code.
 * @returns display string.
 */
export declare function formatMoney(value: number, currency: string): string;
