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
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Props supplied by the session header utilities seat plus the locale seat. */
export interface ContextShowMeterProps extends PropsRuntime<'conversation.session.header.utilities'>, PropsLocale<'context-show'> {
}
/**
 * The header utility: ring trigger + toggled draggable panel.
 * @param props - framework kit plus the context-show locale seat.
 * @returns the meter entry, always visible so the panel stays reachable.
 */
export declare const ContextShowMeter: import("react").NamedExoticComponent<ContextShowMeterProps>;
