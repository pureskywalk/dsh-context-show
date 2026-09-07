window.__ModuleLoader__.load({
	id: "dsh-context-show",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#endregion
		//#region lib/client/bridge-scope.js
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
		/** Minimal loopback judgement for the browser (the route re-checks server-side). */
		function isLoopbackHost() {
			if (typeof window === "undefined") return false;
			const hostname = window.location.hostname;
			return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
		}
		/**
		* A minimal SettingsScopeController over the bridge HTTP pair. Mirrors the
		* official controller's ordering (serialized queue, revision-fenced writes,
		* recovery read after a refusal) but trusts the host-seam value without
		* re-running the wire-schema validation: the seam already validated it.
		*/
		var BridgeScopeController = class {
			namespace;
			decode;
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
				status: "loading",
				value: void 0,
				base: void 0,
				user: void 0,
				revision: void 0,
				writable: false,
				mode: "host"
			});
			tail = Promise.resolve();
			disposed = false;
			/** @param namespace - the bridge namespace this scope serves. */
			/** @param decode - narrows the served section into the card's view. */
			constructor(namespace, decode) {
				this.namespace = namespace;
				this.decode = decode;
			}
			getSnapshot = () => this.store.getSnapshot();
			subscribe = (listener) => this.store.subscribe(listener);
			/** Queue a host refresh through the bridge. */
			load = () => this.enqueue(() => this.read());
			set = (field, value) => this.enqueue(() => this.write({
				op: "set",
				path: [field],
				value
			}));
			unset = (field) => this.enqueue(() => this.write({
				op: "unset",
				path: [field]
			}));
			/** Queue one atomic batch of edits in order (one wire op per request). */
			mutate = (ops, expectedRevision) => {
				let tail = Promise.resolve();
				for (const op of ops) tail = tail.then(() => this.enqueue(() => this.write(op, expectedRevision)));
				return tail;
			};
			enqueue(operation) {
				if (this.disposed) return Promise.resolve();
				const task = this.tail.then(async () => {
					if (this.disposed) return;
					await operation();
				});
				this.tail = task.catch(() => {});
				return task;
			}
			async read() {
				let response;
				try {
					const http = await fetch("/api/dsh-context-show/settings/describe", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: "{}"
					});
					if (!http.ok) {
						this.unavailable();
						return;
					}
					response = await http.json();
				} catch {
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
			async write(op, expectedRevision) {
				const revision = expectedRevision ?? this.getSnapshot().revision;
				let response;
				try {
					const http = await fetch("/api/dsh-context-show/settings/mutate", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							op,
							...revision === void 0 ? {} : { expectedRevision: revision }
						})
					});
					if (!http.ok) {
						await this.read();
						return;
					}
					response = await http.json();
				} catch {
					await this.read();
					return;
				}
				if (!response.ok) {
					await this.read();
					return;
				}
				this.accept(response.value, void 0);
			}
			unavailable(writable) {
				this.store.update((draft) => {
					draft.status = "unavailable";
					if (writable !== void 0) draft.writable = writable;
				});
			}
			/** Publish one accepted host view (value narrowed by the decoder). */
			accept(view, writable) {
				const decoded = this.decode(view.value);
				this.store.update((draft) => {
					draft.revision = view.revision;
					draft.base = view.base;
					draft.user = view.user;
					if (writable !== void 0) draft.writable = writable;
					if (decoded === void 0) return;
					draft.status = "ready";
					draft.value = decoded;
				});
			}
		};
		/**
		* Wrap the official settings scope with the bridge fallback. The official
		* scope stays authoritative whenever it serves the namespace; the bridge
		* controller answers only its unavailable state on a loopback browser.
		* @param options - the official scope, the namespace, and the decoder.
		* @returns the compatibility scope implementing the SettingsScope contract.
		*/
		function createCompatScope(options) {
			const fallback = isLoopbackHost() ? new BridgeScopeController(options.namespace, options.decode) : void 0;
			const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(project());
			let fallbackStarted = false;
			const publish = () => {
				store.set(project());
			};
			const startFallback = () => {
				if (fallback === void 0 || fallbackStarted) return;
				fallbackStarted = true;
				fallback.load();
			};
			function project() {
				const primarySnapshot = options.primary.getSnapshot();
				if (primarySnapshot.status === "ready" || fallback === void 0) return primarySnapshot;
				if (primarySnapshot.status === "loading") return primarySnapshot;
				const bridgeSnapshot = fallback.getSnapshot();
				if (bridgeSnapshot.status === "ready") return bridgeSnapshot;
				if (bridgeSnapshot.status === "loading") return {
					...primarySnapshot,
					status: "loading"
				};
				return primarySnapshot;
			}
			options.primary.subscribe(() => {
				publish();
				if (options.primary.getSnapshot().status === "unavailable") startFallback();
			});
			fallback?.subscribe(publish);
			if (options.primary.getSnapshot().status === "unavailable") startFallback();
			return {
				getSnapshot: () => store.getSnapshot(),
				subscribe: (listener) => store.subscribe(listener),
				set: (field, value) => active().set(field, value),
				unset: (field) => active().unset(field),
				mutate: (ops, expectedRevision) => active().mutate(ops, expectedRevision)
			};
			function active() {
				return options.primary.getSnapshot().status === "ready" ? options.primary : fallback ?? options.primary;
			}
		}
		//#endregion
		//#region lib/client/estimate.js
		/**
		* Client-side heuristic pricing of conversation snapshot nodes for the
		* "tool usage" list.
		*
		* The estimator mirrors the token-meter fixed-density heuristic
		* (`estimate.ts`: 4 chars per token, 4 block overhead, 4 role overhead) so
		* the per-node figures stay in the same unit as the `contextBreakdown`
		* message figure. Tool-result nodes are aggregated by tool name — the panel
		* answers "which tools occupy the context" without exposing raw content.
		*
		* @module dsh-context-show/estimate
		*/
		/** Fixed text-density estimate used until exact tokenization is needed. */
		const CHARS_PER_TOKEN = 4;
		/** Per-block structural overhead for JSON framing and type tags. */
		const BLOCK_OVERHEAD = 4;
		/** Role-field framing overhead added to every priced message. */
		const ROLE_OVERHEAD = 4;
		/**
		* Price content blocks recursively under the fixed density heuristic.
		* @param blocks - content blocks to price without mutation.
		* @returns heuristic tokens including per-block structural overhead.
		*/
		function estimateContentTokens(blocks) {
			let tokens = 0;
			for (const block of blocks) switch (block.type) {
				case "text":
				case "reasoning":
					tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
					break;
				case "tool-call":
					tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN) + Math.ceil(block.arguments.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
					break;
				case "tool-result":
					tokens += estimateContentTokens(block.content) + BLOCK_OVERHEAD;
					break;
				default: tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
			}
			return tokens;
		}
		/**
		* Price the UI-classified assistant block list (mirrors estimateContentTokens
		* over the snapshot's AssistantBlock shape).
		* @param blocks - assistant blocks to price without mutation.
		* @returns heuristic tokens including per-block structural overhead.
		*/
		function estimateAssistantBlocks(blocks) {
			let tokens = 0;
			for (const block of blocks) switch (block.kind) {
				case "text":
				case "reasoning":
					tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
					break;
				case "tool-call":
					tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN) + Math.ceil(block.argsRaw.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
					break;
				default: tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
			}
			return tokens;
		}
		/**
		* Price one conversation snapshot node.
		* @param node - snapshot node to price without mutation.
		* @returns heuristic tokens including role framing; 0 for non-message nodes.
		*/
		function estimateNodeTokens(node) {
			switch (node.kind) {
				case "user":
				case "context": return estimateContentTokens(node.content) + ROLE_OVERHEAD;
				case "assistant": return estimateAssistantBlocks(node.blocks) + ROLE_OVERHEAD;
				case "tool-result": return estimateContentTokens(node.content) + ROLE_OVERHEAD;
				default: return 0;
			}
		}
		/**
		* Aggregate the conversation's tool results by tool name.
		* @param nodes - snapshot nodes in render order.
		* @param limit - how many rows to keep (default 6).
		* @returns rows sorted by descending tokens, then name.
		*/
		function toolUsage(nodes, limit = 6) {
			const byName = /* @__PURE__ */ new Map();
			for (const node of nodes) {
				if (node.kind !== "tool-result") continue;
				const name = node.call?.name ?? node.callId;
				const tokens = estimateNodeTokens(node);
				const entry = byName.get(name) ?? {
					calls: 0,
					tokens: 0
				};
				entry.calls += 1;
				entry.tokens += tokens;
				byName.set(name, entry);
			}
			return [...byName.entries()].map(([name, value]) => ({
				name,
				calls: value.calls,
				tokens: value.tokens
			})).sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name)).slice(0, limit);
		}
		//#endregion
		//#region lib/client/formats.js
		/**
		* Display formatting helpers for the context-show panel.
		*
		* @module dsh-context-show/formats
		*/
		/**
		* Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three
		* digits), mirroring the shipped conversation stats line.
		* @param n - token count.
		* @returns display string.
		*/
		function formatTokens(n) {
			const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
			if (n < 1e3) return String(n);
			if (n < 1e6) return scaled(n / 1e3) + "K";
			return scaled(n / 1e6) + "M";
		}
		/** Billed prompt-side input: the three disjoint input buckets summed. */
		function billedInputTokens(usage) {
			return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
		}
		/** Whole-request cost of one usage bucket set: billed input plus output. */
		function totalTokensOf(usage) {
			return billedInputTokens(usage) + usage.outputTokens;
		}
		/**
		* Cache-hit share of billed prompt-side input.
		* @param usage - token-usage buckets.
		* @returns rounded integer percent, or null when no input was billed.
		*/
		function cacheHitPercent(usage) {
			const billed = billedInputTokens(usage);
			return billed === 0 ? null : Math.round(usage.cacheReadTokens / billed * 100);
		}
		/** Drop trailing zeros of a decimal string, and a trailing decimal point. */
		function trimZeros(value) {
			if (!value.includes(".")) return value;
			return value.replace(/0+$/, "").replace(/\.$/, "");
		}
		/** Currency symbol of well-known ISO 4217 codes; falls back to the code. */
		function currencySymbol(currency) {
			switch (currency.toUpperCase()) {
				case "CNY":
				case "CNH": return "¥";
				case "USD": return "$";
				case "EUR": return "€";
				case "GBP": return "£";
				case "JPY": return "¥";
				default: return currency.toUpperCase() + " ";
			}
		}
		/**
		* Compact money amount: ¥0.0042, ¥0.42, ¥12.3, ¥1,234 (no trailing zeros).
		* @param value - cost in the configured currency.
		* @param currency - ISO 4217-style currency code.
		* @returns display string.
		*/
		function formatMoney(value, currency) {
			const symbol = currencySymbol(currency);
			if (!Number.isFinite(value)) return symbol + "—";
			if (value === 0) return symbol + "0";
			if (value < 1e-4) return "<" + symbol + "0.0001";
			if (value < .01) return symbol + trimZeros(value.toPrecision(2));
			if (value < 100) return symbol + trimZeros(value.toFixed(2));
			return symbol + Math.round(value).toLocaleString("en-US");
		}
		//#endregion
		//#region \0dsh-css:D:\桌面\test\DSHarness\plugins\dsh-context-show\src\client\ContextShowMeter.module.css.mjs
		const css$1 = ".I94Una_root{display:inline-flex;position:relative}.I94Una_trigger{height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:999px;align-items:center;gap:4px;padding:0 8px;font-size:12px;line-height:20px;display:inline-flex}.I94Una_trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}.I94Una_trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.I94Una_ringTrack{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}.I94Una_ringLow{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:2px;stroke-linecap:round}.I94Una_ringMid{fill:none;stroke:#f59e0b;stroke-width:2px;stroke-linecap:round}.I94Una_ringHigh{fill:none;stroke:#ef4444;stroke-width:2px;stroke-linecap:round}.I94Una_triggerText{font-variant-numeric:tabular-nums}.I94Una_panel{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:340px;max-height:min(75vh,520px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);cursor:default;border-radius:12px;padding:10px 12px 12px;font-size:12px;line-height:20px;position:absolute;top:calc(100% + 8px);right:0;overflow-y:auto}.I94Una_panelHeader{align-items:center;gap:4px;display:flex}.I94Una_dragHandle{width:22px;height:22px;color:var(--dsw-alias-label-tertiary);cursor:grab;touch-action:none;background:0 0;border:none;border-radius:6px;flex:none;place-items:center;padding:0;display:grid}.I94Una_dragHandle:hover{background:var(--dsw-alias-interactive-bg-hover)}.I94Una_dragHandle:active{cursor:grabbing}.I94Una_dragHandle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.I94Una_headline{min-width:0;color:var(--dsw-alias-label-tertiary);flex:1}.I94Una_iconButton{width:22px;height:22px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;place-items:center;padding:0;font-size:11px;line-height:1;display:grid}.I94Una_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.I94Una_iconButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.I94Una_keyFigures{justify-content:space-between;align-items:baseline;gap:12px;margin-top:2px;display:flex}.I94Una_figures{text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;min-width:0;color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden}.I94Una_costInline{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);flex:none;font-weight:600}.I94Una_bar{background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;gap:1px;height:4px;margin:10px 0 12px;display:flex;overflow:hidden}.I94Una_segment{background:var(--meter-tint,var(--dsw-alias-label-tertiary));border-radius:1px;flex:none;min-width:2px;height:100%}.I94Una_swatch{vertical-align:baseline;background:var(--meter-tint);border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block}.I94Una_colorSystem{--meter-tint:var(--dsw-static-neutral-bluish-400)}.I94Una_colorTools{--meter-tint:#a78bfa}.I94Una_colorMessages{--meter-tint:var(--dsw-static-blue-450)}.I94Una_rows{margin:6px 0 0}.I94Una_row{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}.I94Una_row dt{min-width:0;color:var(--dsw-alias-label-secondary);align-items:center;display:flex}.I94Una_row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);flex:none;margin:0}.I94Una_sectionTitle{color:var(--dsw-alias-label-tertiary);align-items:baseline;gap:8px;margin:12px 0 4px;font-size:12px;font-weight:500;line-height:20px;display:flex}.I94Una_sectionHint{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));font-weight:400}.I94Una_compactTools{flex-wrap:wrap;align-items:center;gap:2px 6px;margin-top:6px;display:flex}.I94Una_compactToolsLabel{color:var(--dsw-alias-label-tertiary);flex:none}.I94Una_compactTool{align-items:baseline;gap:4px;min-width:0;display:inline-flex}.I94Una_compactSep{color:var(--dsw-alias-separator-primary);margin-right:6px}.I94Una_compactToolName{text-overflow:ellipsis;white-space:nowrap;max-width:140px;color:var(--dsw-alias-label-primary);overflow:hidden}.I94Una_compactToolMeta{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);flex:none}.I94Una_toolHeader{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));align-items:center;gap:8px;padding:2px 0;font-size:12px;line-height:18px;display:flex}.I94Una_toolHeader .I94Una_toolName{flex:1}.I94Una_toolHeader .I94Una_toolCalls,.I94Una_toolHeader .I94Una_toolTokens{min-width:56px}.I94Una_toolList{margin:0;padding:0;list-style:none}.I94Una_toolRow{align-items:center;gap:8px;padding:2px 0;font-size:12px;line-height:18px;display:flex}.I94Una_toolName{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);flex:1;overflow:hidden}.I94Una_toolCalls{font-variant-numeric:tabular-nums;min-width:56px;color:var(--dsw-alias-label-tertiary);flex:none}.I94Una_toolTokens{text-align:right;font-variant-numeric:tabular-nums;min-width:56px;color:var(--dsw-alias-label-tertiary);flex:none}.I94Una_providerList{margin:6px 0 0}.I94Una_providerCard{border-bottom:1px solid var(--dsw-alias-border-l2);padding:6px 0}.I94Una_providerCard:last-child{border-bottom:none}.I94Una_providerLine{align-items:center;gap:6px;min-width:0;display:flex}.I94Una_providerName{color:var(--dsw-alias-label-primary);flex:none;font-weight:500}.I94Una_providerModel{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:1;overflow:hidden}.I94Una_providerCost{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);flex:none;margin-left:auto;font-weight:500}.I94Una_providerTokensLine{justify-content:space-between;align-items:center;gap:8px;margin-top:2px;display:flex}.I94Una_providerTokens{font-variant-numeric:tabular-nums;min-width:0;color:var(--dsw-alias-label-tertiary)}.I94Una_priceLink{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary));flex:none;text-decoration:none}.I94Una_priceLink:hover{text-decoration:underline}.I94Una_priceNote{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));margin:6px 0 0}.I94Una_empty{color:var(--dsw-alias-label-tertiary);margin:8px 0 4px}";
		const tagId$1 = "dsh-context-show/ContextShowMeter.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-context-show";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var ContextShowMeter_module_css_default = {
			"colorSystem": "I94Una_colorSystem",
			"bar": "I94Una_bar",
			"root": "I94Una_root",
			"iconButton": "I94Una_iconButton",
			"ringMid": "I94Una_ringMid",
			"ringHigh": "I94Una_ringHigh",
			"colorTools": "I94Una_colorTools",
			"rows": "I94Una_rows",
			"providerCost": "I94Una_providerCost",
			"row": "I94Una_row",
			"sectionTitle": "I94Una_sectionTitle",
			"compactTools": "I94Una_compactTools",
			"priceNote": "I94Una_priceNote",
			"empty": "I94Una_empty",
			"providerTokens": "I94Una_providerTokens",
			"ringLow": "I94Una_ringLow",
			"compactToolsLabel": "I94Una_compactToolsLabel",
			"compactToolMeta": "I94Una_compactToolMeta",
			"toolHeader": "I94Una_toolHeader",
			"toolRow": "I94Una_toolRow",
			"toolCalls": "I94Una_toolCalls",
			"panel": "I94Una_panel",
			"toolName": "I94Una_toolName",
			"keyFigures": "I94Una_keyFigures",
			"compactTool": "I94Una_compactTool",
			"providerTokensLine": "I94Una_providerTokensLine",
			"compactToolName": "I94Una_compactToolName",
			"ringTrack": "I94Una_ringTrack",
			"figures": "I94Una_figures",
			"providerList": "I94Una_providerList",
			"panelHeader": "I94Una_panelHeader",
			"providerCard": "I94Una_providerCard",
			"providerName": "I94Una_providerName",
			"headline": "I94Una_headline",
			"priceLink": "I94Una_priceLink",
			"triggerText": "I94Una_triggerText",
			"trigger": "I94Una_trigger",
			"segment": "I94Una_segment",
			"providerLine": "I94Una_providerLine",
			"sectionHint": "I94Una_sectionHint",
			"toolTokens": "I94Una_toolTokens",
			"providerModel": "I94Una_providerModel",
			"colorMessages": "I94Una_colorMessages",
			"swatch": "I94Una_swatch",
			"toolList": "I94Una_toolList",
			"compactSep": "I94Una_compactSep",
			"dragHandle": "I94Una_dragHandle",
			"costInline": "I94Una_costInline"
		};
		//#endregion
		//#region lib/client/ContextShowMeter.js
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
			{
				key: "systemTokens",
				label: "context.system",
				color: ContextShowMeter_module_css_default.colorSystem ?? ""
			},
			{
				key: "toolsTokens",
				label: "context.tools",
				color: ContextShowMeter_module_css_default.colorTools ?? ""
			},
			{
				key: "messageTokens",
				label: "context.messages",
				color: ContextShowMeter_module_css_default.colorMessages ?? ""
			}
		];
		/** Occupancy ring fill severity by used share. */
		function ringTone(percent) {
			if (percent >= 90) return ContextShowMeter_module_css_default.ringHigh ?? "";
			if (percent >= 70) return ContextShowMeter_module_css_default.ringMid ?? "";
			return ContextShowMeter_module_css_default.ringLow ?? "";
		}
		/** Approximate occupancy with its numerator and denominator, or null. */
		function contextOccupancy(pressure) {
			const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
			if (usedTokens === void 0 || pressure?.contextWindow === void 0) return null;
			return {
				percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
				usedTokens,
				contextWindow: pressure.contextWindow
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
		const ContextShowMeter = (0, react.memo)(function ContextShowMeter(props) {
			const { useChat, useProjection, t } = props;
			const nodes = useChat((snapshot) => snapshot.legacy.nodes);
			const pressure = useProjection("contextPressure");
			const breakdown = useProjection("contextBreakdown");
			const usage = useProjection("tokenUsage");
			const providerUsage = useProjection("contextUsage");
			const [open, setOpen] = (0, react.useState)(false);
			const [detail, setDetail] = (0, react.useState)(false);
			const [position, setPosition] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const dragRef = (0, react.useRef)(null);
			const occupancy = contextOccupancy(pressure);
			const toolRows = (0, react.useMemo)(() => toolUsage(nodes, TOP_TOOLS), [nodes]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			const startDrag = (event) => {
				const panel = panelRef.current;
				if (panel === null) return;
				event.preventDefault();
				const rect = panel.getBoundingClientRect();
				dragRef.current = {
					pointerId: event.pointerId,
					offsetX: event.clientX - rect.left,
					offsetY: event.clientY - rect.top
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			};
			const moveDrag = (event) => {
				const drag = dragRef.current;
				if (drag === null || drag.pointerId !== event.pointerId) return;
				setPosition({
					left: clampDrag(event.clientX - drag.offsetX, window.innerWidth),
					top: clampDrag(event.clientY - drag.offsetY, window.innerHeight)
				});
			};
			const endDrag = (event) => {
				if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
			};
			const compositionTotal = breakdown === void 0 ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
			const usageTotal = usage === void 0 ? 0 : totalTokensOf(usage);
			const cacheHit = usage === void 0 ? null : cacheHitPercent(usage);
			const segments = breakdown === void 0 || compositionTotal === 0 ? occupancy === null ? [] : [{
				key: "total",
				color: "",
				width: occupancy.percent
			}] : COMPOSITION_ROWS.map((row) => ({
				key: row.key,
				color: row.color,
				width: occupancy === null ? 0 : occupancy.percent * breakdown[row.key] / compositionTotal
			})).filter((segment) => segment.width > 0);
			const unattributedTokens = providerUsage === void 0 ? 0 : totalTokensOf(providerUsage.unattributed);
			const hasProviderRows = providerUsage !== void 0 && (providerUsage.providers.length > 0 || unattributedTokens > 0);
			const totalCost = providerUsage?.totalCost ?? 0;
			const peakLabel = providerUsage?.peakHours === void 0 || providerUsage.peakHours.length === 0 ? null : providerUsage.peakHours.map((range) => range.start + "-" + range.end).join("、");
			const triggerLabel = occupancy === null ? usageTotal > 0 ? t("context.usageTotal", { total: formatTokens(usageTotal) }) : "—" : t("context.occupancySummary", {
				percent: String(occupancy.percent),
				used: formatTokens(occupancy.usedTokens),
				window: formatTokens(occupancy.contextWindow)
			});
			const triggerPercent = occupancy === null ? null : occupancy.percent;
			const anyData = occupancy !== null || compositionTotal > 0 || toolRows.length > 0 || usageTotal > 0 || totalCost > 0;
			const modelsByCost = providerUsage === void 0 ? [] : [...providerUsage.providers].sort((left, right) => right.cost - left.cost);
			const currency = providerUsage?.currency ?? "CNY";
			return (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: ContextShowMeter_module_css_default.root,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ContextShowMeter_module_css_default.trigger,
					"aria-label": t("context.toggle"),
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					title: triggerLabel,
					onClick: () => {
						setOpen(!open);
					},
					children: [(0, react_jsx_runtime.jsxs)("svg", {
						viewBox: "0 0 14 14",
						width: "14",
						height: "14",
						"aria-hidden": "true",
						children: [(0, react_jsx_runtime.jsx)("circle", {
							className: ContextShowMeter_module_css_default.ringTrack,
							cx: "7",
							cy: "7",
							r: RING_RADIUS
						}), triggerPercent !== null && (0, react_jsx_runtime.jsx)("circle", {
							className: ringTone(triggerPercent),
							cx: "7",
							cy: "7",
							r: RING_RADIUS,
							strokeDasharray: `${RING_CIRCUMFERENCE * triggerPercent / 100} ${RING_CIRCUMFERENCE}`,
							transform: "rotate(-90 7 7)"
						})]
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ContextShowMeter_module_css_default.triggerText,
						children: triggerPercent === null ? "·" : triggerPercent + "%"
					})]
				}), open && (0, react_jsx_runtime.jsxs)("div", {
					className: ContextShowMeter_module_css_default.panel,
					ref: panelRef,
					role: "dialog",
					"aria-label": t("context.occupancy"),
					style: position === null ? void 0 : {
						position: "fixed",
						left: position.left + "px",
						top: position.top + "px",
						right: "auto",
						bottom: "auto",
						margin: 0
					},
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: ContextShowMeter_module_css_default.panelHeader,
							children: [
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ContextShowMeter_module_css_default.dragHandle,
									"aria-label": t("context.drag"),
									title: t("context.drag"),
									onPointerDown: startDrag,
									onPointerMove: moveDrag,
									onPointerUp: endDrag,
									onPointerCancel: endDrag,
									children: (0, react_jsx_runtime.jsxs)("svg", {
										viewBox: "0 0 8 12",
										width: "8",
										height: "12",
										"aria-hidden": "true",
										children: [
											(0, react_jsx_runtime.jsx)("circle", {
												cx: "2",
												cy: "2",
												r: "1.1"
											}),
											(0, react_jsx_runtime.jsx)("circle", {
												cx: "6",
												cy: "2",
												r: "1.1"
											}),
											(0, react_jsx_runtime.jsx)("circle", {
												cx: "2",
												cy: "6",
												r: "1.1"
											}),
											(0, react_jsx_runtime.jsx)("circle", {
												cx: "6",
												cy: "6",
												r: "1.1"
											}),
											(0, react_jsx_runtime.jsx)("circle", {
												cx: "2",
												cy: "10",
												r: "1.1"
											}),
											(0, react_jsx_runtime.jsx)("circle", {
												cx: "6",
												cy: "10",
												r: "1.1"
											})
										]
									})
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextShowMeter_module_css_default.headline,
									children: t("context.occupancy")
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ContextShowMeter_module_css_default.iconButton,
									"aria-label": detail ? t("context.compactMode") : t("context.detailMode"),
									title: detail ? t("context.compactMode") : t("context.detailMode"),
									onClick: () => {
										setDetail(!detail);
									},
									children: detail ? "▴" : "▾"
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ContextShowMeter_module_css_default.iconButton,
									"aria-label": t("context.close"),
									title: t("context.close"),
									onClick: () => {
										setOpen(false);
									},
									children: "✕"
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: ContextShowMeter_module_css_default.keyFigures,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ContextShowMeter_module_css_default.figures,
								children: occupancy !== null ? t("context.occupancySummary", {
									percent: String(occupancy.percent),
									used: formatTokens(occupancy.usedTokens),
									window: formatTokens(occupancy.contextWindow)
								}) : usageTotal > 0 ? t("context.usageTotal", { total: formatTokens(usageTotal) }) : "—"
							}), hasProviderRows && providerUsage !== void 0 && (0, react_jsx_runtime.jsx)("span", {
								className: ContextShowMeter_module_css_default.costInline,
								children: formatMoney(totalCost, providerUsage.currency)
							})]
						}),
						!detail ? (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: !anyData && (0, react_jsx_runtime.jsx)("p", {
							className: ContextShowMeter_module_css_default.empty,
							children: t("context.noUsage")
						}) }) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							segments.length > 0 && (0, react_jsx_runtime.jsx)("div", {
								className: ContextShowMeter_module_css_default.bar,
								role: "img",
								"aria-label": breakdown === void 0 ? triggerLabel : t("context.composition"),
								children: segments.map((segment) => (0, react_jsx_runtime.jsx)("span", {
									className: segment.color === "" ? ContextShowMeter_module_css_default.segment : ContextShowMeter_module_css_default.segment + " " + segment.color,
									style: { width: segment.width + "%" }
								}, segment.key))
							}),
							breakdown !== void 0 && compositionTotal > 0 && (0, react_jsx_runtime.jsx)("div", {
								className: ContextShowMeter_module_css_default.rows,
								children: COMPOSITION_ROWS.map((row) => (0, react_jsx_runtime.jsxs)("div", {
									className: ContextShowMeter_module_css_default.row,
									children: [(0, react_jsx_runtime.jsxs)("dt", { children: [(0, react_jsx_runtime.jsx)("span", {
										className: ContextShowMeter_module_css_default.swatch + " " + row.color,
										"aria-hidden": "true"
									}), t(row.label)] }), (0, react_jsx_runtime.jsxs)("dd", { children: ["≈", formatTokens(breakdown[row.key])] })]
								}, row.key))
							}),
							toolRows.length > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								(0, react_jsx_runtime.jsx)("h3", {
									className: ContextShowMeter_module_css_default.sectionTitle,
									children: t("context.toolUsage")
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: ContextShowMeter_module_css_default.toolHeader,
									"aria-hidden": "true",
									children: [
										(0, react_jsx_runtime.jsx)("span", {
											className: ContextShowMeter_module_css_default.toolName,
											children: t("context.toolHeader")
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: ContextShowMeter_module_css_default.toolCalls,
											children: t("context.callsHeader")
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: ContextShowMeter_module_css_default.toolTokens,
											children: t("context.tokensHeader")
										})
									]
								}),
								(0, react_jsx_runtime.jsx)("ul", {
									className: ContextShowMeter_module_css_default.toolList,
									children: toolRows.map((tool) => (0, react_jsx_runtime.jsxs)("li", {
										className: ContextShowMeter_module_css_default.toolRow,
										children: [
											(0, react_jsx_runtime.jsx)("span", {
												className: ContextShowMeter_module_css_default.toolName,
												title: tool.name,
												children: tool.name
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: ContextShowMeter_module_css_default.toolCalls,
												children: t("context.toolCalls", { calls: String(tool.calls) })
											}),
											(0, react_jsx_runtime.jsxs)("span", {
												className: ContextShowMeter_module_css_default.toolTokens,
												title: t("context.tokensHint"),
												children: ["≈", formatTokens(tool.tokens)]
											})
										]
									}, tool.name))
								})
							] }),
							hasProviderRows && providerUsage !== void 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								(0, react_jsx_runtime.jsxs)("h3", {
									className: ContextShowMeter_module_css_default.sectionTitle,
									children: [t("context.cost"), (0, react_jsx_runtime.jsxs)("span", {
										className: ContextShowMeter_module_css_default.sectionHint,
										children: [t("context.costEstimated"), peakLabel !== null && providerUsage.timeZone !== void 0 && " · " + t("context.peakHours", {
											hours: peakLabel,
											timeZone: providerUsage.timeZone
										})]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: ContextShowMeter_module_css_default.providerList,
									children: [modelsByCost.map((model) => (0, react_jsx_runtime.jsxs)("div", {
										className: ContextShowMeter_module_css_default.providerCard,
										children: [(0, react_jsx_runtime.jsxs)("div", {
											className: ContextShowMeter_module_css_default.providerLine,
											children: [
												(0, react_jsx_runtime.jsx)("span", {
													className: ContextShowMeter_module_css_default.providerName,
													children: model.model
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: ContextShowMeter_module_css_default.providerModel,
													children: model.provider
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: ContextShowMeter_module_css_default.providerCost,
													children: formatMoney(model.cost, currency)
												})
											]
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: ContextShowMeter_module_css_default.providerTokensLine,
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: ContextShowMeter_module_css_default.providerTokens,
												children: t("context.providerUsage", {
													input: formatTokens(billedInputTokens(model)),
													output: formatTokens(model.outputTokens)
												})
											}), model.priceUrl !== void 0 && (0, react_jsx_runtime.jsx)("a", {
												className: ContextShowMeter_module_css_default.priceLink,
												href: model.priceUrl,
												target: "_blank",
												rel: "noreferrer",
												onClick: (event) => {
													event.stopPropagation();
												},
												children: t("context.officialPrice")
											})]
										})]
									}, model.provider + "\0" + model.model)), unattributedTokens > 0 && (0, react_jsx_runtime.jsxs)("div", {
										className: ContextShowMeter_module_css_default.providerCard,
										children: [(0, react_jsx_runtime.jsxs)("div", {
											className: ContextShowMeter_module_css_default.providerLine,
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: ContextShowMeter_module_css_default.providerName,
												children: t("context.unattributed")
											}), (0, react_jsx_runtime.jsx)("span", {
												className: ContextShowMeter_module_css_default.providerCost,
												children: formatMoney(providerUsage.unattributedCost, currency)
											})]
										}), (0, react_jsx_runtime.jsx)("div", {
											className: ContextShowMeter_module_css_default.providerTokensLine,
											children: (0, react_jsx_runtime.jsx)("span", {
												className: ContextShowMeter_module_css_default.providerTokens,
												children: t("context.providerUsage", {
													input: formatTokens(billedInputTokens(providerUsage.unattributed)),
													output: formatTokens(providerUsage.unattributed.outputTokens)
												})
											})
										})]
									})]
								}),
								(0, react_jsx_runtime.jsx)("p", {
									className: ContextShowMeter_module_css_default.priceNote,
									children: t("context.priceNote")
								})
							] }),
							usage !== void 0 && usageTotal > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("h3", {
								className: ContextShowMeter_module_css_default.sectionTitle,
								children: t("context.tokens")
							}), (0, react_jsx_runtime.jsxs)("div", {
								className: ContextShowMeter_module_css_default.rows,
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: ContextShowMeter_module_css_default.row,
										children: [(0, react_jsx_runtime.jsx)("dt", { children: t("context.usageInput") }), (0, react_jsx_runtime.jsx)("dd", { children: formatTokens(billedInputTokens(usage)) })]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: ContextShowMeter_module_css_default.row,
										children: [(0, react_jsx_runtime.jsx)("dt", { children: t("context.usageOutput") }), (0, react_jsx_runtime.jsx)("dd", { children: formatTokens(usage.outputTokens) })]
									}),
									cacheHit !== null && (0, react_jsx_runtime.jsxs)("div", {
										className: ContextShowMeter_module_css_default.row,
										children: [(0, react_jsx_runtime.jsx)("dt", { children: t("context.cacheHit", { percent: String(cacheHit) }) }), (0, react_jsx_runtime.jsx)("dd", { children: formatTokens(usage.cacheReadTokens) })]
									})
								]
							})] }),
							!anyData && (0, react_jsx_runtime.jsx)("p", {
								className: ContextShowMeter_module_css_default.empty,
								children: t("context.noUsage")
							})
						] })
					]
				})]
			});
		});
		//#endregion
		//#region \0dsh-css:D:\桌面\test\DSHarness\plugins\dsh-context-show\src\client\ContextShowSettings.module.css.mjs
		const css = ".vHIQ6a_root{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;max-width:560px;transition:border-color .16s,background .16s;display:flex}.vHIQ6a_root:hover{border-color:var(--dsw-alias-label-dimmed)}.vHIQ6a_rootOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.vHIQ6a_header{appearance:none;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;width:100%;padding:14px 16px;display:flex}.vHIQ6a_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.vHIQ6a_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.vHIQ6a_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.vHIQ6a_chevronOpen{transform:rotate(180deg)}.vHIQ6a_body{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:10px;margin:0 16px;padding:12px 0;display:flex}.vHIQ6a_cardTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:1.4}.vHIQ6a_cardDesc{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:1.5}.vHIQ6a_fieldRow{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.vHIQ6a_fieldRowWide{flex-direction:column;gap:4px;width:100%;display:flex}.vHIQ6a_fieldLabel{min-width:120px;color:var(--dsw-alias-label-secondary);flex:none;font-size:13px}.vHIQ6a_fieldHint{color:var(--dsw-alias-label-tertiary);font-size:12px}.vHIQ6a_textInput,.vHIQ6a_selectInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);min-width:180px;color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:13px;line-height:20px}.vHIQ6a_textInput:focus,.vHIQ6a_selectInput:focus,.vHIQ6a_numberInput:focus,.vHIQ6a_numberInputSmall:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:0}.vHIQ6a_checkboxInput{width:16px;height:16px;accent-color:var(--dsw-alias-state-business-primary)}.vHIQ6a_rangeRow{align-items:center;gap:6px;display:inline-flex}.vHIQ6a_rangeLabel{color:var(--dsw-alias-label-tertiary);min-width:84px;font-size:12px}.vHIQ6a_rangeSep{color:var(--dsw-alias-label-tertiary)}.vHIQ6a_numberInputSmall{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:64px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;border-radius:6px;padding:3px 6px;font-size:13px}.vHIQ6a_sectionTitle{color:var(--dsw-alias-label-primary);margin:4px 0 0;font-size:13px;font-weight:600;line-height:20px}.vHIQ6a_priceTable{border-collapse:collapse;width:100%}.vHIQ6a_priceTable th{text-align:left;color:var(--dsw-alias-label-tertiary);padding:4px 8px;font-size:12px;font-weight:500}.vHIQ6a_priceTable td{padding:4px 8px}.vHIQ6a_priceFieldHead{width:45%}.vHIQ6a_priceValueHead{width:27.5%}.vHIQ6a_priceFieldCell{color:var(--dsw-alias-label-secondary);font-size:13px}.vHIQ6a_priceValueCell{text-align:left}.vHIQ6a_numberInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:110px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;border-radius:6px;padding:4px 8px;font-size:13px}.vHIQ6a_entryCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);border-radius:8px;padding:8px}.vHIQ6a_entryHeader{align-items:center;gap:8px;margin-bottom:4px;display:flex}.vHIQ6a_entryHeader .vHIQ6a_textInput{flex:1;min-width:0}.vHIQ6a_removeButton{width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;padding:0}.vHIQ6a_removeButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.vHIQ6a_addButton{border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:6px;align-self:flex-start;padding:4px 12px;font-size:13px}.vHIQ6a_addButton:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.vHIQ6a_note{color:var(--dsw-alias-label-tertiary);margin:2px 0;font-size:12px}.vHIQ6a_footer{gap:8px;margin-top:4px;display:flex}.vHIQ6a_primaryButton,.vHIQ6a_secondaryButton{cursor:pointer;border-radius:8px;padding:6px 16px;font-size:13px}.vHIQ6a_primaryButton{background:var(--dsw-alias-state-business-primary);color:#fff;border:none}.vHIQ6a_primaryButton:hover:not(:disabled){opacity:.9}.vHIQ6a_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.vHIQ6a_secondaryButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.vHIQ6a_primaryButton:disabled,.vHIQ6a_secondaryButton:disabled{opacity:.5;cursor:default}.vHIQ6a_empty{color:var(--dsw-alias-label-tertiary);font-size:13px}";
		const tagId = "dsh-context-show/ContextShowSettings.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-context-show";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ContextShowSettings_module_css_default = {
			"numberInput": "vHIQ6a_numberInput",
			"entryCard": "vHIQ6a_entryCard",
			"sectionTitle": "vHIQ6a_sectionTitle",
			"body": "vHIQ6a_body",
			"chevron": "vHIQ6a_chevron",
			"cardTitle": "vHIQ6a_cardTitle",
			"numberInputSmall": "vHIQ6a_numberInputSmall",
			"fieldLabel": "vHIQ6a_fieldLabel",
			"rootOpen": "vHIQ6a_rootOpen",
			"header": "vHIQ6a_header",
			"textInput": "vHIQ6a_textInput",
			"note": "vHIQ6a_note",
			"priceFieldHead": "vHIQ6a_priceFieldHead",
			"priceFieldCell": "vHIQ6a_priceFieldCell",
			"rangeSep": "vHIQ6a_rangeSep",
			"entryHeader": "vHIQ6a_entryHeader",
			"secondaryButton": "vHIQ6a_secondaryButton",
			"priceTable": "vHIQ6a_priceTable",
			"rangeLabel": "vHIQ6a_rangeLabel",
			"priceValueCell": "vHIQ6a_priceValueCell",
			"priceValueHead": "vHIQ6a_priceValueHead",
			"primaryButton": "vHIQ6a_primaryButton",
			"cardDesc": "vHIQ6a_cardDesc",
			"addButton": "vHIQ6a_addButton",
			"headText": "vHIQ6a_headText",
			"fieldRow": "vHIQ6a_fieldRow",
			"chevronOpen": "vHIQ6a_chevronOpen",
			"rangeRow": "vHIQ6a_rangeRow",
			"fieldRowWide": "vHIQ6a_fieldRowWide",
			"root": "vHIQ6a_root",
			"removeButton": "vHIQ6a_removeButton",
			"footer": "vHIQ6a_footer",
			"fieldHint": "vHIQ6a_fieldHint",
			"checkboxInput": "vHIQ6a_checkboxInput",
			"empty": "vHIQ6a_empty",
			"selectInput": "vHIQ6a_selectInput"
		};
		//#endregion
		//#region lib/client/ContextShowSettings.js
		/**
		* The context-show settings page: edit the pricing table (currency, flat or
		* peak / off-peak rates per provider/model, peak-hour windows) through the
		* `context-show` settings namespace. Committed changes re-register the host
		* projection with the new pricing spec, so the panel's cost figures update
		* live.
		*
		* @module dsh-context-show/ContextShowSettings
		*/
		/** DeepSeek's announced peak windows (Beijing time), used when enabling tiering. */
		const DEFAULT_PEAK_RANGES = [{
			start: 9,
			end: 12
		}, {
			start: 14,
			end: 18
		}];
		const EMPTY_PRICE = () => ({
			inputPerM: 0,
			cacheReadPerM: 0,
			cacheWritePerM: 0,
			outputPerM: 0
		});
		/** Deep-copy one price entry so auto-added rows never alias their source. */
		const clonePrice = (price) => ({
			inputPerM: price.inputPerM,
			cacheReadPerM: price.cacheReadPerM,
			cacheWritePerM: price.cacheWritePerM,
			outputPerM: price.outputPerM,
			...price.peak === void 0 ? {} : { peak: { ...price.peak } }
		});
		/** Add a model-level price for every detected route that has none yet. */
		const mergeDetectedModels = (base, routes) => {
			if (routes.length === 0) return base;
			const modelPrices = { ...base.modelPrices };
			for (const { provider, model } of routes) {
				const key = provider + "/" + model;
				if (key in modelPrices) continue;
				const source = base.prices[provider] ?? base.defaultPrice;
				modelPrices[key] = clonePrice(source);
			}
			return {
				...base,
				modelPrices
			};
		};
		/** The four base price fields, in display order. */
		const PRICE_FIELDS = [
			{
				key: "inputPerM",
				label: "settings.priceInput"
			},
			{
				key: "cacheReadPerM",
				label: "settings.priceCacheRead"
			},
			{
				key: "cacheWritePerM",
				label: "settings.priceCacheWrite"
			},
			{
				key: "outputPerM",
				label: "settings.priceOutput"
			}
		];
		/** One price entry's editable table: base (闲时) column + optional peak column. */
		const PriceFieldsEditor = (0, react.memo)(function PriceFieldsEditor({ idPrefix, value, showPeak, onField, t }) {
			const numberValue = (current) => Number.isFinite(current) ? String(current) : "";
			return (0, react_jsx_runtime.jsxs)("table", {
				className: ContextShowSettings_module_css_default.priceTable,
				children: [(0, react_jsx_runtime.jsx)("thead", { children: (0, react_jsx_runtime.jsxs)("tr", { children: [
					(0, react_jsx_runtime.jsx)("th", {
						className: ContextShowSettings_module_css_default.priceFieldHead,
						children: t("settings.priceField")
					}),
					(0, react_jsx_runtime.jsx)("th", {
						className: ContextShowSettings_module_css_default.priceValueHead,
						children: t("settings.priceOffPeak")
					}),
					showPeak && (0, react_jsx_runtime.jsx)("th", {
						className: ContextShowSettings_module_css_default.priceValueHead,
						children: t("settings.pricePeak")
					})
				] }) }), (0, react_jsx_runtime.jsx)("tbody", { children: PRICE_FIELDS.map((field) => {
					const offPeakId = idPrefix + "-" + field.key + "-offPeak";
					const peakId = idPrefix + "-" + field.key + "-peak";
					return (0, react_jsx_runtime.jsxs)("tr", { children: [
						(0, react_jsx_runtime.jsx)("td", {
							className: ContextShowSettings_module_css_default.priceFieldCell,
							children: t(field.label)
						}),
						(0, react_jsx_runtime.jsx)("td", {
							className: ContextShowSettings_module_css_default.priceValueCell,
							children: (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: "0",
								step: "0.01",
								id: offPeakId,
								name: offPeakId,
								className: ContextShowSettings_module_css_default.numberInput,
								value: numberValue(value[field.key]),
								onChange: (event) => {
									onField(field.key, false, event.target.value);
								}
							})
						}),
						showPeak && (0, react_jsx_runtime.jsx)("td", {
							className: ContextShowSettings_module_css_default.priceValueCell,
							children: (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: "0",
								step: "0.01",
								id: peakId,
								name: peakId,
								className: ContextShowSettings_module_css_default.numberInput,
								value: numberValue(value.peak?.[field.key] ?? 0),
								onChange: (event) => {
									onField(field.key, true, event.target.value);
								}
							})
						})
					] }, field.key);
				}) })]
			});
		});
		/**
		* The settings page: pricing table editor.
		* @param props - settings seat, locale, and the injected scope face.
		* @returns the section content.
		*/
		const ContextShowSettings = (0, react.memo)(function ContextShowSettings(props) {
			const { scope, save, reset, t } = props;
			const snapshot = (0, react.useSyncExternalStore)((0, react.useCallback)((listener) => scope.subscribe(listener), [scope]), (0, react.useCallback)(() => scope.getSnapshot(), [scope]));
			const value = snapshot.value;
			const [draft, setDraft] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [open, setOpen] = (0, react.useState)(false);
			const [models, setModels] = (0, react.useState)(null);
			const modelsRef = (0, react.useRef)([]);
			(0, react.useEffect)(() => {
				let cancelled = false;
				(async () => {
					try {
						const response = await fetch("/api/dsh-context-show/settings/models", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: "{}"
						});
						if (!response.ok) return;
						const data = await response.json();
						if (cancelled || !data.ok) return;
						setModels(data.value.groups.flatMap((group) => group.models.map((model) => ({
							provider: group.provider,
							model
						}))));
					} catch {}
				})();
				return () => {
					cancelled = true;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (models !== null) modelsRef.current = models;
			}, [models]);
			(0, react.useEffect)(() => {
				if (value !== void 0) setDraft(mergeDetectedModels(value, modelsRef.current));
			}, [value]);
			(0, react.useEffect)(() => {
				if (models === null) return;
				setDraft((prev) => prev === null ? prev : mergeDetectedModels(prev, models));
			}, [models]);
			/** Collapsible card chrome: a toggle header over the body (collapsed by default). */
			const shell = (body) => (0, react_jsx_runtime.jsxs)("div", {
				className: [ContextShowSettings_module_css_default.root, open ? ContextShowSettings_module_css_default.rootOpen : ""].join(" "),
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ContextShowSettings_module_css_default.header,
					"aria-expanded": open,
					onClick: () => {
						setOpen(!open);
					},
					children: [(0, react_jsx_runtime.jsxs)("span", {
						className: ContextShowSettings_module_css_default.headText,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ContextShowSettings_module_css_default.cardTitle,
							children: t("settings.cardTitle")
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ContextShowSettings_module_css_default.cardDesc,
							children: t("settings.cardDesc")
						})]
					}), (0, react_jsx_runtime.jsx)("svg", {
						className: [ContextShowSettings_module_css_default.chevron, open ? ContextShowSettings_module_css_default.chevronOpen : ""].join(" "),
						width: "14",
						height: "14",
						viewBox: "0 0 14 14",
						"aria-hidden": "true",
						children: (0, react_jsx_runtime.jsx)("path", {
							d: "M4 5.5 7 8.5 10 5.5",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.5",
							strokeLinecap: "round",
							strokeLinejoin: "round"
						})
					})]
				}), open && (0, react_jsx_runtime.jsx)("div", {
					className: ContextShowSettings_module_css_default.body,
					children: body
				})]
			});
			if (snapshot.status === "loading") return shell((0, react_jsx_runtime.jsx)("p", {
				className: ContextShowSettings_module_css_default.empty,
				children: t("settings.loading")
			}));
			if (snapshot.status !== "ready" || value === void 0 || draft === null) return shell((0, react_jsx_runtime.jsx)("p", {
				className: ContextShowSettings_module_css_default.empty,
				children: t("settings.unavailable")
			}));
			const showPeak = draft.peakHours.length > 0;
			const patch = (next) => {
				setDraft((prev) => prev === null ? prev : {
					...prev,
					...next
				});
			};
			const patchPrice = (record, key, field, peak, raw) => {
				const numeric = raw === "" ? 0 : Number(raw);
				setDraft((prev) => {
					if (prev === null) return prev;
					const target = record === "defaultPrice" ? prev.defaultPrice : key === null ? EMPTY_PRICE() : prev[record][key] ?? EMPTY_PRICE();
					let nextTarget;
					if (peak) nextTarget = {
						...target,
						peak: {
							...target.peak ?? {},
							[field]: numeric
						}
					};
					else nextTarget = {
						...target,
						[field]: numeric
					};
					if (record === "defaultPrice") return {
						...prev,
						defaultPrice: nextTarget
					};
					if (key === null) return prev;
					return {
						...prev,
						[record]: {
							...prev[record],
							[key]: nextTarget
						}
					};
				});
			};
			const renameKey = (record, oldKey, nextKey) => {
				setDraft((prev) => {
					if (prev === null || oldKey === nextKey || nextKey === "") return prev;
					const recordValue = prev[record];
					if (nextKey in recordValue) return prev;
					const nextRecord = {};
					for (const [current, price] of Object.entries(recordValue)) nextRecord[current === oldKey ? nextKey : current] = price;
					return {
						...prev,
						[record]: nextRecord
					};
				});
			};
			const removeKey = (record, key) => {
				setDraft((prev) => {
					if (prev === null) return prev;
					const nextRecord = { ...prev[record] };
					delete nextRecord[key];
					return {
						...prev,
						[record]: nextRecord
					};
				});
			};
			const addKey = (record, key) => {
				setDraft((prev) => {
					if (prev === null || key === "" || key in prev[record]) return prev;
					return {
						...prev,
						[record]: {
							...prev[record],
							[key]: EMPTY_PRICE()
						}
					};
				});
			};
			const onSave = async () => {
				setBusy(true);
				try {
					await save(draft);
				} finally {
					setBusy(false);
				}
			};
			const onReset = async () => {
				setBusy(true);
				try {
					await reset();
				} finally {
					setBusy(false);
				}
			};
			const writable = snapshot.writable && snapshot.status === "ready";
			return shell((0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsxs)("div", {
					className: ContextShowSettings_module_css_default.fieldRow,
					children: [(0, react_jsx_runtime.jsx)("label", {
						className: ContextShowSettings_module_css_default.fieldLabel,
						htmlFor: "context-show-currency",
						children: t("settings.currency")
					}), (0, react_jsx_runtime.jsx)("select", {
						id: "context-show-currency",
						name: "context-show-currency",
						className: ContextShowSettings_module_css_default.selectInput,
						value: draft.currency,
						onChange: (event) => {
							patch({ currency: event.target.value });
						},
						children: [
							"CNY",
							"USD",
							"CNH",
							"EUR",
							"GBP",
							"JPY"
						].map((code) => (0, react_jsx_runtime.jsx)("option", {
							value: code,
							children: code
						}, code))
					})]
				}),
				(0, react_jsx_runtime.jsxs)("div", {
					className: ContextShowSettings_module_css_default.fieldRow,
					children: [
						(0, react_jsx_runtime.jsx)("label", {
							className: ContextShowSettings_module_css_default.fieldLabel,
							htmlFor: "context-show-peak",
							children: t("settings.peakEnabled")
						}),
						(0, react_jsx_runtime.jsx)("input", {
							id: "context-show-peak",
							name: "context-show-peak",
							type: "checkbox",
							className: ContextShowSettings_module_css_default.checkboxInput,
							checked: showPeak,
							onChange: (event) => {
								patch({ peakHours: event.target.checked ? [...DEFAULT_PEAK_RANGES] : [] });
							}
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ContextShowSettings_module_css_default.fieldHint,
							children: t("settings.peakHint")
						})
					]
				}),
				showPeak && (0, react_jsx_runtime.jsxs)("div", {
					className: ContextShowSettings_module_css_default.fieldRow,
					children: [
						(0, react_jsx_runtime.jsx)("label", {
							className: ContextShowSettings_module_css_default.fieldLabel,
							htmlFor: "context-show-tz",
							children: t("settings.timeZone")
						}),
						(0, react_jsx_runtime.jsx)("input", {
							id: "context-show-tz",
							name: "context-show-tz",
							className: ContextShowSettings_module_css_default.textInput,
							value: draft.timeZone,
							onChange: (event) => {
								patch({ timeZone: event.target.value });
							}
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: ContextShowSettings_module_css_default.fieldRowWide,
							children: draft.peakHours.map((range, index) => (0, react_jsx_runtime.jsxs)("span", {
								className: ContextShowSettings_module_css_default.rangeRow,
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										className: ContextShowSettings_module_css_default.rangeLabel,
										children: index === 0 ? t("settings.peakRange1") : t("settings.peakRange2")
									}),
									(0, react_jsx_runtime.jsx)("input", {
										type: "number",
										min: "0",
										max: "23",
										step: "1",
										id: `context-show-peak-${index}-start`,
										name: `context-show-peak-${index}-start`,
										className: ContextShowSettings_module_css_default.numberInputSmall,
										value: String(range.start),
										onChange: (event) => {
											const hours = [...draft.peakHours];
											hours[index] = {
												...hours[index],
												start: event.target.value === "" ? 0 : Number(event.target.value)
											};
											patch({ peakHours: hours });
										}
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: ContextShowSettings_module_css_default.rangeSep,
										children: "–"
									}),
									(0, react_jsx_runtime.jsx)("input", {
										type: "number",
										min: "0",
										max: "24",
										step: "1",
										id: `context-show-peak-${index}-end`,
										name: `context-show-peak-${index}-end`,
										className: ContextShowSettings_module_css_default.numberInputSmall,
										value: String(range.end),
										onChange: (event) => {
											const hours = [...draft.peakHours];
											hours[index] = {
												...hours[index],
												end: event.target.value === "" ? 0 : Number(event.target.value)
											};
											patch({ peakHours: hours });
										}
									})
								]
							}, index))
						})
					]
				}),
				(0, react_jsx_runtime.jsx)("h3", {
					className: ContextShowSettings_module_css_default.sectionTitle,
					children: t("settings.defaultPrice")
				}),
				(0, react_jsx_runtime.jsx)(PriceFieldsEditor, {
					idPrefix: "context-show-default",
					value: draft.defaultPrice,
					showPeak,
					onField: (field, peak, raw) => {
						patchPrice("defaultPrice", null, field, peak, raw);
					},
					t
				}),
				(0, react_jsx_runtime.jsx)("h3", {
					className: ContextShowSettings_module_css_default.sectionTitle,
					children: t("settings.providerPrices")
				}),
				Object.entries(draft.prices).map(([key, price], index) => (0, react_jsx_runtime.jsxs)("div", {
					className: ContextShowSettings_module_css_default.entryCard,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: ContextShowSettings_module_css_default.entryHeader,
						children: [(0, react_jsx_runtime.jsx)("input", {
							className: ContextShowSettings_module_css_default.textInput,
							id: `context-show-provider-key-${index}`,
							name: `context-show-provider-key-${index}`,
							value: key,
							onChange: (event) => {
								renameKey("prices", key, event.target.value.trim());
							}
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ContextShowSettings_module_css_default.removeButton,
							"aria-label": t("settings.removeProvider", { key }),
							onClick: () => {
								removeKey("prices", key);
							},
							children: "✕"
						})]
					}), (0, react_jsx_runtime.jsx)(PriceFieldsEditor, {
						idPrefix: "context-show-prices-" + key.replace(/[^a-zA-Z0-9_-]/g, "_"),
						value: price,
						showPeak,
						onField: (field, peak, raw) => {
							patchPrice("prices", key, field, peak, raw);
						},
						t
					})]
				}, index)),
				(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ContextShowSettings_module_css_default.addButton,
					onClick: () => {
						addKey("prices", "new-provider");
					},
					children: ["+ ", t("settings.addProvider")]
				}),
				(0, react_jsx_runtime.jsx)("h3", {
					className: ContextShowSettings_module_css_default.sectionTitle,
					children: t("settings.modelPrices")
				}),
				models !== null && models.length > 0 && (0, react_jsx_runtime.jsx)("p", {
					className: ContextShowSettings_module_css_default.note,
					children: t("settings.autoModelsHint")
				}),
				Object.entries(draft.modelPrices).map(([key, price], index) => (0, react_jsx_runtime.jsxs)("div", {
					className: ContextShowSettings_module_css_default.entryCard,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: ContextShowSettings_module_css_default.entryHeader,
						children: [(0, react_jsx_runtime.jsx)("input", {
							className: ContextShowSettings_module_css_default.textInput,
							id: `context-show-model-key-${index}`,
							name: `context-show-model-key-${index}`,
							value: key,
							onChange: (event) => {
								renameKey("modelPrices", key, event.target.value.trim());
							}
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ContextShowSettings_module_css_default.removeButton,
							"aria-label": t("settings.removeModel", { key }),
							onClick: () => {
								removeKey("modelPrices", key);
							},
							children: "✕"
						})]
					}), (0, react_jsx_runtime.jsx)(PriceFieldsEditor, {
						idPrefix: "context-show-models-" + key.replace(/[^a-zA-Z0-9_-]/g, "_"),
						value: price,
						showPeak,
						onField: (field, peak, raw) => {
							patchPrice("modelPrices", key, field, peak, raw);
						},
						t
					})]
				}, index)),
				(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ContextShowSettings_module_css_default.addButton,
					onClick: () => {
						addKey("modelPrices", "provider/model");
					},
					children: ["+ ", t("settings.addModel")]
				}),
				(0, react_jsx_runtime.jsx)("p", {
					className: ContextShowSettings_module_css_default.note,
					children: t("settings.note")
				}),
				(0, react_jsx_runtime.jsxs)("div", {
					className: ContextShowSettings_module_css_default.footer,
					children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ContextShowSettings_module_css_default.primaryButton,
						disabled: !writable || busy,
						onClick: () => {
							onSave();
						},
						children: t("settings.save")
					}), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ContextShowSettings_module_css_default.secondaryButton,
						disabled: !writable || busy,
						onClick: () => {
							onReset();
						},
						children: t("settings.reset")
					})]
				})
			] }));
		});
		//#endregion
		//#region lib/client/locales.js
		/** `context-show` namespace dictionaries. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "context-show";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"context.toggle": "上下文占用面板（点击收起 / 展开）",
			"context.occupancy": "上下文占用",
			"context.occupancySummary": "已用 {percent}% · {used} / {window}",
			"context.usageTotal": "上下文 {total}",
			"context.composition": "来源构成",
			"context.system": "系统提示词",
			"context.tools": "工具定义",
			"context.messages": "对话消息",
			"context.toolUsage": "工具占用",
			"context.toolHeader": "工具",
			"context.callsHeader": "次数",
			"context.tokensHeader": "约 token",
			"context.tokensHint": "估算 token 数（约 4 字符 ≈ 1 token）",
			"context.toolCalls": "×{calls}",
			"context.cost": "花费金额",
			"context.costEstimated": "按配置单价估算",
			"context.peakHours": "分时计价：高峰 {hours}（{timeZone}），其余为闲时",
			"context.priceNote": "未配置单价的路线按默认价估算",
			"context.officialPrice": "官方价格 ↗",
			"context.tokens": "Token 用量",
			"context.usageInput": "输入",
			"context.usageOutput": "输出",
			"context.cacheHit": "缓存命中 {percent}%",
			"context.providers": "各供应商",
			"context.providerUsage": "输入 {input} · 输出 {output}",
			"context.unattributed": "未归属",
			"context.noUsage": "尚无用量上报，等待首个请求返回 usage…",
			"context.detailMode": "展开详情",
			"context.compactMode": "收起详情",
			"context.close": "关闭面板",
			"context.drag": "拖动面板",
			"settings.cardTitle": "上下文占用 · 单价配置",
			"settings.cardDesc": "设置各模型的计价单价（每百万 token）。保存后即时生效。",
			"settings.loading": "正在读取单价配置…",
			"settings.unavailable": "设置服务不可用：请确认 dsh-context-show 主机插件已挂载，并重启 GUI。",
			"settings.currency": "币种",
			"settings.peakEnabled": "启用峰谷计价（8/17 起）",
			"settings.peakHint": "高峰时段按 peak 价，其余按闲时价",
			"settings.timeZone": "高峰时段时区",
			"settings.peakRange1": "高峰 1（start–end）",
			"settings.peakRange2": "高峰 2（start–end）",
			"settings.defaultPrice": "默认价（未配置的供应商）",
			"settings.providerPrices": "供应商单价",
			"settings.modelPrices": "模型级单价覆盖（provider/model）",
			"settings.autoModelsHint": "已自动补全当前可用模型的价格（未保存前仅在本页可见）。",
			"settings.priceField": "项目",
			"settings.priceOffPeak": "闲时",
			"settings.pricePeak": "高峰",
			"settings.priceInput": "输入（缓存未命中）",
			"settings.priceCacheRead": "输入（缓存命中）",
			"settings.priceCacheWrite": "写缓存",
			"settings.priceOutput": "输出",
			"settings.addProvider": "添加供应商",
			"settings.addModel": "添加模型覆盖",
			"settings.removeProvider": "删除供应商 {key}",
			"settings.removeModel": "删除模型覆盖 {key}",
			"settings.note": "单价单位为每百万 token。保存后即时生效（主机投影重新计价）。",
			"settings.save": "保存",
			"settings.reset": "恢复默认"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"context.toggle": "Context usage panel (click to collapse / expand)",
			"context.occupancy": "Context occupancy",
			"context.occupancySummary": "{percent}% used · {used} / {window}",
			"context.usageTotal": "Context {total}",
			"context.composition": "Composition",
			"context.system": "System prompt",
			"context.tools": "Tools",
			"context.messages": "Messages",
			"context.toolUsage": "Tool usage",
			"context.toolHeader": "Tool",
			"context.callsHeader": "Calls",
			"context.tokensHeader": "~Tokens",
			"context.tokensHint": "Estimated tokens (~4 chars ≈ 1 token)",
			"context.toolCalls": "×{calls}",
			"context.cost": "Estimated cost",
			"context.costEstimated": "Estimated at the configured rates",
			"context.peakHours": "Peak/off-peak billing: peak {hours} ({timeZone}), otherwise off-peak",
			"context.priceNote": "Routes without a configured price are estimated at the default rate",
			"context.officialPrice": "Official pricing ↗",
			"context.tokens": "Token usage",
			"context.usageInput": "Input",
			"context.usageOutput": "Output",
			"context.cacheHit": "Cache hit {percent}%",
			"context.providers": "By provider",
			"context.providerUsage": "In {input} · Out {output}",
			"context.unattributed": "Unattributed",
			"context.noUsage": "No usage reported yet; waiting for the first request usage…",
			"context.detailMode": "Show details",
			"context.compactMode": "Collapse details",
			"context.close": "Close panel",
			"context.drag": "Drag panel",
			"settings.cardTitle": "Context usage · Pricing",
			"settings.cardDesc": "Set per-model billing rates (per 1M tokens). Saving applies immediately.",
			"settings.loading": "Loading pricing configuration…",
			"settings.unavailable": "Settings service unavailable: verify the dsh-context-show host plugin is mounted, then restart the GUI.",
			"settings.currency": "Currency",
			"settings.peakEnabled": "Enable peak/off-peak billing",
			"settings.peakHint": "Peak hours price at the peak rate, the rest at the off-peak rate",
			"settings.timeZone": "Peak hours timezone",
			"settings.peakRange1": "Peak window 1 (start–end)",
			"settings.peakRange2": "Peak window 2 (start–end)",
			"settings.defaultPrice": "Default price (providers without an entry)",
			"settings.providerPrices": "Provider prices",
			"settings.modelPrices": "Model-level overrides (provider/model)",
			"settings.autoModelsHint": "Prices for the currently available models were auto-added (visible here until saved).",
			"settings.priceField": "Item",
			"settings.priceOffPeak": "Off-peak",
			"settings.pricePeak": "Peak",
			"settings.priceInput": "Input (cache miss)",
			"settings.priceCacheRead": "Input (cache hit)",
			"settings.priceCacheWrite": "Cache write",
			"settings.priceOutput": "Output",
			"settings.addProvider": "Add provider",
			"settings.addModel": "Add model override",
			"settings.removeProvider": "Remove provider {key}",
			"settings.removeModel": "Remove model override {key}",
			"settings.note": "Prices are per 1M tokens. Saving applies immediately (the host projection reprices).",
			"settings.save": "Save",
			"settings.reset": "Reset to defaults"
		};
		//#endregion
		//#region lib/client/index.js
		/**
		* dsh-context-show browser half: the collapsible context occupancy panel in
		* the conversation session header utilities row, plus the pricing settings
		* card in the web Settings plugin-configuration section.
		*
		* @module dsh-context-show/client
		*/
		/** Settings namespace spelled by the host plugin (see src/index.ts). */
		const SETTINGS_NAMESPACE = "context-show";
		/** Required services: slots (ui-renderer), locale, and the settings scope binder. */
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];
		/** Unavailable scope used when the settings surface cannot bind the namespace. */
		function unavailableScope() {
			const snapshot = {
				status: "unavailable",
				writable: false,
				mode: "memory",
				revision: void 0
			};
			return {
				getSnapshot: () => snapshot,
				subscribe: () => () => {},
				set: async () => {},
				unset: async () => {},
				mutate: async () => {}
			};
		}
		/** Lenient structural decode: the host already schema-resolves the section. */
		function decodeConfigView(section) {
			if (typeof section !== "object" || section === null || Array.isArray(section)) return void 0;
			const value = section;
			if (typeof value.currency !== "string") return void 0;
			if (typeof value.prices !== "object" || value.prices === null) return void 0;
			return {
				currency: value.currency,
				prices: value.prices,
				modelPrices: value.modelPrices ?? {},
				defaultPrice: value.defaultPrice ?? {
					inputPerM: 0,
					cacheReadPerM: 0,
					cacheWritePerM: 0,
					outputPerM: 0
				},
				peakHours: Array.isArray(value.peakHours) ? value.peakHours : [],
				timeZone: typeof value.timeZone === "string" ? value.timeZone : "Asia/Shanghai"
			};
		}
		/**
		* Mount the meter entry and the pricing settings card.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "context-show: dictionaries");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "context-show",
				order: 10,
				locale: NS
			}, ContextShowMeter));
			ctx.slots.inject("settings.plugin.item", () => {
				let scope;
				try {
					const primary = ctx.settingsScope.bind({
						namespace: SETTINGS_NAMESPACE,
						decode: decodeConfigView
					});
					scope = createCompatScope({
						namespace: SETTINGS_NAMESPACE,
						primary,
						decode: decodeConfigView
					});
				} catch (_bindFailure) {
					scope = unavailableScope();
				}
				const save = async (section) => {
					await scope.set("currency", section.currency);
					await scope.set("peakHours", section.peakHours);
					await scope.set("timeZone", section.timeZone);
					await scope.set("prices", section.prices);
					await scope.set("modelPrices", section.modelPrices);
					await scope.set("defaultPrice", section.defaultPrice);
				};
				const reset = async () => {
					for (const field of [
						"currency",
						"peakHours",
						"timeZone",
						"prices",
						"modelPrices",
						"defaultPrice"
					]) await scope.unset(field);
				};
				const settingsInjected = () => ({
					scope,
					save,
					reset
				});
				return ctx.slots.register({
					name: "settings.plugin.item",
					key: SETTINGS_NAMESPACE,
					locale: NS,
					inject: settingsInjected
				}, ContextShowSettings);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map