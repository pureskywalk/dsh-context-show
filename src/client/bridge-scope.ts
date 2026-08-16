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

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX,
  type BridgeDescribeResult,
  type BridgeMutateResult,
  type BridgeNamespaceView,
  type BridgeSettingsOp,
} from '../bridge-protocol.ts'

/** Minimal loopback judgement for the browser (the route re-checks server-side). */
function isLoopbackHost(): boolean {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
}

/**
 * A minimal SettingsScopeController over the bridge HTTP pair. Mirrors the
 * official controller's ordering (serialized queue, revision-fenced writes,
 * recovery read after a refusal) but trusts the host-seam value without
 * re-running the wire-schema validation: the seam already validated it.
 */
class BridgeScopeController<T> implements SettingsScope<T> {
  private readonly store = createSnapshotStore<SettingsScopeSnapshot<T>>({
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
  })
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  /** @param namespace - the bridge namespace this scope serves. */
  /** @param decode - narrows the served section into the card's view. */
  constructor(
    private readonly namespace: string,
    private readonly decode: (section: unknown) => T | undefined,
  ) {}

  // Arrow properties keep the receiver bound, so these are safe to hand to
  // useSyncExternalStore (a class method would lose its receiver).
  getSnapshot = (): SettingsScopeSnapshot<T> => this.store.getSnapshot()
  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

  /** Queue a host refresh through the bridge. */
  load = (): Promise<void> => this.enqueue(() => this.read())

  set = (field: string, value: unknown): Promise<void> => this.enqueue(() => this.write({ op: 'set', path: [field], value }))
  unset = (field: string): Promise<void> => this.enqueue(() => this.write({ op: 'unset', path: [field] }))

  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const task = this.tail.then(async () => {
      if (this.disposed) return
      await operation()
    })
    this.tail = task.catch(() => {})
    return task
  }

  private async read(): Promise<void> {
    let response: BridgeDescribeResult
    try {
      const http = await fetch(CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/describe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!http.ok) {
        this.unavailable()
        return
      }
      response = await http.json() as BridgeDescribeResult
    } catch {
      this.unavailable()
      return
    }
    if (!response.ok) {
      this.unavailable()
      return
    }
    if (response.value.view === null) {
      this.unavailable(response.value.writable)
      return
    }
    this.accept(response.value.view, response.value.writable)
  }

  private async write(op: BridgeSettingsOp): Promise<void> {
    const revision = this.getSnapshot().revision
    let response: BridgeMutateResult
    try {
      const http = await fetch(CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/mutate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, ...(revision === undefined ? {} : { expectedRevision: revision }) }),
      })
      if (!http.ok) {
        await this.read()
        return
      }
      response = await http.json() as BridgeMutateResult
    } catch {
      await this.read()
      return
    }
    if (!response.ok) {
      await this.read()
      return
    }
    this.accept(response.value, undefined)
  }

  private unavailable(writable?: boolean): void {
    this.store.update((draft) => {
      draft.status = 'unavailable'
      if (writable !== undefined) draft.writable = writable
    })
  }

  /** Publish one accepted host view (value narrowed by the decoder). */
  private accept(view: BridgeNamespaceView, writable: boolean | undefined): void {
    const decoded = this.decode(view.value)
    this.store.update((draft) => {
      draft.revision = view.revision
      draft.base = view.base
      draft.user = view.user
      if (writable !== undefined) draft.writable = writable
      if (decoded === undefined) return
      draft.status = 'ready'
      draft.value = decoded
    })
  }
}

/** Options of the compatibility scope wrapper. */
export interface CompatScopeOptions<T> {
  /** Settings namespace the scope serves. */
  namespace: string
  /** The official settings scope (already bound by the official binder). */
  primary: SettingsScope<T>
  /** Narrows the wire section; undefined keeps the host seam's value. */
  decode: (section: unknown) => T | undefined
}

/**
 * Wrap the official settings scope with the bridge fallback. The official
 * scope stays authoritative whenever it serves the namespace; the bridge
 * controller answers only its unavailable state on a loopback browser.
 * @param options - the official scope, the namespace, and the decoder.
 * @returns the compatibility scope implementing the SettingsScope contract.
 */
export function createCompatScope<T>(options: CompatScopeOptions<T>): SettingsScope<T> {
  const fallback = isLoopbackHost() ? new BridgeScopeController<T>(options.namespace, options.decode) : undefined
  const store = createSnapshotStore<SettingsScopeSnapshot<T>>(project())
  let fallbackStarted = false
  const publish = (): void => { store.set(project()) }
  const startFallback = (): void => {
    if (fallback === undefined || fallbackStarted) return
    fallbackStarted = true
    void fallback.load()
  }
  function project(): SettingsScopeSnapshot<T> {
    const primarySnapshot = options.primary.getSnapshot()
    if (primarySnapshot.status === 'ready' || fallback === undefined) return primarySnapshot
    if (primarySnapshot.status === 'loading') return primarySnapshot
    const bridgeSnapshot = fallback.getSnapshot()
    if (bridgeSnapshot.status === 'ready') return bridgeSnapshot
    if (bridgeSnapshot.status === 'loading') return { ...primarySnapshot, status: 'loading' }
    return primarySnapshot
  }
  options.primary.subscribe(() => {
    publish()
    if (options.primary.getSnapshot().status === 'unavailable') startFallback()
  })
  fallback?.subscribe(publish)
  if (options.primary.getSnapshot().status === 'unavailable') startFallback()
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    set: (field, value) => active().set(field, value),
    unset: field => active().unset(field),
  }
  function active(): SettingsScope<T> {
    return options.primary.getSnapshot().status === 'ready' ? options.primary : fallback ?? options.primary
  }
}
