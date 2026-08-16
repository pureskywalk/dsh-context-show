/**
 * Settings-bridge protocol shared by the host and client halves of
 * dsh-context-show.
 *
 * DSH 0.1.0-rc.6 host-apiproxy serves only its hard-coded settings allowlist
 * (WEB_SETTINGS_NAMESPACES plus product namespaces), so a third-party namespace
 * like `context-show` answers "settings-not-exposed" even though its owner
 * registered it. This bridge re-serves the namespace through the host settings
 * seam over a same-origin, loopback-only HTTP pair. On hosts whose apiproxy
 * already exposes the namespace, the official settings scope stays primary and
 * this bridge never activates.
 *
 * @module dsh-context-show/bridge-protocol
 */
/** Bridge route prefix (same-origin, loopback-only). */
export const CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX = '/api/dsh-context-show/settings';
