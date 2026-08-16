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
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import { CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX, } from "../bridge-protocol.js";
/** Minimal loopback judgement for the browser (the route re-checks server-side). */
function isLoopbackHost() {
    if (typeof window === 'undefined')
        return false;
    const hostname = window.location.hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}
/**
 * A minimal SettingsScopeController over the bridge HTTP pair. Mirrors the
 * official controller's ordering (serialized queue, revision-fenced writes,
 * recovery read after a refusal) but trusts the host-seam value without
 * re-running the wire-schema validation: the seam already validated it.
 */
class BridgeScopeController {
    namespace;
    decode;
    store = createSnapshotStore({
        status: 'loading',
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
        mode: 'host',
    });
    tail = Promise.resolve();
    disposed = false;
    /** @param namespace - the bridge namespace this scope serves. */
    /** @param decode - narrows the served section into the card's view. */
    constructor(namespace, decode) {
        this.namespace = namespace;
        this.decode = decode;
    }
    // Arrow properties keep the receiver bound, so these are safe to hand to
    // useSyncExternalStore (a class method would lose its receiver).
    getSnapshot = () => this.store.getSnapshot();
    subscribe = (listener) => this.store.subscribe(listener);
    /** Queue a host refresh through the bridge. */
    load = () => this.enqueue(() => this.read());
    set = (field, value) => this.enqueue(() => this.write({ op: 'set', path: [field], value }));
    unset = (field) => this.enqueue(() => this.write({ op: 'unset', path: [field] }));
    enqueue(operation) {
        if (this.disposed)
            return Promise.resolve();
        const task = this.tail.then(async () => {
            if (this.disposed)
                return;
            await operation();
        });
        this.tail = task.catch(() => { });
        return task;
    }
    async read() {
        let response;
        try {
            const http = await fetch(CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/describe', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            if (!http.ok) {
                this.unavailable();
                return;
            }
            response = await http.json();
        }
        catch {
            this.unavailable();
            return;
        }
        if (!response.ok) {
            this.unavailable();
            return;
        }
        if (response.value.view === null) {
            this.unavailable(response.value.writable);
            return;
        }
        this.accept(response.value.view, response.value.writable);
    }
    async write(op) {
        const revision = this.getSnapshot().revision;
        let response;
        try {
            const http = await fetch(CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/mutate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ op, ...(revision === undefined ? {} : { expectedRevision: revision }) }),
            });
            if (!http.ok) {
                await this.read();
                return;
            }
            response = await http.json();
        }
        catch {
            await this.read();
            return;
        }
        if (!response.ok) {
            await this.read();
            return;
        }
        this.accept(response.value, undefined);
    }
    unavailable(writable) {
        this.store.update((draft) => {
            draft.status = 'unavailable';
            if (writable !== undefined)
                draft.writable = writable;
        });
    }
    /** Publish one accepted host view (value narrowed by the decoder). */
    accept(view, writable) {
        const decoded = this.decode(view.value);
        this.store.update((draft) => {
            draft.revision = view.revision;
            draft.base = view.base;
            draft.user = view.user;
            if (writable !== undefined)
                draft.writable = writable;
            if (decoded === undefined)
                return;
            draft.status = 'ready';
            draft.value = decoded;
        });
    }
}
/**
 * Wrap the official settings scope with the bridge fallback. The official
 * scope stays authoritative whenever it serves the namespace; the bridge
 * controller answers only its unavailable state on a loopback browser.
 * @param options - the official scope, the namespace, and the decoder.
 * @returns the compatibility scope implementing the SettingsScope contract.
 */
export function createCompatScope(options) {
    const fallback = isLoopbackHost() ? new BridgeScopeController(options.namespace, options.decode) : undefined;
    const store = createSnapshotStore(project());
    let fallbackStarted = false;
    const publish = () => { store.set(project()); };
    const startFallback = () => {
        if (fallback === undefined || fallbackStarted)
            return;
        fallbackStarted = true;
        void fallback.load();
    };
    function project() {
        const primarySnapshot = options.primary.getSnapshot();
        if (primarySnapshot.status === 'ready' || fallback === undefined)
            return primarySnapshot;
        if (primarySnapshot.status === 'loading')
            return primarySnapshot;
        const bridgeSnapshot = fallback.getSnapshot();
        if (bridgeSnapshot.status === 'ready')
            return bridgeSnapshot;
        if (bridgeSnapshot.status === 'loading')
            return { ...primarySnapshot, status: 'loading' };
        return primarySnapshot;
    }
    options.primary.subscribe(() => {
        publish();
        if (options.primary.getSnapshot().status === 'unavailable')
            startFallback();
    });
    fallback?.subscribe(publish);
    if (options.primary.getSnapshot().status === 'unavailable')
        startFallback();
    return {
        getSnapshot: () => store.getSnapshot(),
        subscribe: listener => store.subscribe(listener),
        set: (field, value) => active().set(field, value),
        unset: field => active().unset(field),
    };
    function active() {
        return options.primary.getSnapshot().status === 'ready' ? options.primary : fallback ?? options.primary;
    }
}
