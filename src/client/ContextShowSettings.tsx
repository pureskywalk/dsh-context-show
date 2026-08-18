/**
 * The context-show settings page: edit the pricing table (currency, flat or
 * peak / off-peak rates per provider/model, peak-hour windows) through the
 * `context-show` settings namespace. Committed changes re-register the host
 * projection with the new pricing spec, so the panel's cost figures update
 * live.
 *
 * @module dsh-context-show/ContextShowSettings
 */

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-settings-plugins SlotMap merge (settings.plugin.item
// seat, declared at runtime by the configurable tab).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX, type BridgeModelsResult } from '../bridge-protocol.ts'
import type { ContextShowKey } from './locales.ts'
import styles from './ContextShowSettings.module.css'

/** One editable price field key (the base four, excluding the peak override). */
type PriceFieldKey = Exclude<keyof PriceView, 'peak'>

/** Client-side structural view of one route's price entry (wire JSON). */
export interface PriceView {
  inputPerM: number
  cacheReadPerM: number
  cacheWritePerM: number
  outputPerM: number
  /** Peak-hour overrides; absent fields fall back to the base rate. */
  peak?: Partial<PriceView>
}

/** Client-side structural view of one peak-hour window. */
export interface PeakRangeView {
  start: number
  end: number
}

/** Client-side structural view of the `context-show` settings section. */
export interface ConfigView {
  currency: string
  prices: Record<string, PriceView>
  modelPrices: Record<string, PriceView>
  defaultPrice: PriceView
  peakHours: PeakRangeView[]
  timeZone: string
}

/** Business face injected into the plugin-configuration card. */
export interface ContextShowSettingsInjected {
  /** Bound scope of the `context-show` settings namespace. */
  scope: SettingsScope<ConfigView>
  /** Persist the edited section (one field write per top-level key). */
  save(section: ConfigView): Promise<void>
  /** Clear the user layer so every field re-inherits the bundle defaults. */
  reset(): Promise<void>
}

/** Props supplied by the plugin card seat plus the locale and inject faces. */
export interface ContextShowSettingsProps
  extends PropsRuntime<'settings.plugin.item'>,
    PropsLocale<'context-show'>,
    ContextShowSettingsInjected {}

/** DeepSeek's announced peak windows (Beijing time), used when enabling tiering. */
const DEFAULT_PEAK_RANGES: readonly PeakRangeView[] = [
  { start: 9, end: 12 },
  { start: 14, end: 18 },
]

const EMPTY_PRICE = (): PriceView => ({ inputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0, outputPerM: 0 })

/** One detected provider/model route from the models bridge. */
interface ModelRoute {
  provider: string
  model: string
}

/** Deep-copy one price entry so auto-added rows never alias their source. */
const clonePrice = (price: PriceView): PriceView => ({
  inputPerM: price.inputPerM,
  cacheReadPerM: price.cacheReadPerM,
  cacheWritePerM: price.cacheWritePerM,
  outputPerM: price.outputPerM,
  ...(price.peak === undefined ? {} : { peak: { ...price.peak } }),
})

/** Add a model-level price for every detected route that has none yet. */
const mergeDetectedModels = (base: ConfigView, routes: ReadonlyArray<ModelRoute>): ConfigView => {
  if (routes.length === 0) return base
  const modelPrices = { ...base.modelPrices }
  for (const { provider, model } of routes) {
    const key = provider + '/' + model
    if (key in modelPrices) continue
    const source = base.prices[provider] ?? base.defaultPrice
    modelPrices[key] = clonePrice(source)
  }
  return { ...base, modelPrices }
}

/** The four base price fields, in display order. */
const PRICE_FIELDS: ReadonlyArray<{ key: PriceFieldKey; label: ContextShowKey }> = [
  { key: 'inputPerM', label: 'settings.priceInput' },
  { key: 'cacheReadPerM', label: 'settings.priceCacheRead' },
  { key: 'cacheWritePerM', label: 'settings.priceCacheWrite' },
  { key: 'outputPerM', label: 'settings.priceOutput' },
]

/** One price entry's editable table: base (闲时) column + optional peak column. */
const PriceFieldsEditor = memo(function PriceFieldsEditor({
  idPrefix,
  value,
  showPeak,
  onField,
  t,
}: {
  /** Unique id prefix so every input carries an id/name for form semantics. */
  idPrefix: string
  value: PriceView
  showPeak: boolean
  onField: (field: PriceFieldKey, peak: boolean, next: string) => void
  t: (key: ContextShowKey, params?: Record<string, unknown>) => string
}) {
  const numberValue = (current: number): string => (Number.isFinite(current) ? String(current) : '')
  return (
    <table className={styles.priceTable}>
      <thead>
        <tr>
          <th className={styles.priceFieldHead}>{t('settings.priceField')}</th>
          <th className={styles.priceValueHead}>{t('settings.priceOffPeak')}</th>
          {showPeak && <th className={styles.priceValueHead}>{t('settings.pricePeak')}</th>}
        </tr>
      </thead>
      <tbody>
        {PRICE_FIELDS.map((field) => {
          const offPeakId = idPrefix + '-' + field.key + '-offPeak'
          const peakId = idPrefix + '-' + field.key + '-peak'
          return (
          <tr key={field.key}>
            <td className={styles.priceFieldCell}>{t(field.label)}</td>
            <td className={styles.priceValueCell}>
              <input
                type="number"
                min="0"
                step="0.01"
                id={offPeakId}
                name={offPeakId}
                className={styles.numberInput}
                value={numberValue(value[field.key])}
                onChange={(event) => { onField(field.key, false, event.target.value) }}
              />
            </td>
            {showPeak && (
              <td className={styles.priceValueCell}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  id={peakId}
                  name={peakId}
                  className={styles.numberInput}
                  value={numberValue(value.peak?.[field.key] ?? 0)}
                  onChange={(event) => { onField(field.key, true, event.target.value) }}
                />
              </td>
            )}
          </tr>
          )
        })}
      </tbody>
    </table>
  )
})

/**
 * The settings page: pricing table editor.
 * @param props - settings seat, locale, and the injected scope face.
 * @returns the section content.
 */
export const ContextShowSettings = memo(function ContextShowSettings(props: ContextShowSettingsProps) {
  const { scope, save, reset, t } = props
  // `scope` is a class instance whose methods read `this`; passing the bare
  // methods to useSyncExternalStore drops the receiver and crashes getSnapshot.
  // Stable closures keep the receiver bound (matching how SnapshotStore hooks work).
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const value = snapshot.value
  const [draft, setDraft] = useState<ConfigView | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ReadonlyArray<ModelRoute> | null>(null)
  const modelsRef = useRef<ReadonlyArray<ModelRoute>>([])

  // Detect the provider/model catalog once through the loopback bridge so the
  // model price table auto-completes every currently available route.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        if (!response.ok) return
        const data = await response.json() as BridgeModelsResult
        if (cancelled || !data.ok) return
        setModels(data.value.groups.flatMap(group => group.models.map(model => ({ provider: group.provider, model }))))
      } catch {
        // Models bridge unavailable: keep the manual provider/model editors.
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (models !== null) modelsRef.current = models
  }, [models])

  useEffect(() => {
    if (value !== undefined) setDraft(mergeDetectedModels(value, modelsRef.current))
  }, [value])

  useEffect(() => {
    if (models === null) return
    setDraft((prev) => prev === null ? prev : mergeDetectedModels(prev, models))
  }, [models])

  /** Collapsible card chrome: a toggle header over the body (collapsed by default). */
  const shell = (body: ReactNode): ReactNode => (
    <div className={[styles.root, open ? styles.rootOpen : ''].join(' ')}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className={styles.headText}>
          <span className={styles.cardTitle}>{t('settings.cardTitle')}</span>
          <span className={styles.cardDesc}>{t('settings.cardDesc')}</span>
        </span>
        <svg className={[styles.chevron, open ? styles.chevronOpen : ''].join(' ')} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M4 5.5 7 8.5 10 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className={styles.body}>{body}</div>}
    </div>
  )

  if (snapshot.status === 'loading') {
    return shell(<p className={styles.empty}>{t('settings.loading')}</p>)
  }
  if (snapshot.status !== 'ready' || value === undefined || draft === null) {
    return shell(<p className={styles.empty}>{t('settings.unavailable')}</p>)
  }

  const showPeak = draft.peakHours.length > 0

  const patch = (next: Partial<ConfigView>): void => {
    setDraft((prev) => prev === null ? prev : { ...prev, ...next })
  }
  const patchPrice = (
    record: 'prices' | 'modelPrices' | 'defaultPrice',
    key: string | null,
    field: PriceFieldKey,
    peak: boolean,
    raw: string,
  ): void => {
    const numeric = raw === '' ? 0 : Number(raw)
    setDraft((prev) => {
      if (prev === null) return prev
      const target = record === 'defaultPrice'
        ? prev.defaultPrice
        : key === null ? EMPTY_PRICE() : prev[record][key] ?? EMPTY_PRICE()
      let nextTarget: PriceView
      if (peak) {
        // Peak column edits only the peak override, leaving the base rate alone.
        nextTarget = { ...target, peak: { ...(target.peak ?? {}), [field]: numeric } }
      } else {
        // Base column edits the base rate only; the peak override is independent.
        nextTarget = { ...target, [field]: numeric }
      }
      if (record === 'defaultPrice') return { ...prev, defaultPrice: nextTarget }
      if (key === null) return prev
      return { ...prev, [record]: { ...prev[record], [key]: nextTarget } }
    })
  }
  const renameKey = (record: 'prices' | 'modelPrices', oldKey: string, nextKey: string): void => {
    setDraft((prev) => {
      if (prev === null || oldKey === nextKey || nextKey === '') return prev
      const recordValue = prev[record]
      if (nextKey in recordValue) return prev
      // Rebuild in insertion order, renaming in place: the entry's React key
      // (its index) stays stable while typing, so the input keeps focus.
      const nextRecord: Record<string, PriceView> = {}
      for (const [current, price] of Object.entries(recordValue)) {
        nextRecord[current === oldKey ? nextKey : current] = price
      }
      return { ...prev, [record]: nextRecord }
    })
  }
  const removeKey = (record: 'prices' | 'modelPrices', key: string): void => {
    setDraft((prev) => {
      if (prev === null) return prev
      const nextRecord = { ...prev[record] }
      delete nextRecord[key]
      return { ...prev, [record]: nextRecord }
    })
  }
  const addKey = (record: 'prices' | 'modelPrices', key: string): void => {
    setDraft((prev) => {
      if (prev === null || key === '' || key in prev[record]) return prev
      return { ...prev, [record]: { ...prev[record], [key]: EMPTY_PRICE() } }
    })
  }

  const onSave = async (): Promise<void> => {
    setBusy(true)
    try {
      await save(draft)
    } finally {
      setBusy(false)
    }
  }
  const onReset = async (): Promise<void> => {
    setBusy(true)
    try {
      await reset()
    } finally {
      setBusy(false)
    }
  }

  const writable = snapshot.writable && snapshot.status === 'ready'

  return shell(
    <>
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="context-show-currency">{t('settings.currency')}</label>
        <select
          id="context-show-currency"
          name="context-show-currency"
          className={styles.selectInput}
          value={draft.currency}
          onChange={(event) => { patch({ currency: event.target.value }) }}
        >
          {['CNY', 'USD', 'CNH', 'EUR', 'GBP', 'JPY'].map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="context-show-peak">{t('settings.peakEnabled')}</label>
        <input
          id="context-show-peak"
          name="context-show-peak"
          type="checkbox"
          className={styles.checkboxInput}
          checked={showPeak}
          onChange={(event) => {
            patch({ peakHours: event.target.checked ? [...DEFAULT_PEAK_RANGES] : [] })
          }}
        />
        <span className={styles.fieldHint}>{t('settings.peakHint')}</span>
      </div>

      {showPeak && (
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="context-show-tz">{t('settings.timeZone')}</label>
          <input
            id="context-show-tz"
            name="context-show-tz"
            className={styles.textInput}
            value={draft.timeZone}
            onChange={(event) => { patch({ timeZone: event.target.value }) }}
          />
          <div className={styles.fieldRowWide}>
            {draft.peakHours.map((range, index) => (
              <span className={styles.rangeRow} key={index}>
                <span className={styles.rangeLabel}>{index === 0 ? t('settings.peakRange1') : t('settings.peakRange2')}</span>
                <input
                  type="number"
                  min="0"
                  max="23"
                  step="1"
                  id={`context-show-peak-${index}-start`}
                  name={`context-show-peak-${index}-start`}
                  className={styles.numberInputSmall}
                  value={String(range.start)}
                  onChange={(event) => {
                    const hours = [...draft.peakHours]
                    hours[index] = { ...hours[index]!, start: event.target.value === '' ? 0 : Number(event.target.value) }
                    patch({ peakHours: hours })
                  }}
                />
                <span className={styles.rangeSep}>–</span>
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="1"
                  id={`context-show-peak-${index}-end`}
                  name={`context-show-peak-${index}-end`}
                  className={styles.numberInputSmall}
                  value={String(range.end)}
                  onChange={(event) => {
                    const hours = [...draft.peakHours]
                    hours[index] = { ...hours[index]!, end: event.target.value === '' ? 0 : Number(event.target.value) }
                    patch({ peakHours: hours })
                  }}
                />
              </span>
            ))}
          </div>
        </div>
      )}

      <h3 className={styles.sectionTitle}>{t('settings.defaultPrice')}</h3>
      <PriceFieldsEditor
        idPrefix="context-show-default"
        value={draft.defaultPrice}
        showPeak={showPeak}
        onField={(field, peak, raw) => { patchPrice('defaultPrice', null, field, peak, raw) }}
        t={t}
      />

      <h3 className={styles.sectionTitle}>{t('settings.providerPrices')}</h3>
      {Object.entries(draft.prices).map(([key, price], index) => (
        <div className={styles.entryCard} key={index}>
          <div className={styles.entryHeader}>
            <input
              className={styles.textInput}
              id={`context-show-provider-key-${index}`}
              name={`context-show-provider-key-${index}`}
              value={key}
              onChange={(event) => { renameKey('prices', key, event.target.value.trim()) }}
            />
            <button
              type="button"
              className={styles.removeButton}
              aria-label={t('settings.removeProvider', { key })}
              onClick={() => { removeKey('prices', key) }}
            >✕</button>
          </div>
          <PriceFieldsEditor idPrefix={'context-show-prices-' + key.replace(/[^a-zA-Z0-9_-]/g, '_')} value={price} showPeak={showPeak} onField={(field, peak, raw) => { patchPrice('prices', key, field, peak, raw) }} t={t} />
        </div>
      ))}
      <button type="button" className={styles.addButton} onClick={() => { addKey('prices', 'new-provider') }}>
        + {t('settings.addProvider')}
      </button>

      <h3 className={styles.sectionTitle}>{t('settings.modelPrices')}</h3>
      {models !== null && models.length > 0 && <p className={styles.note}>{t('settings.autoModelsHint')}</p>}
      {Object.entries(draft.modelPrices).map(([key, price], index) => (
        <div className={styles.entryCard} key={index}>
          <div className={styles.entryHeader}>
            <input
              className={styles.textInput}
              id={`context-show-model-key-${index}`}
              name={`context-show-model-key-${index}`}
              value={key}
              onChange={(event) => { renameKey('modelPrices', key, event.target.value.trim()) }}
            />
            <button
              type="button"
              className={styles.removeButton}
              aria-label={t('settings.removeModel', { key })}
              onClick={() => { removeKey('modelPrices', key) }}
            >✕</button>
          </div>
          <PriceFieldsEditor idPrefix={'context-show-models-' + key.replace(/[^a-zA-Z0-9_-]/g, '_')} value={price} showPeak={showPeak} onField={(field, peak, raw) => { patchPrice('modelPrices', key, field, peak, raw) }} t={t} />
        </div>
      ))}
      <button type="button" className={styles.addButton} onClick={() => { addKey('modelPrices', 'provider/model') }}>
        + {t('settings.addModel')}
      </button>

      <p className={styles.note}>{t('settings.note')}</p>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!writable || busy}
          onClick={() => { void onSave() }}
        >{t('settings.save')}</button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={!writable || busy}
          onClick={() => { void onReset() }}
        >{t('settings.reset')}</button>
      </div>
    </>
  )
})
