/**
 * dsh-context-show browser half: the collapsible context occupancy panel in
 * the conversation session header utilities row, plus the pricing settings
 * card in the web Settings plugin-configuration section.
 *
 * @module dsh-context-show/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale), the
// ui-conversation SlotMap merge (the header utilities seat), the ui-settings
// scope binder, and the plugin-configuration slot merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
// Type-only: pulls the contextUsage projection key into the client program.
import type {} from '../projection.ts'
import { createCompatScope } from './bridge-scope.ts'
import { ContextShowMeter } from './ContextShowMeter.tsx'
import {
  ContextShowSettings,
  type ConfigView,
  type ContextShowSettingsInjected,
  type PeakRangeView,
  type PriceView,
} from './ContextShowSettings.tsx'
import { en, NS, zh, type ContextShowKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The context-show panel and settings copy. */
    'context-show': ContextShowKey
  }
}

/** Settings namespace spelled by the host plugin (see src/index.ts). */
const SETTINGS_NAMESPACE = 'context-show'

/** Required services: slots, locale, the settings scope binder, and its wire. */
export const inject = ['slots', 'locale', 'settingsScope', 'connection', 'remote']

/** Unavailable scope used when the settings surface cannot bind the namespace. */
function unavailableScope(): SettingsScope<ConfigView> {
  const snapshot = { status: 'unavailable', writable: false, mode: 'memory', revision: undefined } as const
  return {
    getSnapshot: () => snapshot as never,
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
}

/** Lenient structural decode: the host already schema-resolves the section. */
function decodeConfigView(section: unknown): ConfigView | undefined {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  const value = section as Partial<ConfigView>
  if (typeof value.currency !== 'string') return undefined
  if (typeof value.prices !== 'object' || value.prices === null) return undefined
  return {
    currency: value.currency,
    prices: value.prices as Record<string, PriceView>,
    modelPrices: (value.modelPrices as Record<string, PriceView> | undefined) ?? {},
    defaultPrice: value.defaultPrice as PriceView | undefined ?? { inputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0, outputPerM: 0 },
    peakHours: Array.isArray(value.peakHours) ? value.peakHours as PeakRangeView[] : [],
    timeZone: typeof value.timeZone === 'string' ? value.timeZone : 'Asia/Shanghai',
  }
}

/**
 * Mount the meter entry and the pricing settings card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-show: dictionaries')

  // The per-session occupancy panel is registered FIRST: nothing about the
  // settings surface may keep it from mounting.
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'context-show',
    order: 10,
    locale: NS,
  }, ContextShowMeter))

  // The pricing card in 设置 → 插件 → 可配置插件. The settings scope is bound
  // lazily (only when the section actually mounts the card) and defensively:
  // a bind failure degrades to an unavailable scope instead of breaking the
  // plugin fiber or dropping the card registration.
  ctx.slots.inject('settings.plugin.item', () => {
    let scope: SettingsScope<ConfigView>
    try {
      // The rc.6 host-apiproxy refuses third-party settings namespaces, so the
      // official scope reports `context-show` unavailable. Keep it primary and
      // fall back to the loopback bridge over the host settings seam.
      const primary = ctx.settingsScope.bind<ConfigView>({ namespace: SETTINGS_NAMESPACE, decode: decodeConfigView })
      scope = createCompatScope<ConfigView>({ namespace: SETTINGS_NAMESPACE, primary, decode: decodeConfigView })
    } catch (_bindFailure) {
      scope = unavailableScope()
    }
    const save = async (section: ConfigView): Promise<void> => {
      await scope.set('currency', section.currency)
      await scope.set('peakHours', section.peakHours)
      await scope.set('timeZone', section.timeZone)
      await scope.set('prices', section.prices)
      await scope.set('modelPrices', section.modelPrices)
      await scope.set('defaultPrice', section.defaultPrice)
    }
    const reset = async (): Promise<void> => {
      for (const field of ['currency', 'peakHours', 'timeZone', 'prices', 'modelPrices', 'defaultPrice']) {
        await scope.unset(field)
      }
    }
    const settingsInjected = (): ContextShowSettingsInjected => ({ scope, save, reset })
    return ctx.slots.register({
      name: 'settings.plugin.item',
      key: SETTINGS_NAMESPACE,
      locale: NS,
      inject: settingsInjected,
    }, ContextShowSettings)
  })
}
