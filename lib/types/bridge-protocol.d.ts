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
export declare const CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX = "/api/dsh-context-show/settings";
/** One path-addressed settings edit, mirroring the official mutate op. */
export interface BridgeSettingsOp {
    /** set stores a value at the path; unset drops the leaf. */
    op: 'set' | 'unset';
    /** Field path inside the namespace section. */
    path: string[];
    /** Value for op set (absent for unset). */
    value?: unknown;
}
/** Wire view of the bridge namespace (mirrors the official apiproxy view). */
export interface BridgeNamespaceView {
    /** The settings namespace name. */
    ns: string;
    /** Current resolved value. */
    value: unknown;
    /** Registrant's composition base layer, when declared. */
    base?: unknown;
    /** Raw user section, when present and well-formed. */
    user?: unknown;
    /** Monotonic revision of the user section this view was read at. */
    revision: number;
}
/** Payload of a successful describe response. */
export interface BridgeDescribeValue {
    /** The namespace view, or null when it is not registered. */
    view: BridgeNamespaceView | null;
    /** Whether the settings document accepts writes. */
    writable: boolean;
}
/** Describe result, shaped like an official RPC result envelope. */
export type BridgeDescribeResult = {
    ok: true;
    value: BridgeDescribeValue;
} | {
    ok: false;
    code: string;
    message: string;
};
/** Mutate request body (one path edit per request, like the official scope). */
export interface BridgeMutateRequest {
    /** The single path edit. */
    op: BridgeSettingsOp;
    /** Revision the caller read; a moved namespace rejects the write. */
    expectedRevision?: number;
}
/** Mutate result: the namespace's fresh view, or a refusal. */
export type BridgeMutateResult = {
    ok: true;
    value: BridgeNamespaceView;
} | {
    ok: false;
    code: string;
    message: string;
};
