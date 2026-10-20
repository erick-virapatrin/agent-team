import { describe, expect, it } from 'vitest'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  AssistantStreamTracker,
  projectContextUsage,
  projectConversation,
} from '../src/runtime/conversation-projector.js'

describe('projectConversation', () => {
  it('projects a settled user message, assistant message, and tool exchange', () => {
    const projected = projectConversation([
      event(0, 'user/message', {
        id: 'user-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Build it' }],
      }),
      event(1, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'openai', model: 'codex' },
          content: [
            { type: 'reasoning', text: 'Checking files' },
            { type: 'text', text: 'Working' },
          ],
        },
        stream: [
          { type: 'reasoning-chunks', time0: 900, index: 0, dt: [0], texts: ['Checking files'] },
          { type: 'text-chunks', time0: 1_200, index: 1, dt: [0], texts: ['Working'] },
        ],
      }),
      event(2, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{"path":"a.ts"}' }),
      event(3, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: 'tool-result-1', role: 'tool', source: { kind: 'tool', callId: 'call-1' },
          toolCallId: 'call-1',
          isError: false,
          content: [{ type: 'text', text: 'file contents' }],
        },
      }),
    ])

    expect(projected.throughSeq).toBe(3)
    expect(projected.nodes).toEqual([
      expect.objectContaining({ kind: 'user', text: 'Build it' }),
      expect.objectContaining({
        kind: 'assistant',
        text: 'Working',
        reasoning: 'Checking files',
        reasoningStartedAt: 900,
        reasoningCompletedAt: 1_200,
      }),
      expect.objectContaining({ kind: 'tool', name: 'read', status: 'success', result: 'file contents' }),
    ])
  })

  it('folds live assistant stream frames into a streaming assistant node', () => {
    const streams = new AssistantStreamTracker()
    streams.observe('session-1', frameStart(1, 1))
    streams.observe('session-1', frameChunk(1_000, { type: 'text-delta', index: 0, text: 'Working' }))
    streams.observe('session-1', frameChunk(1_100, { type: 'reasoning-delta', index: 1, text: 'Checking files' }))

    const projected = projectConversation(
      [event(0, 'user/message', {
        id: 'user-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Build it' }],
      })],
      240,
      undefined,
      streams.list('session-1'),
    )

    expect(projected.throughSeq).toBe(0)
    expect(projected.nodes).toEqual([
      expect.objectContaining({ kind: 'user', text: 'Build it' }),
      expect.objectContaining({
        kind: 'assistant',
        seq: 1,
        text: 'Working',
        reasoning: 'Checking files',
        reasoningStartedAt: 1_100,
        streaming: true,
      }),
    ])
  })

  it('uses completed stream blocks when a provider does not emit deltas', () => {
    const streams = new AssistantStreamTracker()
    streams.observe('session-1', frameStart(2, 1))
    streams.observe('session-1', frameChunk(2_000, {
      type: 'block-end', index: 0, block: { type: 'reasoning', text: 'full reasoning' },
    }))
    streams.observe('session-1', frameChunk(2_100, {
      type: 'block-end', index: 1, block: { type: 'text', text: 'full reply' },
    }))

    const projected = projectConversation([], 240, undefined, streams.list('session-1'))

    expect(projected.nodes).toEqual([
      expect.objectContaining({
        kind: 'assistant',
        text: 'full reply',
        reasoning: 'full reasoning',
        streaming: true,
      }),
    ])
  })

  it('drops the live partial once the attempt settles into a durable message', () => {
    const streams = new AssistantStreamTracker()
    streams.observe('session-1', frameStart(1, 1))
    streams.observe('session-1', frameChunk(1_000, { type: 'text-delta', index: 0, text: 'Old partial' }))
    streams.observe('session-1', {
      type: 'end',
      attemptId: 'attempt-1',
      revision: 1,
      index: 1,
      outcome: { kind: 'committed', eventType: 'assistant/message', seq: 1 },
    } as AssistantStreamFrame)

    expect(streams.list('session-1')).toEqual([])
    const projected = projectConversation([
      event(1, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'openai', model: 'codex' },
          content: [{ type: 'text', text: 'Final answer' }],
        },
        stream: [],
      }),
    ], 240, undefined, streams.list('session-1'))

    expect(projected.nodes).toEqual([
      expect.objectContaining({ kind: 'assistant', text: 'Final answer' }),
    ])
    expect(projected.nodes.some(node => node.kind === 'assistant' && node.streaming === true)).toBe(false)
  })

  it('keeps an abandoned live attempt out of the conversation', () => {
    const streams = new AssistantStreamTracker()
    streams.observe('session-1', frameStart(3, 1))
    streams.observe('session-1', frameChunk(1_000, { type: 'text-delta', index: 0, text: 'Partial' }))
    streams.observe('session-1', {
      type: 'end',
      attemptId: 'attempt-1',
      revision: 1,
      index: 1,
      outcome: { kind: 'abandoned' },
    } as AssistantStreamFrame)

    expect(streams.list('session-1')).toEqual([])
  })

  it('ignores live frames of sessions the tracker never started', () => {
    const streams = new AssistantStreamTracker()
    streams.observe('session-1', frameChunk(1_000, { type: 'text-delta', index: 0, text: 'Orphan' }))
    expect(streams.list('session-1')).toEqual([])
  })

  it('derives persisted reasoning timing from the embedded compact stream', () => {
    const projected = projectConversation([
      timedEvent(0, 3_500, 'assistant/message', {
        turn: 3,
        step: 1,
        message: {
          id: 'assistant-3',
          role: 'assistant',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          content: [
            { type: 'reasoning', text: 'analysis done' },
            { type: 'text', text: 'final answer' },
          ],
        },
        stream: [
          { type: 'reasoning-chunks', time0: 1_000, index: 0, dt: [200, 100], texts: ['analysis', ' done'] },
          { type: 'text-chunks', time0: 3_400, index: 1, dt: [100], texts: ['final answer'] },
        ],
      }),
    ])

    expect(projected.nodes).toEqual([
      expect.objectContaining({
        kind: 'assistant',
        reasoning: 'analysis done',
        reasoningStartedAt: 1_000,
        reasoningCompletedAt: 3_400,
      }),
    ])
  })

  it('keeps model-facing context out of the visible conversation', () => {
    const projected = projectConversation([
      event(0, 'user/message', {
        id: 'context-snapshot', role: 'user',
        source: {
          kind: 'plugin', plugin: 'dsh-runtime-context', form: 'snapshot',
          sections: [{ name: 'policy', text: 'Current runtime context' }],
        },
        content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier snapshots.' }],
      }),
      event(1, 'user/message', {
        id: 'skills-catalog', role: 'user',
        source: { kind: 'plugin', plugin: 'dsh-skills', form: 'catalog' },
        content: [{ type: 'text', text: '<system-reminder><available_skills>secret catalog</available_skills></system-reminder>' }],
      }),
      event(2, 'user/message', {
        id: 'user-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'hello' }],
      }),
      event(3, 'user/message', {
        id: 'relay-1', role: 'user',
        source: { kind: 'agent-team', plugin: 'dsh-agent-team', form: 'relay' },
        content: [{ type: 'text', text: 'task assigned by the Leader' }],
      }),
      event(4, 'user/message', {
        id: 'legacy-relay', role: 'user',
        source: { kind: 'plugin', plugin: 'dsh-agent-team', form: 'relay' },
        content: [{ type: 'text', text: 'task forwarded by legacy persistence' }],
      }),
      event(5, 'user/message', {
        id: 'foreign-relay', role: 'user',
        source: { kind: 'plugin', plugin: 'another-plugin', form: 'relay' },
        content: [{ type: 'text', text: 'internal forward from another plugin' }],
      }),
    ])

    expect(projected.nodes).toEqual([
      expect.objectContaining({ kind: 'user', text: 'hello' }),
      expect.objectContaining({ kind: 'user', text: 'task assigned by the Leader' }),
      expect.objectContaining({ kind: 'user', text: 'task forwarded by legacy persistence' }),
    ])
    expect(JSON.stringify(projected.nodes)).not.toContain('Current runtime context')
    expect(JSON.stringify(projected.nodes)).not.toContain('available_skills')
    expect(JSON.stringify(projected.nodes)).not.toContain('internal forward from another plugin')
  })

  it('projects persisted member relays as structured compact team messages', () => {
    const projected = projectConversation([
      event(0, 'user/message', {
        id: 'relay-1', role: 'user',
        source: { kind: 'agent-team', plugin: 'dsh-agent-team', form: 'relay' },
        content: [{ type: 'text', text: '[Team message from Coder]\nParser implemented.' }],
      }),
    ], 240, {
      team: {
        leaderSlotId: 'leader-1',
        members: {
          'leader-1': { id: 'leader-1', displayName: 'Lead' },
          'member-1': { id: 'member-1', displayName: 'Coder' },
        },
        retiredSessions: {},
      } as never,
      messages: [{
        id: 'relay-1',
        sender: { kind: 'member', id: 'member-1' },
        type: 'result',
        content: 'Parser implemented.',
        relatedTaskId: 'task-1',
      } as never],
    })

    expect(projected.nodes).toEqual([{
      id: 'relay-1',
      kind: 'team-message',
      seq: 0,
      time: 1_700_000_000_000,
      text: 'Parser implemented.',
      senderName: 'Coder',
      senderId: 'member-1',
      senderRole: 'member',
      messageType: 'result',
      relatedTaskId: 'task-1',
    }])
  })
})

describe('projectContextUsage', () => {
  it('uses the latest prompt-side provider sample and context capacity', () => {
    const projected = projectContextUsage([
      event(0, 'request/context', { provider: 'zai-coding-cn', model: 'glm-5.3', contextWindow: 128_000 }),
      event(1, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'zai-coding-cn', model: 'glm-5.3' },
          content: [{ type: 'text', text: 'First' }],
        },
        stream: [],
        usage: { inputTokens: 1_000, outputTokens: 250, cacheReadTokens: 2_000, cacheWriteTokens: 300 },
      }),
      event(2, 'assistant/message', {
        turn: 2,
        step: 1,
        message: {
          id: 'assistant-2', role: 'assistant', source: { kind: 'model', provider: 'zai-coding-cn', model: 'glm-5.3' },
          content: [{ type: 'text', text: 'Second' }],
        },
        stream: [],
        usage: { inputTokens: 2_000, outputTokens: 400, cacheReadTokens: 4_000, cacheWriteTokens: 500 },
      }),
    ])

    expect(projected).toEqual({
      usedTokens: 6_900,
      inputTokens: 6_500,
      outputTokens: 400,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 500,
      reasoningTokens: 0,
      contextWindow: 128_000,
    })
  })

  it('requires real usage but still reports details when the window is unknown', () => {
    expect(projectContextUsage([
      event(0, 'request/context', { provider: 'openai', model: 'codex', contextWindow: 200_000 }),
    ])).toBeUndefined()
    expect(projectContextUsage([
      event(0, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'openai', model: 'codex' },
          content: [],
        },
        stream: [],
        usage: { inputTokens: 1_000, outputTokens: 100 },
      }),
    ])).toEqual({
      usedTokens: 1_100,
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    })
  })
})

function event(seq: number, type: SessionEvent['type'], data: unknown): SessionEvent {
  return { seq, time: 1_700_000_000_000 + seq, type, data } as SessionEvent
}

function timedEvent(seq: number, time: number, type: SessionEvent['type'], data: unknown): SessionEvent {
  return { seq, time, type, data } as SessionEvent
}

function frameStart(turn: number, step: number): AssistantStreamFrame {
  return { type: 'start', attemptId: 'attempt-1', revision: 1, turn, step } as AssistantStreamFrame
}

function frameChunk(time: number, chunk: unknown): AssistantStreamFrame {
  return { type: 'chunk', attemptId: 'attempt-1', revision: 1, index: 0, time, chunk } as AssistantStreamFrame
}
