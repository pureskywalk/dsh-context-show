import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The context-show settings page: edit the pricing table (currency, flat or
 * peak / off-peak rates per provider/model, peak-hour windows) through the
 * `context-show` settings namespace. Committed changes re-register the host
 * projection with the new pricing spec, so the panel's cost figures update
 * live.
 *
 * @module dsh-context-show/ContextShowSettings
 */
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX } from "../bridge-protocol.js";
import styles from './ContextShowSettings.module.css';
/** DeepSeek's announced peak windows (Beijing time), used when enabling tiering. */
const DEFAULT_PEAK_RANGES = [
    { start: 9, end: 12 },
    { start: 14, end: 18 },
];
const EMPTY_PRICE = () => ({ inputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0, outputPerM: 0 });
/** Deep-copy one price entry so auto-added rows never alias their source. */
const clonePrice = (price) => ({
    inputPerM: price.inputPerM,
    cacheReadPerM: price.cacheReadPerM,
    cacheWritePerM: price.cacheWritePerM,
    outputPerM: price.outputPerM,
    ...(price.peak === undefined ? {} : { peak: { ...price.peak } }),
});
/** Add a model-level price for every detected route that has none yet. */
const mergeDetectedModels = (base, routes) => {
    if (routes.length === 0)
        return base;
    const modelPrices = { ...base.modelPrices };
    for (const { provider, model } of routes) {
        const key = provider + '/' + model;
        if (key in modelPrices)
            continue;
        const source = base.prices[provider] ?? base.defaultPrice;
        modelPrices[key] = clonePrice(source);
    }
    return { ...base, modelPrices };
};
/** The four base price fields, in display order. */
const PRICE_FIELDS = [
    { key: 'inputPerM', label: 'settings.priceInput' },
    { key: 'cacheReadPerM', label: 'settings.priceCacheRead' },
    { key: 'cacheWritePerM', label: 'settings.priceCacheWrite' },
    { key: 'outputPerM', label: 'settings.priceOutput' },
];
/** One price entry's editable table: base (闲时) column + optional peak column. */
const PriceFieldsEditor = memo(function PriceFieldsEditor({ idPrefix, value, showPeak, onField, t, }) {
    const numberValue = (current) => (Number.isFinite(current) ? String(current) : '');
    return (_jsxs("table", { className: styles.priceTable, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: styles.priceFieldHead, children: t('settings.priceField') }), _jsx("th", { className: styles.priceValueHead, children: t('settings.priceOffPeak') }), showPeak && _jsx("th", { className: styles.priceValueHead, children: t('settings.pricePeak') })] }) }), _jsx("tbody", { children: PRICE_FIELDS.map((field) => {
                    const offPeakId = idPrefix + '-' + field.key + '-offPeak';
                    const peakId = idPrefix + '-' + field.key + '-peak';
                    return (_jsxs("tr", { children: [_jsx("td", { className: styles.priceFieldCell, children: t(field.label) }), _jsx("td", { className: styles.priceValueCell, children: _jsx("input", { type: "number", min: "0", step: "0.01", id: offPeakId, name: offPeakId, className: styles.numberInput, value: numberValue(value[field.key]), onChange: (event) => { onField(field.key, false, event.target.value); } }) }), showPeak && (_jsx("td", { className: styles.priceValueCell, children: _jsx("input", { type: "number", min: "0", step: "0.01", id: peakId, name: peakId, className: styles.numberInput, value: numberValue(value.peak?.[field.key] ?? 0), onChange: (event) => { onField(field.key, true, event.target.value); } }) }))] }, field.key));
                }) })] }));
});
/**
 * The settings page: pricing table editor.
 * @param props - settings seat, locale, and the injected scope face.
 * @returns the section content.
 */
export const ContextShowSettings = memo(function ContextShowSettings(props) {
    const { scope, save, reset, t } = props;
    // `scope` is a class instance whose methods read `this`; passing the bare
    // methods to useSyncExternalStore drops the receiver and crashes getSnapshot.
    // Stable closures keep the receiver bound (matching how SnapshotStore hooks work).
    const subscribe = useCallback((listener) => scope.subscribe(listener), [scope]);
    const getSnapshot = useCallback(() => scope.getSnapshot(), [scope]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    const value = snapshot.value;
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState(null);
    const modelsRef = useRef([]);
    // Detect the provider/model catalog once through the loopback bridge so the
    // model price table auto-completes every currently available route.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch(CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/models', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{}',
                });
                if (!response.ok)
                    return;
                const data = await response.json();
                if (cancelled || !data.ok)
                    return;
                setModels(data.value.groups.flatMap(group => group.models.map(model => ({ provider: group.provider, model }))));
            }
            catch {
                // Models bridge unavailable: keep the manual provider/model editors.
            }
        })();
        return () => { cancelled = true; };
    }, []);
    useEffect(() => {
        if (models !== null)
            modelsRef.current = models;
    }, [models]);
    useEffect(() => {
        if (value !== undefined)
            setDraft(mergeDetectedModels(value, modelsRef.current));
    }, [value]);
    useEffect(() => {
        if (models === null)
            return;
        setDraft((prev) => prev === null ? prev : mergeDetectedModels(prev, models));
    }, [models]);
    /** Collapsible card chrome: a toggle header over the body (collapsed by default). */
    const shell = (body) => (_jsxs("div", { className: [styles.root, open ? styles.rootOpen : ''].join(' '), children: [_jsxs("button", { type: "button", className: styles.header, "aria-expanded": open, onClick: () => { setOpen(!open); }, children: [_jsxs("span", { className: styles.headText, children: [_jsx("span", { className: styles.cardTitle, children: t('settings.cardTitle') }), _jsx("span", { className: styles.cardDesc, children: t('settings.cardDesc') })] }), _jsx("svg", { className: [styles.chevron, open ? styles.chevronOpen : ''].join(' '), width: "14", height: "14", viewBox: "0 0 14 14", "aria-hidden": "true", children: _jsx("path", { d: "M4 5.5 7 8.5 10 5.5", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) })] }), open && _jsx("div", { className: styles.body, children: body })] }));
    if (snapshot.status === 'loading') {
        return shell(_jsx("p", { className: styles.empty, children: t('settings.loading') }));
    }
    if (snapshot.status !== 'ready' || value === undefined || draft === null) {
        return shell(_jsx("p", { className: styles.empty, children: t('settings.unavailable') }));
    }
    const showPeak = draft.peakHours.length > 0;
    const patch = (next) => {
        setDraft((prev) => prev === null ? prev : { ...prev, ...next });
    };
    const patchPrice = (record, key, field, peak, raw) => {
        const numeric = raw === '' ? 0 : Number(raw);
        setDraft((prev) => {
            if (prev === null)
                return prev;
            const target = record === 'defaultPrice'
                ? prev.defaultPrice
                : key === null ? EMPTY_PRICE() : prev[record][key] ?? EMPTY_PRICE();
            let nextTarget;
            if (peak) {
                // Peak column edits only the peak override, leaving the base rate alone.
                nextTarget = { ...target, peak: { ...(target.peak ?? {}), [field]: numeric } };
            }
            else {
                // Base column edits the base rate and drops the matching peak override.
                const peakOverride = target.peak === undefined ? undefined : { ...target.peak };
                if (peakOverride !== undefined)
                    delete peakOverride[field];
                nextTarget = { ...target, [field]: numeric, ...(peakOverride === undefined ? {} : { peak: peakOverride }) };
            }
            if (record === 'defaultPrice')
                return { ...prev, defaultPrice: nextTarget };
            if (key === null)
                return prev;
            return { ...prev, [record]: { ...prev[record], [key]: nextTarget } };
        });
    };
    const renameKey = (record, oldKey, nextKey) => {
        setDraft((prev) => {
            if (prev === null || oldKey === nextKey || nextKey === '')
                return prev;
            const recordValue = prev[record];
            if (nextKey in recordValue)
                return prev;
            // Rebuild in insertion order, renaming in place: the entry's React key
            // (its index) stays stable while typing, so the input keeps focus.
            const nextRecord = {};
            for (const [current, price] of Object.entries(recordValue)) {
                nextRecord[current === oldKey ? nextKey : current] = price;
            }
            return { ...prev, [record]: nextRecord };
        });
    };
    const removeKey = (record, key) => {
        setDraft((prev) => {
            if (prev === null)
                return prev;
            const nextRecord = { ...prev[record] };
            delete nextRecord[key];
            return { ...prev, [record]: nextRecord };
        });
    };
    const addKey = (record, key) => {
        setDraft((prev) => {
            if (prev === null || key === '' || key in prev[record])
                return prev;
            return { ...prev, [record]: { ...prev[record], [key]: EMPTY_PRICE() } };
        });
    };
    const onSave = async () => {
        setBusy(true);
        try {
            await save(draft);
        }
        finally {
            setBusy(false);
        }
    };
    const onReset = async () => {
        setBusy(true);
        try {
            await reset();
        }
        finally {
            setBusy(false);
        }
    };
    const writable = snapshot.writable && snapshot.status === 'ready';
    return shell(_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.fieldRow, children: [_jsx("label", { className: styles.fieldLabel, htmlFor: "context-show-currency", children: t('settings.currency') }), _jsx("select", { id: "context-show-currency", name: "context-show-currency", className: styles.selectInput, value: draft.currency, onChange: (event) => { patch({ currency: event.target.value }); }, children: ['CNY', 'USD', 'CNH', 'EUR', 'GBP', 'JPY'].map((code) => (_jsx("option", { value: code, children: code }, code))) })] }), _jsxs("div", { className: styles.fieldRow, children: [_jsx("label", { className: styles.fieldLabel, htmlFor: "context-show-peak", children: t('settings.peakEnabled') }), _jsx("input", { id: "context-show-peak", name: "context-show-peak", type: "checkbox", className: styles.checkboxInput, checked: showPeak, onChange: (event) => {
                            patch({ peakHours: event.target.checked ? [...DEFAULT_PEAK_RANGES] : [] });
                        } }), _jsx("span", { className: styles.fieldHint, children: t('settings.peakHint') })] }), showPeak && (_jsxs("div", { className: styles.fieldRow, children: [_jsx("label", { className: styles.fieldLabel, htmlFor: "context-show-tz", children: t('settings.timeZone') }), _jsx("input", { id: "context-show-tz", name: "context-show-tz", className: styles.textInput, value: draft.timeZone, onChange: (event) => { patch({ timeZone: event.target.value }); } }), _jsx("div", { className: styles.fieldRowWide, children: draft.peakHours.map((range, index) => (_jsxs("span", { className: styles.rangeRow, children: [_jsx("span", { className: styles.rangeLabel, children: index === 0 ? t('settings.peakRange1') : t('settings.peakRange2') }), _jsx("input", { type: "number", min: "0", max: "23", step: "1", id: `context-show-peak-${index}-start`, name: `context-show-peak-${index}-start`, className: styles.numberInputSmall, value: String(range.start), onChange: (event) => {
                                        const hours = [...draft.peakHours];
                                        hours[index] = { ...hours[index], start: event.target.value === '' ? 0 : Number(event.target.value) };
                                        patch({ peakHours: hours });
                                    } }), _jsx("span", { className: styles.rangeSep, children: "\u2013" }), _jsx("input", { type: "number", min: "0", max: "24", step: "1", id: `context-show-peak-${index}-end`, name: `context-show-peak-${index}-end`, className: styles.numberInputSmall, value: String(range.end), onChange: (event) => {
                                        const hours = [...draft.peakHours];
                                        hours[index] = { ...hours[index], end: event.target.value === '' ? 0 : Number(event.target.value) };
                                        patch({ peakHours: hours });
                                    } })] }, index))) })] })), _jsx("h3", { className: styles.sectionTitle, children: t('settings.defaultPrice') }), _jsx(PriceFieldsEditor, { idPrefix: "context-show-default", value: draft.defaultPrice, showPeak: showPeak, onField: (field, peak, raw) => { patchPrice('defaultPrice', null, field, peak, raw); }, t: t }), _jsx("h3", { className: styles.sectionTitle, children: t('settings.providerPrices') }), Object.entries(draft.prices).map(([key, price], index) => (_jsxs("div", { className: styles.entryCard, children: [_jsxs("div", { className: styles.entryHeader, children: [_jsx("input", { className: styles.textInput, id: `context-show-provider-key-${index}`, name: `context-show-provider-key-${index}`, value: key, onChange: (event) => { renameKey('prices', key, event.target.value.trim()); } }), _jsx("button", { type: "button", className: styles.removeButton, "aria-label": t('settings.removeProvider', { key }), onClick: () => { removeKey('prices', key); }, children: "\u2715" })] }), _jsx(PriceFieldsEditor, { idPrefix: 'context-show-prices-' + key.replace(/[^a-zA-Z0-9_-]/g, '_'), value: price, showPeak: showPeak, onField: (field, peak, raw) => { patchPrice('prices', key, field, peak, raw); }, t: t })] }, index))), _jsxs("button", { type: "button", className: styles.addButton, onClick: () => { addKey('prices', 'new-provider'); }, children: ["+ ", t('settings.addProvider')] }), _jsx("h3", { className: styles.sectionTitle, children: t('settings.modelPrices') }), models !== null && models.length > 0 && _jsx("p", { className: styles.note, children: t('settings.autoModelsHint') }), Object.entries(draft.modelPrices).map(([key, price], index) => (_jsxs("div", { className: styles.entryCard, children: [_jsxs("div", { className: styles.entryHeader, children: [_jsx("input", { className: styles.textInput, id: `context-show-model-key-${index}`, name: `context-show-model-key-${index}`, value: key, onChange: (event) => { renameKey('modelPrices', key, event.target.value.trim()); } }), _jsx("button", { type: "button", className: styles.removeButton, "aria-label": t('settings.removeModel', { key }), onClick: () => { removeKey('modelPrices', key); }, children: "\u2715" })] }), _jsx(PriceFieldsEditor, { idPrefix: 'context-show-models-' + key.replace(/[^a-zA-Z0-9_-]/g, '_'), value: price, showPeak: showPeak, onField: (field, peak, raw) => { patchPrice('modelPrices', key, field, peak, raw); }, t: t })] }, index))), _jsxs("button", { type: "button", className: styles.addButton, onClick: () => { addKey('modelPrices', 'provider/model'); }, children: ["+ ", t('settings.addModel')] }), _jsx("p", { className: styles.note, children: t('settings.note') }), _jsxs("div", { className: styles.footer, children: [_jsx("button", { type: "button", className: styles.primaryButton, disabled: !writable || busy, onClick: () => { void onSave(); }, children: t('settings.save') }), _jsx("button", { type: "button", className: styles.secondaryButton, disabled: !writable || busy, onClick: () => { void onReset(); }, children: t('settings.reset') })] })] }));
});
