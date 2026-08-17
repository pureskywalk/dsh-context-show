/**
 * dsh-context-show host half: registers the `contextUsage` session
 * projection (per-provider usage attribution over the durable log) priced by
 * a currency-aware, settings-editable table with optional peak / off-peak
 * tiering.
 *
 * The prices are editable from the web Settings page (the `context-show`
 * settings namespace): every committed change re-registers the projection
 * unit with the new pricing spec, so the panel's cost figures re-derive from
 * the accumulated tier buckets without a restart or log replay.
 *
 * The registry is an optional service — headless assemblies without it keep
 * this fiber inert, and the web client panel degrades to the token-meter
 * projections whenever this half is absent.
 *
 * @module dsh-context-show
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type PeakHourRange, type TokenPrice } from './usage-fold.ts';
export { createContextUsageProjectionDefinition, createPricingSpec, createPriceResolver, DEFAULT_PRICE, DEFAULT_PEAK_HOURS, DEFAULT_TIME_ZONE, effectivePeak, isPeakHour, } from './usage-fold.ts';
export type { PeakHourRange, PriceResolver, PricingSpec, ProviderPriceMap, TokenPrice } from './usage-fold.ts';
export type { ContextUsageProjection, ProviderUsageProjection } from './projection.ts';
/**
 * Settings namespace of the context-show capability — the section the web
 * Settings page edits. Spelled here rather than imported by the browser half
 * so the client can bind the same value without depending on a Host package.
 */
export declare const CONTEXT_SHOW_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Required host service: the projection registry the contextUsage unit folds into. */
export declare const inject: string[];
/** Prices per 1M tokens of one route; base = off-peak, optional `peak` overrides. */
export interface PriceEntry extends TokenPrice {
}
/**
 * Plugin configuration: the price table used to price the accumulated usage
 * buckets (denominated in `currency`) plus the official pricing page links
 * shown in the panel. Resolution order per route:
 * `modelPrices[provider/model]`, then `prices[provider]`, then
 * `defaultPrice`. Peak / off-peak tiering is driven by `peakHours`
 * (evaluated in `timeZone`, default Beijing time) — samples inside a peak
 * window are priced at each entry's `peak` rate, everything else at the
 * base rate. Defaults are DeepSeek's peak / off-peak rates (effective
 * 2026-08-17): base = off-peak, `peak` = peak-hour rate, and `peakHours`
 * defaults to the announced Beijing windows (9:00-12:00, 14:00-18:00).
 */
export interface Config {
    /** ISO 4217-style currency code of the prices (default CNY — DeepSeek bills in RMB). */
    currency?: string;
    /** Provider-keyed prices (e.g. `deepseek-official`). */
    prices?: Record<string, PriceEntry>;
    /** `provider/model`-keyed model-level price overrides. */
    modelPrices?: Record<string, PriceEntry>;
    /** Fallback price for providers without an entry (defaults to DeepSeek v4-flash tier). */
    defaultPrice?: PriceEntry;
    /** Provider → official pricing page URL, shown as a link in the panel. */
    priceUrls?: Record<string, string>;
    /** Pricing page URL for providers without an entry. */
    defaultPriceUrl?: string;
    /** Peak-hour windows ([start, end), 24h); empty disables tiered pricing. */
    peakHours?: PeakHourRange[];
    /** IANA timezone the peak hours are evaluated in (DeepSeek: Asia/Shanghai). */
    timeZone?: string;
}
/** Runtime schema for {@link Config}; cast for the loose z<Config> face. */
export declare const Config: z<Config>;
/**
 * Mount the per-provider usage projection unit, priced by the settings-editable
 * config table and peak / off-peak clock.
 * @param ctx - host plugin context.
 * @param config - composition entry config (the settings section's base layer).
 */
export declare function apply(ctx: Context, config?: Config): void;
