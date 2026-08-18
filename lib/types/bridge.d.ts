/**
 * Host-side settings bridge for dsh-context-show.
 *
 * Serves the `context-show` settings namespace over a same-origin,
 * loopback-only HTTP pair because the rc.6 host-apiproxy refuses every
 * third-party namespace at the RPC boundary. The handlers ride the host
 * settings seam (ctx.settings), which keeps the official schema validation,
 * revision fencing, persistence, and event emission for free; the bridge only
 * adds the per-namespace gate the apiproxy normally provides. Error codes
 * mirror the official RPC codes so the client controller treats refusals
 * exactly like an apiproxy answer.
 *
 * @module dsh-context-show/bridge
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { SettingsProvider } from '@deepseek-ai/dsh-settings';
/** Minimal llm-catalog face the bridge needs (satisfied by ctx.llm). */
export interface LlmCatalogFace {
    listProviders(): readonly {
        id: string;
        name: string;
    }[];
    listModels(provider: string): Promise<readonly {
        id: string;
    }[]>;
}
/** Dependencies of the bridge handlers. */
export interface BridgeDeps {
    /** The host settings seam (already injected). */
    settings: SettingsProvider;
    /** The llm catalog seam for auto-detected provider/model routes. */
    llm: LlmCatalogFace;
}
/**
 * Build the loopback-only bridge routes.
 * @param deps - the settings seam and the llm catalog seam.
 * @returns the exact-path route registrations.
 */
export declare function makeBridgeRoutes(deps: BridgeDeps): WebRoute[];
