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

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { AssistantBlock, ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Fixed text-density estimate used until exact tokenization is needed. */
const CHARS_PER_TOKEN = 4
/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4
/** Role-field framing overhead added to every priced message. */
const ROLE_OVERHEAD = 4

/**
 * Price content blocks recursively under the fixed density heuristic.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateContentTokens(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN)
          + Math.ceil(block.arguments.length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD
        break
      case 'tool-result':
        tokens += estimateContentTokens(block.content) + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks retain a
        // conservative structural JSON price under the fixed heuristic.
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
    }
  }
  return tokens
}

/**
 * Price the UI-classified assistant block list (mirrors estimateContentTokens
 * over the snapshot's AssistantBlock shape).
 * @param blocks - assistant blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateAssistantBlocks(blocks: readonly AssistantBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN)
          + Math.ceil(block.argsRaw.length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD
        break
      default:
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
    }
  }
  return tokens
}

/**
 * Price one conversation snapshot node.
 * @param node - snapshot node to price without mutation.
 * @returns heuristic tokens including role framing; 0 for non-message nodes.
 */
export function estimateNodeTokens(node: ConversationNode): number {
  switch (node.kind) {
    case 'user':
    case 'context':
      return estimateContentTokens(node.content) + ROLE_OVERHEAD
    case 'assistant':
      return estimateAssistantBlocks(node.blocks) + ROLE_OVERHEAD
    case 'tool-result':
      return estimateContentTokens(node.content) + ROLE_OVERHEAD
    default:
      return 0
  }
}

/** One aggregated tool row for the panel's tool-usage list. */
export interface ToolUsageRow {
  /** Tool name (fallback: the call id when the call is outside the window). */
  name: string
  /** How many tool-result nodes this tool contributed. */
  calls: number
  /** Heuristic tokens summed over every result of this tool. */
  tokens: number
}

/**
 * Aggregate the conversation's tool results by tool name.
 * @param nodes - snapshot nodes in render order.
 * @param limit - how many rows to keep (default 6).
 * @returns rows sorted by descending tokens, then name.
 */
export function toolUsage(nodes: readonly ConversationNode[], limit = 6): ToolUsageRow[] {
  const byName = new Map<string, { calls: number; tokens: number }>()
  for (const node of nodes) {
    if (node.kind !== 'tool-result') continue
    const name = node.call?.name ?? node.callId
    const tokens = estimateNodeTokens(node)
    const entry = byName.get(name) ?? { calls: 0, tokens: 0 }
    entry.calls += 1
    entry.tokens += tokens
    byName.set(name, entry)
  }
  return [...byName.entries()]
    .map(([name, value]) => ({ name, calls: value.calls, tokens: value.tokens }))
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
    .slice(0, limit)
}
