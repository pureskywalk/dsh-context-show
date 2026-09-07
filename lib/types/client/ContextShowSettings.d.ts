/**
 * The context-show settings page: edit the pricing table (currency, flat or
 * peak / off-peak rates per provider/model, peak-hour windows) through the
 * `context-show` settings namespace. Committed changes re-register the host
 * projection with the new pricing spec, so the panel's cost figures update
 * live.
 *
 * @module dsh-context-show/ContextShowSettings
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client';
/** Client-side structural view of one route's price entry (wire JSON). */
export interface PriceView {
    inputPerM: number;
    cacheReadPerM: number;
    cacheWritePerM: number;
    outputPerM: number;
    /** Peak-hour overrides; absent fields fall back to the base rate. */
    peak?: Partial<PriceView>;
}
/** Client-side structural view of one peak-hour window. */
export interface PeakRangeView {
    start: number;
    end: number;
}
/** Client-side structural view of the `context-show` settings section. */
export interface ConfigView {
    currency: string;
    prices: Record<string, PriceView>;
    modelPrices: Record<string, PriceView>;
    defaultPrice: PriceView;
    peakHours: PeakRangeView[];
    timeZone: string;
}
/** Business face injected into the plugin-configuration card. */
export interface ContextShowSettingsInjected {
    /** Bound scope of the `context-show` settings namespace. */
    scope: SettingsScope<ConfigView>;
    /** Persist the edited section (one field write per top-level key). */
    save(section: ConfigView): Promise<void>;
    /** Clear the user layer so every field re-inherits the bundle defaults. */
    reset(): Promise<void>;
}
/** Props supplied by the plugin card seat plus the locale and inject faces. */
export interface ContextShowSettingsProps extends PropsRuntime<'settings.plugin.item'>, PropsLocale<'context-show'>, ContextShowSettingsInjected {
}
/**
 * The settings page: pricing table editor.
 * @param props - settings seat, locale, and the injected scope face.
 * @returns the section content.
 */
export declare const ContextShowSettings: import("react").NamedExoticComponent<ContextShowSettingsProps>;
