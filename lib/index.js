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
import z from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { makeBridgeRoutes } from "./bridge.js";
import { createSpendCollector } from "./spend.js";
import { createLedger, readLedgerFile, writeLedgerFile } from "./spend-ledger.js";
import { createContextUsageProjectionDefinition, createPricingSpec, dayKeyOf, DEFAULT_PEAK_HOURS, DEFAULT_PRICE, } from "./usage-fold.js";
export { createContextUsageProjectionDefinition, createPricingSpec, createPriceResolver, DEFAULT_PRICE, DEFAULT_PEAK_HOURS, DEFAULT_TIME_ZONE, effectivePeak, isPeakHour, } from "./usage-fold.js";
/**
 * Settings namespace of the context-show capability — the section the web
 * Settings page edits. Spelled here rather than imported by the browser half
 * so the client can bind the same value without depending on a Host package.
 */
export const CONTEXT_SHOW_SETTINGS_NAMESPACE = 'context-show';
/** Required host service: the projection registry the contextUsage unit folds into. */
export const inject = ['sessionProjections'];
const priceFields = {
    inputPerM: z.number().min(0).default(0),
    cacheReadPerM: z.number().min(0).default(0),
    cacheWritePerM: z.number().min(0).default(0),
    outputPerM: z.number().min(0).default(0),
};
// Peak overrides stay optional (no defaults) so an absent field falls back
// to the base rate at cost time (see effectivePeak).
const peakFields = {
    inputPerM: z.number().min(0),
    cacheReadPerM: z.number().min(0),
    cacheWritePerM: z.number().min(0),
    outputPerM: z.number().min(0),
};
// Cast the nested schemas: schemastery infers object fields as required,
// while the domain types declare optional peak overrides and partial peak
// entries. The cast records exactly that inference widening.
const peakSchema = z.object(peakFields);
const priceSchema = z.object({
    ...priceFields,
    peak: peakSchema.default({}),
});
const peakHourSchema = z.object({
    start: z.number().min(0).max(23).step(1),
    end: z.number().min(0).max(24).step(1),
});
/** Runtime schema for {@link Config}; cast for the loose z<Config> face. */
export const Config = z.object({
    currency: z.string().default('CNY'),
    prices: z.dict(priceSchema).default({}),
    modelPrices: z.dict(priceSchema).default({}),
    defaultPrice: priceSchema.default(DEFAULT_PRICE),
    priceUrls: z.dict(z.string()).default({}),
    // Schemastery object fields are optional by default (no .optional()); an
    // absent field stays absent unless a default supplies a fallback.
    defaultPriceUrl: z.string(),
    peakHours: z.array(peakHourSchema).default([...DEFAULT_PEAK_HOURS]),
    timeZone: z.string().default('Asia/Shanghai'),
});
/**
 * Mount the per-provider usage projection unit, priced by the settings-editable
 * config table and peak / off-peak clock.
 * @param ctx - host plugin context.
 * @param config - composition entry config (the settings section's base layer).
 */
export function apply(ctx, config = {}) {
    // The authoritative pricing source: the settings scope once the web
    // Settings page serves the namespace, the composition entry otherwise
    // (installSection swaps it on attach and detach).
    let current = () => config ?? {};
    let liveSpec = createPricingSpec(config ?? {});
    let disposeProjection;
    const rebuild = () => {
        if (disposeProjection !== undefined) {
            disposeProjection();
            disposeProjection = undefined;
        }
        liveSpec = createPricingSpec(current());
        disposeProjection = ctx.sessionProjections.register(createContextUsageProjectionDefinition(liveSpec));
    };
    // The settings provider registers the namespace with the composition entry
    // as its base layer and swaps the authoritative source on attach / detach
    // (0.1.3-alpha.1: installSection lives on the provider service).
    ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.settings.installSection(ctx, CONTEXT_SHOW_SETTINGS_NAMESPACE, Config, config ?? {}, {
            setSource: (source) => { current = source; },
            onChange: rebuild,
        });
    });
    rebuild();
    // The rc.6 host-apiproxy refuses third-party settings namespaces at the RPC
    // boundary, so the pricing form is re-served through a loopback-only bridge
    // over the host settings seam. On hosts whose apiproxy already exposes the
    // namespace this stays dormant (the client keeps the official scope primary).
    // Durable spend ledger: remembers every Session's last observed day, so a
    // restart cannot shrink "today / all sessions" to the Sessions it loaded.
    const ledgerPath = dshHomePath('storages', 'dsh-context-show', 'spend-ledger.json');
    const ledger = createLedger((doc) => writeLedgerFile(ledgerPath, doc));
    void readLedgerFile(ledgerPath).then((doc) => { ledger.hydrate(doc); });
    ctx.effect(() => () => { void ledger.flush(); }, 'context-show: spend ledger flush');
    // Record observations even while the panel is closed (the bridge folds only
    // on demand).
    ctx.effect(() => ctx.sessionProjections.onChanged((session, key, value) => {
        if (key !== 'contextUsage')
            return;
        const view = value;
        ledger.observe(String(session.header.id), {
            cwd: session.header.cwd,
            today: view?.today,
            cumulative: view?.totalCost,
        }, dayKeyOf(liveSpec.now?.() ?? Date.now(), liveSpec.timeZone));
    }), 'context-show: spend ledger observations');
    ctx.inject(['settings', 'webServer', 'llm', 'sessions'], (bridgeCtx) => {
        // Cross-Session "today" spend is folded host-side over the ledger, so the
        // panel never depends on the browser's Session list caches.
        const spend = createSpendCollector({
            listSessions: () => bridgeCtx.sessions.list(),
            readContextUsage: (session) => bridgeCtx.sessionProjections.snapshot(session, ['contextUsage']).values['contextUsage'],
            spec: () => liveSpec,
            ledger,
        });
        bridgeCtx.effect(() => {
            const disposers = makeBridgeRoutes({ settings: bridgeCtx.settings, llm: bridgeCtx.llm, spend }).map(route => bridgeCtx.webServer.register(route));
            return () => {
                for (const dispose of disposers)
                    dispose();
            };
        }, 'context-show: settings bridge');
    });
}
