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
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { AssistantBlock, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Price content blocks recursively under the fixed density heuristic.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export declare function estimateContentTokens(blocks: readonly ContentBlock[]): number;
/**
 * Price the UI-classified assistant block list (mirrors estimateContentTokens
 * over the snapshot's AssistantBlock shape).
 * @param blocks - assistant blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export declare function estimateAssistantBlocks(blocks: readonly AssistantBlock[]): number;
/**
 * Price one conversation snapshot node.
 * @param node - snapshot node to price without mutation.
 * @returns heuristic tokens including role framing; 0 for non-message nodes.
 */
export declare function estimateNodeTokens(node: ConversationNode): number;
/** One aggregated tool row for the panel's tool-usage list. */
export interface ToolUsageRow {
    /** Tool name (fallback: the call id when the call is outside the window). */
    name: string;
    /** How many tool-result nodes this tool contributed. */
    calls: number;
    /** Heuristic tokens summed over every result of this tool. */
    tokens: number;
}
/**
 * Aggregate the conversation's tool results by tool name.
 * @param nodes - snapshot nodes in render order.
 * @param limit - how many rows to keep (default 6).
 * @returns rows sorted by descending tokens, then name.
 */
export declare function toolUsage(nodes: readonly ConversationNode[], limit?: number): ToolUsageRow[];
