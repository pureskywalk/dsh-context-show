/**
 * Tests for the client-side snapshot pricing and the per-tool aggregation
 * used by the tool-usage list.
 */

import { describe, expect, it } from 'vitest'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { estimateNodeTokens, toolUsage } from '../src/client/estimate.ts'

const userNode = (seq: number, text: string): ConversationNode => ({
  kind: 'user',
  seq,
  time: 1,
  content: [{ type: 'text', text }],
  source: {},
} as unknown as ConversationNode)

const assistantNode = (seq: number, text: string): ConversationNode => ({
  kind: 'assistant',
  seq,
  time: 1,
  turn: 1,
  step: 1,
  blocks: [{ kind: 'text', text }],
} as unknown as ConversationNode)

const toolResultNode = (seq: number, name: string, text: string): ConversationNode => ({
  kind: 'tool-result',
  seq,
  time: 1,
  callId: 'call-' + seq,
  call: { name, argsRaw: '{}' },
  content: [{ type: 'text', text }],
  isError: false,
  callView: null,
  resultView: null,
  subCalls: [],
} as unknown as ConversationNode)

describe('estimateNodeTokens', () => {
  it('prices text at 4 chars per token plus block and role overhead', () => {
    // 40 chars -> ceil(40/4)=10, +4 block overhead, +4 role framing = 18
    expect(estimateNodeTokens(userNode(0, 'a'.repeat(40)))).toBe(18)
  })

  it('prices assistant tool-call blocks by name plus arguments', () => {
    const node: ConversationNode = {
      kind: 'assistant',
      seq: 1,
      time: 1,
      turn: 1,
      step: 1,
      blocks: [{ kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' }],
    } as unknown as ConversationNode
    // ceil(4/4) + ceil(2/4) + 4 block + 4 role = 1 + 1 + 4 + 4 = 10
    expect(estimateNodeTokens(node)).toBe(10)
  })

  it('returns zero for non-message nodes', () => {
    const compaction = {
      kind: 'compaction',
      seq: 2,
      time: 1,
      summary: null,
      summaryEventSeq: null,
      shadowedItemCount: null,
      shadowedTokenCount: null,
    } as unknown as ConversationNode
    expect(estimateNodeTokens(compaction)).toBe(0)
  })
})

describe('toolUsage', () => {
  it('aggregates tool results by name with call counts and summed tokens', () => {
    const rows = toolUsage([
      toolResultNode(0, 'bash', 'a'.repeat(400)), // ~108 tokens
      toolResultNode(1, 'bash', 'b'.repeat(80)),  // ~28 tokens
      toolResultNode(2, 'glob', 'c'.repeat(40)),  // ~18 tokens
      userNode(3, 'a prompt'),                    // not a tool -> ignored
    ], 6)
    expect(rows).toHaveLength(2)
    const bash = rows.find((row) => row.name === 'bash')
    const glob = rows.find((row) => row.name === 'glob')
    expect(bash).toMatchObject({ calls: 2, tokens: 108 + 28 })
    expect(glob).toMatchObject({ calls: 1, tokens: 18 })
    // sorted by descending tokens
    expect(rows[0]?.name).toBe('bash')
  })

  it('caps the list and falls back to the call id when the call is missing', () => {
    const rows = toolUsage([
      toolResultNode(0, 'bash', 'a'.repeat(100)),
      {
        kind: 'tool-result',
        seq: 1,
        time: 1,
        callId: 'orphan-call',
        call: null,
        content: [{ type: 'text', text: 'x'.repeat(80) }],
        isError: false,
        callView: null,
        resultView: null,
        subCalls: [],
      } as unknown as ConversationNode,
    ], 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('bash')
    const all = toolUsage([
      toolResultNode(0, 'bash', 'a'.repeat(100)),
      {
        kind: 'tool-result',
        seq: 1,
        time: 1,
        callId: 'orphan-call',
        call: null,
        content: [{ type: 'text', text: 'x'.repeat(80) }],
        isError: false,
        callView: null,
        resultView: null,
        subCalls: [],
      } as unknown as ConversationNode,
    ], 6)
    expect(all.some((row) => row.name === 'orphan-call')).toBe(true)
  })
})
