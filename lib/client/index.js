/**
 * dsh-context-show browser half: the collapsible context occupancy panel in
 * the conversation session header utilities row, plus the pricing settings
 * card in the web Settings plugin-configuration section.
 *
 * @module dsh-context-show/client
 */
import { createCompatScope } from "./bridge-scope.js";
import { ContextShowMeter } from "./ContextShowMeter.js";
import { ContextShowSettings, } from "./ContextShowSettings.js";
import { en, NS, zh } from "./locales.js";
/** Settings namespace spelled by the host plugin (see src/index.ts). */
const SETTINGS_NAMESPACE = 'context-show';
/** Required services: slots (ui-renderer), locale, and the settings scope binder. */
export const inject = ['slots', 'locale', 'settingsScope'];
/** Unavailable scope used when the settings surface cannot bind the namespace. */
function unavailableScope() {
    const snapshot = { status: 'unavailable', writable: false, mode: 'memory', revision: undefined };
    return {
        getSnapshot: () => snapshot,
        subscribe: () => () => { },
        set: async () => { },
        unset: async () => { },
        mutate: async () => { },
    };
}
/** Lenient structural decode: the host already schema-resolves the section. */
function decodeConfigView(section) {
    if (typeof section !== 'object' || section === null || Array.isArray(section))
        return undefined;
    const value = section;
    if (typeof value.currency !== 'string')
        return undefined;
    if (typeof value.prices !== 'object' || value.prices === null)
        return undefined;
    return {
        currency: value.currency,
        prices: value.prices,
        modelPrices: value.modelPrices ?? {},
        defaultPrice: value.defaultPrice ?? { inputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0, outputPerM: 0 },
        peakHours: Array.isArray(value.peakHours) ? value.peakHours : [],
        timeZone: typeof value.timeZone === 'string' ? value.timeZone : 'Asia/Shanghai',
    };
}
/**
 * Mount the meter entry and the pricing settings card.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-show: dictionaries');
    // The per-session occupancy panel is registered FIRST: nothing about the
    // settings surface may keep it from mounting.
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'context-show',
        order: 10,
        locale: NS,
    }, ContextShowMeter));
    // The pricing card in 设置 → 插件 → 可配置插件. The settings scope is bound
    // lazily (only when the section actually mounts the card) and defensively:
    // a bind failure degrades to an unavailable scope instead of breaking the
    // plugin fiber or dropping the card registration.
    ctx.slots.inject('settings.plugin.item', () => {
        let scope;
        try {
            // The rc.6 host-apiproxy refuses third-party settings namespaces, so the
            // official scope reports `context-show` unavailable. Keep it primary and
            // fall back to the loopback bridge over the host settings seam.
            const primary = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE, decode: decodeConfigView });
            scope = createCompatScope({ namespace: SETTINGS_NAMESPACE, primary, decode: decodeConfigView });
        }
        catch (_bindFailure) {
            scope = unavailableScope();
        }
        const save = async (section) => {
            await scope.set('currency', section.currency);
            await scope.set('peakHours', section.peakHours);
            await scope.set('timeZone', section.timeZone);
            await scope.set('prices', section.prices);
            await scope.set('modelPrices', section.modelPrices);
            await scope.set('defaultPrice', section.defaultPrice);
        };
        const reset = async () => {
            for (const field of ['currency', 'peakHours', 'timeZone', 'prices', 'modelPrices', 'defaultPrice']) {
                await scope.unset(field);
            }
        };
        const settingsInjected = () => ({ scope, save, reset });
        return ctx.slots.register({
            name: 'settings.plugin.item',
            key: SETTINGS_NAMESPACE,
            locale: NS,
            inject: settingsInjected,
        }, ContextShowSettings);
    });
}
