/**
 * rc.6-compatible settings scope for dsh-context-show.
 *
 * The official settings scope answers "unavailable" for a third-party
 * namespace because the rc.6 host-apiproxy serves only its hard-coded settings
 * allowlist. This wrapper keeps the official scope primary and falls back to a
 * loopback-only bridge controller (over /api/dsh-context-show/settings) when
 * the official scope reports the namespace unavailable. Remote browsers never
 * use the bridge, matching the official process-local policy.
 *
 * @module dsh-context-show/client/bridge-scope
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
/** Options of the compatibility scope wrapper. */
export interface CompatScopeOptions<T> {
    /** Settings namespace the scope serves. */
    namespace: string;
    /** The official settings scope (already bound by the official binder). */
    primary: SettingsScope<T>;
    /** Narrows the wire section; undefined keeps the host seam's value. */
    decode: (section: unknown) => T | undefined;
}
/**
 * Wrap the official settings scope with the bridge fallback. The official
 * scope stays authoritative whenever it serves the namespace; the bridge
 * controller answers only its unavailable state on a loopback browser.
 * @param options - the official scope, the namespace, and the decoder.
 * @returns the compatibility scope implementing the SettingsScope contract.
 */
export declare function createCompatScope<T>(options: CompatScopeOptions<T>): SettingsScope<T>;
