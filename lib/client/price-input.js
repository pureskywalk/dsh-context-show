/**
 * Decimal parsing for the settings card price cells.
 *
 * The cells keep the raw text while the user types: a controlled
 * <input type="number"> re-normalises "0." to 0, which swallows the decimal
 * point before the next digit arrives. The raw string is parsed here instead,
 * and the stored number is only what a finished edit means.
 *
 * @module dsh-context-show/client/price-input
 */
/**
 * Parse one raw price edit.
 * @param raw - the exact input text.
 * @returns the number it denotes (empty counts as 0), or undefined when the
 *   text is not a non-negative decimal and the previous value must stand.
 */
export function parsePriceInput(raw) {
    const trimmed = raw.trim();
    if (trimmed === '')
        return 0;
    // Digits with at most one decimal point: "0", "0.", "0.05", ".5".
    if (!/^[0-9]*[.]?[0-9]*$/.test(trimmed))
        return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
}
/**
 * Display text of one stored price.
 * @param current - the stored number.
 * @returns its text form, or an empty string when it is not finite.
 */
export function formatPriceInput(current) {
    return Number.isFinite(current) ? String(current) : '';
}
