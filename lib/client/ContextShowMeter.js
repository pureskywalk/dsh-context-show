import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The context-show session header entry: a compact occupancy trigger that
 * toggles a draggable panel with the context composition sources, the
 * per-tool usage, estimated USD cost, and token usage.
 *
 * The panel has two modes: compact (key figures only — occupancy, total
 * cost, top tools) and detailed (composition, tool usage table, per-provider
 * cost with official pricing links, token usage). It is persistent (focus
 * changes never close it) and can be dragged anywhere by its grip handle;
 * once dragged it floats freely until closed.
 *
 * All figures are reactive: the session projections (`contextPressure`,
 * `contextBreakdown`, `tokenUsage`, `contextUsage`) are pushed live by the
 * host, and the conversation snapshot re-renders the tool list, so the
 * panel stays current while a turn streams.
 *
 * @module dsh-context-show/ContextShowMeter
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { toolUsage } from "./estimate.js";
import { billedInputTokens, cacheHitPercent, formatMoney, formatTokens, totalTokensOf } from "./formats.js";
import styles from './ContextShowMeter.module.css';
/** Ring geometry: 14px viewBox, 2px stroke, matching the shipped meter. */
const RING_RADIUS = 5.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** How many tools the detailed table lists. */
const TOP_TOOLS = 6;
/** Minimum panel corner kept inside the viewport while dragging. */
const DRAG_MARGIN = 8;
const DRAG_MIN_VISIBLE = 120;
/** Composition legend rows, in bar-segment order; each class carries the tint. */
const COMPOSITION_ROWS = [
    { key: 'systemTokens', label: 'context.system', color: styles.colorSystem ?? '' },
    { key: 'toolsTokens', label: 'context.tools', color: styles.colorTools ?? '' },
    { key: 'messageTokens', label: 'context.messages', color: styles.colorMessages ?? '' },
];
/** Occupancy ring fill severity by used share. */
function ringTone(percent) {
    if (percent >= 90)
        return styles.ringHigh ?? '';
    if (percent >= 70)
        return styles.ringMid ?? '';
    return styles.ringLow ?? '';
}
/** Approximate occupancy with its numerator and denominator, or null. */
function contextOccupancy(pressure) {
    const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
    if (usedTokens === undefined || pressure?.contextWindow === undefined)
        return null;
    return {
        percent: Math.min(100, Math.round((usedTokens / pressure.contextWindow) * 100)),
        usedTokens,
        contextWindow: pressure.contextWindow,
    };
}
/** Clamp a dragged coordinate so most of the panel stays on screen. */
function clampDrag(value, limit) {
    return Math.min(Math.max(value, DRAG_MARGIN), limit - DRAG_MARGIN - DRAG_MIN_VISIBLE);
}
/**
 * The header utility: ring trigger + toggled draggable panel.
 * @param props - framework kit plus the context-show locale seat.
 * @returns the meter entry, always visible so the panel stays reachable.
 */
export const ContextShowMeter = memo(function ContextShowMeter(props) {
    const { useChat, useProjection, t } = props;
    const nodes = useChat((snapshot) => snapshot.legacy.nodes);
    const pressure = useProjection('contextPressure');
    const breakdown = useProjection('contextBreakdown');
    const usage = useProjection('tokenUsage');
    const providerUsage = useProjection('contextUsage');
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState(false);
    const [position, setPosition] = useState(null);
    const rootRef = useRef(null);
    const panelRef = useRef(null);
    const dragRef = useRef(null);
    const occupancy = contextOccupancy(pressure);
    const toolRows = useMemo(() => toolUsage(nodes, TOP_TOOLS), [nodes]);
    // Persistent panel: Escape is the only automatic dismissal (explicit, not
    // focus loss). Clicking the trigger toggles; clicking elsewhere leaves the
    // panel open so it keeps showing while the user reads the chat.
    useEffect(() => {
        if (!open)
            return;
        const onKeyDown = (event) => {
            if (event.key === 'Escape')
                setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);
    // Dragging the grip handle floats the panel (position: fixed). The handle
    // captures the pointer, so move/up arrive there even outside the panel.
    const startDrag = (event) => {
        const panel = panelRef.current;
        if (panel === null)
            return;
        event.preventDefault();
        const rect = panel.getBoundingClientRect();
        dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveDrag = (event) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId)
            return;
        setPosition({
            left: clampDrag(event.clientX - drag.offsetX, window.innerWidth),
            top: clampDrag(event.clientY - drag.offsetY, window.innerHeight),
        });
    };
    const endDrag = (event) => {
        if (dragRef.current?.pointerId === event.pointerId)
            dragRef.current = null;
    };
    const compositionTotal = breakdown === undefined
        ? 0
        : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
    const usageTotal = usage === undefined ? 0 : totalTokensOf(usage);
    const cacheHit = usage === undefined ? null : cacheHitPercent(usage);
    const segments = breakdown === undefined || compositionTotal === 0
        ? (occupancy === null ? [] : [{ key: 'total', color: '', width: occupancy.percent }])
        : COMPOSITION_ROWS.map((row) => ({
            key: row.key,
            color: row.color,
            width: occupancy === null ? 0 : occupancy.percent * breakdown[row.key] / compositionTotal,
        })).filter((segment) => segment.width > 0);
    const unattributedTokens = providerUsage === undefined ? 0 : totalTokensOf(providerUsage.unattributed);
    const hasProviderRows = providerUsage !== undefined
        && (providerUsage.providers.length > 0 || unattributedTokens > 0);
    const totalCost = providerUsage?.totalCost ?? 0;
    const peakLabel = providerUsage?.peakHours === undefined || providerUsage.peakHours.length === 0
        ? null
        : providerUsage.peakHours.map((range) => range.start + '-' + range.end).join('、');
    const triggerLabel = occupancy === null
        ? (usageTotal > 0 ? t('context.usageTotal', { total: formatTokens(usageTotal) }) : '—')
        : t('context.occupancySummary', {
            percent: String(occupancy.percent),
            used: formatTokens(occupancy.usedTokens),
            window: formatTokens(occupancy.contextWindow),
        });
    const triggerPercent = occupancy === null ? null : occupancy.percent;
    const anyData = occupancy !== null || compositionTotal > 0 || toolRows.length > 0
        || usageTotal > 0 || totalCost > 0;
    const modelsByCost = providerUsage === undefined
        ? []
        : [...providerUsage.providers].sort((left, right) => right.cost - left.cost);
    const currency = providerUsage?.currency ?? 'CNY';
    return (_jsxs("span", { ref: rootRef, className: styles.root, children: [_jsxs("button", { type: "button", className: styles.trigger, "aria-label": t('context.toggle'), "aria-haspopup": "dialog", "aria-expanded": open, title: triggerLabel, onClick: () => { setOpen(!open); }, children: [_jsxs("svg", { viewBox: "0 0 14 14", width: "14", height: "14", "aria-hidden": "true", children: [_jsx("circle", { className: styles.ringTrack, cx: "7", cy: "7", r: RING_RADIUS }), triggerPercent !== null && (_jsx("circle", { className: ringTone(triggerPercent), cx: "7", cy: "7", r: RING_RADIUS, strokeDasharray: `${RING_CIRCUMFERENCE * triggerPercent / 100} ${RING_CIRCUMFERENCE}`, transform: "rotate(-90 7 7)" }))] }), _jsx("span", { className: styles.triggerText, children: triggerPercent === null ? '·' : triggerPercent + '%' })] }), open && (_jsxs("div", { className: styles.panel, ref: panelRef, role: "dialog", "aria-label": t('context.occupancy'), style: position === null ? undefined : {
                    position: 'fixed',
                    left: position.left + 'px',
                    top: position.top + 'px',
                    right: 'auto',
                    bottom: 'auto',
                    margin: 0,
                }, children: [_jsxs("div", { className: styles.panelHeader, children: [_jsx("button", { type: "button", className: styles.dragHandle, "aria-label": t('context.drag'), title: t('context.drag'), onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, children: _jsxs("svg", { viewBox: "0 0 8 12", width: "8", height: "12", "aria-hidden": "true", children: [_jsx("circle", { cx: "2", cy: "2", r: "1.1" }), _jsx("circle", { cx: "6", cy: "2", r: "1.1" }), _jsx("circle", { cx: "2", cy: "6", r: "1.1" }), _jsx("circle", { cx: "6", cy: "6", r: "1.1" }), _jsx("circle", { cx: "2", cy: "10", r: "1.1" }), _jsx("circle", { cx: "6", cy: "10", r: "1.1" })] }) }), _jsx("span", { className: styles.headline, children: t('context.occupancy') }), _jsx("button", { type: "button", className: styles.iconButton, "aria-label": detail ? t('context.compactMode') : t('context.detailMode'), title: detail ? t('context.compactMode') : t('context.detailMode'), onClick: () => { setDetail(!detail); }, children: detail ? '▴' : '▾' }), _jsx("button", { type: "button", className: styles.iconButton, "aria-label": t('context.close'), title: t('context.close'), onClick: () => { setOpen(false); }, children: "\u2715" })] }), _jsxs("div", { className: styles.keyFigures, children: [_jsx("span", { className: styles.figures, children: occupancy !== null
                                    ? t('context.occupancySummary', {
                                        percent: String(occupancy.percent),
                                        used: formatTokens(occupancy.usedTokens),
                                        window: formatTokens(occupancy.contextWindow),
                                    })
                                    : usageTotal > 0 ? t('context.usageTotal', { total: formatTokens(usageTotal) }) : '—' }), hasProviderRows && providerUsage !== undefined && (_jsx("span", { className: styles.costInline, children: formatMoney(totalCost, providerUsage.currency) }))] }), !detail ? (_jsx(_Fragment, { children: !anyData && _jsx("p", { className: styles.empty, children: t('context.noUsage') }) })) : (_jsxs(_Fragment, { children: [segments.length > 0 && (_jsx("div", { className: styles.bar, role: "img", "aria-label": breakdown === undefined ? triggerLabel : t('context.composition'), children: segments.map((segment) => (_jsx("span", { className: segment.color === '' ? styles.segment : styles.segment + ' ' + segment.color, style: { width: segment.width + '%' } }, segment.key))) })), breakdown !== undefined && compositionTotal > 0 && (_jsx("div", { className: styles.rows, children: COMPOSITION_ROWS.map((row) => (_jsxs("div", { className: styles.row, children: [_jsxs("dt", { children: [_jsx("span", { className: styles.swatch + ' ' + row.color, "aria-hidden": "true" }), t(row.label)] }), _jsxs("dd", { children: ["\u2248", formatTokens(breakdown[row.key])] })] }, row.key))) })), toolRows.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h3", { className: styles.sectionTitle, children: t('context.toolUsage') }), _jsxs("div", { className: styles.toolHeader, "aria-hidden": "true", children: [_jsx("span", { className: styles.toolName, children: t('context.toolHeader') }), _jsx("span", { className: styles.toolCalls, children: t('context.callsHeader') }), _jsx("span", { className: styles.toolTokens, children: t('context.tokensHeader') })] }), _jsx("ul", { className: styles.toolList, children: toolRows.map((tool) => (_jsxs("li", { className: styles.toolRow, children: [_jsx("span", { className: styles.toolName, title: tool.name, children: tool.name }), _jsx("span", { className: styles.toolCalls, children: t('context.toolCalls', { calls: String(tool.calls) }) }), _jsxs("span", { className: styles.toolTokens, title: t('context.tokensHint'), children: ["\u2248", formatTokens(tool.tokens)] })] }, tool.name))) })] })), hasProviderRows && providerUsage !== undefined && (_jsxs(_Fragment, { children: [_jsxs("h3", { className: styles.sectionTitle, children: [t('context.cost'), _jsxs("span", { className: styles.sectionHint, children: [t('context.costEstimated'), peakLabel !== null && providerUsage.timeZone !== undefined && (' · ' + t('context.peakHours', { hours: peakLabel, timeZone: providerUsage.timeZone }))] })] }), _jsxs("div", { className: styles.providerList, children: [modelsByCost.map((model) => (_jsxs("div", { className: styles.providerCard, children: [_jsxs("div", { className: styles.providerLine, children: [_jsx("span", { className: styles.providerName, children: model.model }), _jsx("span", { className: styles.providerModel, children: model.provider }), _jsx("span", { className: styles.providerCost, children: formatMoney(model.cost, currency) })] }), _jsxs("div", { className: styles.providerTokensLine, children: [_jsx("span", { className: styles.providerTokens, children: t('context.providerUsage', {
                                                                    input: formatTokens(billedInputTokens(model)),
                                                                    output: formatTokens(model.outputTokens),
                                                                }) }), model.priceUrl !== undefined && (_jsx("a", { className: styles.priceLink, href: model.priceUrl, target: "_blank", rel: "noreferrer", onClick: (event) => { event.stopPropagation(); }, children: t('context.officialPrice') }))] })] }, model.provider + '\u0000' + model.model))), unattributedTokens > 0 && (_jsxs("div", { className: styles.providerCard, children: [_jsxs("div", { className: styles.providerLine, children: [_jsx("span", { className: styles.providerName, children: t('context.unattributed') }), _jsx("span", { className: styles.providerCost, children: formatMoney(providerUsage.unattributedCost, currency) })] }), _jsx("div", { className: styles.providerTokensLine, children: _jsx("span", { className: styles.providerTokens, children: t('context.providerUsage', {
                                                                input: formatTokens(billedInputTokens(providerUsage.unattributed)),
                                                                output: formatTokens(providerUsage.unattributed.outputTokens),
                                                            }) }) })] }))] }), _jsx("p", { className: styles.priceNote, children: t('context.priceNote') })] })), usage !== undefined && usageTotal > 0 && (_jsxs(_Fragment, { children: [_jsx("h3", { className: styles.sectionTitle, children: t('context.tokens') }), _jsxs("div", { className: styles.rows, children: [_jsxs("div", { className: styles.row, children: [_jsx("dt", { children: t('context.usageInput') }), _jsx("dd", { children: formatTokens(billedInputTokens(usage)) })] }), _jsxs("div", { className: styles.row, children: [_jsx("dt", { children: t('context.usageOutput') }), _jsx("dd", { children: formatTokens(usage.outputTokens) })] }), cacheHit !== null && (_jsxs("div", { className: styles.row, children: [_jsx("dt", { children: t('context.cacheHit', { percent: String(cacheHit) }) }), _jsx("dd", { children: formatTokens(usage.cacheReadTokens) })] }))] })] })), !anyData && _jsx("p", { className: styles.empty, children: t('context.noUsage') })] }))] }))] }));
});
