import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import {
  runFirstTokenTime,
  runFirstVisibleTime,
  type AssistantStreamRecord,
  type ContentBlock,
  type MessageSource,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isAgentTeamRelaySource } from '../domain/message-source.js'
import type { TeamAggregate, TeamMessage } from '../domain/types.js'
import type { ConversationNode, MemberConversationView } from '../transport/contracts.js'

/** One in-flight assistant output, folded from live `agent/assistant-stream` frames. */
export interface LiveAssistantPartial {
  turn: number
  step: number
  text: string
  reasoning: string
  startedAt: number
  updatedAt: number
  reasoningStartedAt?: number
  reasoningCompletedAt?: number
}

/**
 * Live assistant streams per Session.
 *
 * Harness 0.2.0 no longer appends `assistant/chunk` events to the Session log: a
 * model attempt is published as transient `agent/assistant-stream` frames and
 * only the settled `assistant/message` (with its compact embedded stream)
 * enters the log. The workbench keeps token-by-token rendering by folding the
 * live frames beside the logged events.
 */
export class AssistantStreamTracker {
  private readonly sessions = new Map<string, Map<string, LiveAssistantPartial>>()

  /**
   * Apply one live stream publication of one Session.
   * @param sessionId - Session the publishing agent owns.
   * @param frame - one start, chunk, or end publication.
   * @returns nothing.
   */
  observe(sessionId: string, frame: AssistantStreamFrame): void {
    const key = String(frame.attemptId)
    if (frame.type === 'start') {
      const streams = this.sessions.get(sessionId) ?? new Map<string, LiveAssistantPartial>()
      const time = Date.now()
      streams.set(key, {
        turn: frame.turn,
        step: frame.step,
        text: '',
        reasoning: '',
        startedAt: time,
        updatedAt: time,
      })
      this.sessions.set(sessionId, streams)
      return
    }
    const streams = this.sessions.get(sessionId)
    const current = streams?.get(key)
    if (streams === undefined || current === undefined) return
    if (frame.type === 'end') {
      streams.delete(key)
      if (streams.size === 0) this.sessions.delete(sessionId)
      return
    }
    applyStreamChunk(current, frame.chunk, frame.time)
  }

  /**
   * In-flight assistant outputs of one Session, oldest first.
   * @param sessionId - the Session to read.
   * @returns every partial stream with reader-visible content.
   */
  list(sessionId: string): readonly LiveAssistantPartial[] {
    return [...(this.sessions.get(sessionId)?.values() ?? [])]
      .filter(partial => partial.text.length > 0 || partial.reasoning.length > 0)
      .sort((left, right) => left.turn - right.turn || left.step - right.step)
  }

  /**
   * Drop every in-flight stream of one Session, for example when its agent goes away.
   * @param sessionId - the Session to clear.
   * @returns nothing.
   */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId)
  }
}

function applyStreamChunk(
  partial: LiveAssistantPartial,
  chunk: StreamChunk,
  time: number,
): void {
  partial.updatedAt = time
  if (chunk.type === 'text-delta') {
    partial.text += chunk.text
    if (chunk.text.length > 0 && partial.reasoningStartedAt !== undefined) {
      partial.reasoningCompletedAt ??= time
    }
    return
  }
  if (chunk.type === 'reasoning-delta') {
    partial.reasoning += chunk.text
    if (chunk.text.length > 0) {
      partial.reasoningStartedAt ??= time
      if (partial.text.length > 0) partial.reasoningCompletedAt ??= time
    }
    return
  }
  if (chunk.type !== 'block-end') return
  if (chunk.block.type === 'text') {
    partial.text = chunk.block.text
    if (partial.reasoningStartedAt !== undefined) partial.reasoningCompletedAt ??= time
    return
  }
  if (chunk.block.type === 'reasoning') {
    partial.reasoning = chunk.block.text
    if (chunk.block.text.length > 0) {
      partial.reasoningStartedAt ??= time
      partial.reasoningCompletedAt ??= time
    }
  }
}

interface TeamProjectionContext {
  team: Pick<TeamAggregate, 'leaderSlotId' | 'members' | 'retiredSessions'>
  messages: readonly TeamMessage[]
}

export function projectContextUsage(
  events: readonly SessionEvent[],
): MemberConversationView['contextUsage'] {
  let latestUsage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  } | undefined
  let contextWindow: number | undefined

  for (const event of events) {
    if (event.type === 'request/context') contextWindow = event.data.contextWindow
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      latestUsage = event.data.usage
    }
  }

  if (latestUsage === undefined) return undefined
  const cacheReadTokens = latestUsage.cacheReadTokens ?? 0
  const cacheWriteTokens = latestUsage.cacheWriteTokens ?? 0
  const inputTokens = latestUsage.inputTokens + cacheReadTokens + cacheWriteTokens
  const outputTokens = latestUsage.outputTokens
  return {
    usedTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: latestUsage.reasoningTokens ?? 0,
    ...(contextWindow === undefined ? {} : { contextWindow }),
  }
}

export function projectConversation(
  events: readonly SessionEvent[],
  limit = 240,
  teamContext?: TeamProjectionContext,
  live: readonly LiveAssistantPartial[] = [],
): {
  throughSeq: number
  nodes: ConversationNode[]
} {
  const nodes: ConversationNode[] = []
  const tools = new Map<string, number>()
  const teamMessages = new Map(teamContext?.messages.map(message => [message.id, message]) ?? [])

  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        if (!isVisibleUserSource(event.data.source)) break
        const text = textOf(event.data.content)
        if (text.length > 0) {
          const messageId = String(event.data.id)
          const teamMessage = teamMessages.get(messageId)
          if (teamContext !== undefined && teamMessage !== undefined && teamMessage.sender.kind !== 'user') {
            nodes.push(teamMessageNode(teamContext.team, teamMessage, event.seq, event.time))
          } else {
            nodes.push({
              id: messageId,
              kind: 'user',
              seq: event.seq,
              time: event.time,
              text,
            })
          }
        }
        break
      }
      case 'assistant/message': {
        const text = textOf(event.data.message.content)
        const reasoning = reasoningOf(event.data.message.content)
        const timing = reasoningTiming(event.data.stream)
        if (text.length > 0 || reasoning.length > 0) nodes.push({
          id: String(event.data.message.id),
          kind: 'assistant',
          seq: event.seq,
          time: event.time,
          text,
          ...(reasoning.length === 0 ? {} : { reasoning }),
          ...(timing.reasoningStartedAt === undefined ? {} : {
            reasoningStartedAt: timing.reasoningStartedAt,
            reasoningCompletedAt: timing.reasoningCompletedAt ?? event.time,
          }),
        })
        break
      }
      case 'tool/call': {
        const callId = String(event.data.callId)
        tools.set(callId, nodes.length)
        nodes.push({
          id: `tool:${callId}`,
          kind: 'tool',
          seq: event.seq,
          time: event.time,
          callId,
          name: event.data.name,
          arguments: event.data.arguments,
          status: 'running',
        })
        break
      }
      case 'tool/result': {
        const resultMessage = event.data.message
        const callId = String(resultMessage.toolCallId)
        const index = tools.get(callId)
        const result = textOf(resultMessage.content)
        const error = event.data.error === undefined
          ? undefined
          : `${event.data.error.name}: ${event.data.error.code}`
        const failed = resultMessage.isError === true || error !== undefined
        if (index !== undefined) {
          const node = nodes[index]
          if (node?.kind === 'tool') nodes[index] = {
            ...node,
            seq: event.seq,
            status: failed ? 'error' : 'success',
            ...(result.length === 0 ? {} : { result }),
            ...(error === undefined ? {} : { error }),
          }
        } else {
          nodes.push({
            id: `tool:${callId}`,
            kind: 'tool',
            seq: event.seq,
            time: event.time,
            callId,
            name: 'tool',
            arguments: '',
            status: failed ? 'error' : 'success',
            ...(result.length === 0 ? {} : { result }),
            ...(error === undefined ? {} : { error }),
          })
        }
        break
      }
      case 'turn/end': {
        if (event.data.reason.kind === 'error') nodes.push({
          id: `turn-error:${event.seq}`,
          kind: 'notice',
          seq: event.seq,
          time: event.time,
          tone: 'error',
          text: event.data.reason.error.message,
        })
        if (event.data.reason.kind === 'max-tokens') nodes.push({
          id: `turn-warning:${event.seq}`,
          kind: 'notice',
          seq: event.seq,
          time: event.time,
          tone: 'warning',
          text: 'This turn reached the model output length limit.',
        })
        break
      }
    }
  }

  const throughSeq = events.at(-1)?.seq ?? -1
  for (const partial of live) {
    nodes.push({
      id: `stream:${partial.turn}:${partial.step}`,
      kind: 'assistant',
      seq: throughSeq + 1,
      time: partial.startedAt,
      text: partial.text,
      ...(partial.reasoning.length === 0 ? {} : { reasoning: partial.reasoning }),
      ...(partial.reasoningStartedAt === undefined ? {} : {
        reasoningStartedAt: partial.reasoningStartedAt,
        ...(partial.reasoningCompletedAt === undefined ? {} : {
          reasoningCompletedAt: partial.reasoningCompletedAt,
        }),
      }),
      streaming: true,
    })
  }
  nodes.sort((left, right) => left.seq - right.seq)
  return {
    throughSeq,
    nodes: nodes.slice(-limit),
  }
}

/**
 * Locate the reasoning timing of one settled assistant message in its compact stream.
 * @param stream - the stream embedded in the `assistant/message` event.
 * @returns the reasoning bounds the transcript renders, absent when the model never reasoned.
 */
function reasoningTiming(
  stream: readonly AssistantStreamRecord[],
): { reasoningStartedAt?: number; reasoningCompletedAt?: number } {
  let reasoningStartedAt: number | undefined
  let reasoningCompletedAt: number | undefined
  for (const record of stream) {
    if (record.type === 'reasoning-chunks') {
      const first = runFirstVisibleTime(record)
      if (first !== undefined && reasoningStartedAt === undefined) reasoningStartedAt = first
      continue
    }
    if (record.type === 'chunk') {
      if (record.chunk.type === 'block-end' && record.chunk.block.type === 'reasoning') {
        reasoningStartedAt ??= record.time
        continue
      }
      if (
        reasoningStartedAt !== undefined
        && record.chunk.type === 'block-end'
        && record.chunk.block.type === 'text'
      ) {
        reasoningCompletedAt ??= record.time
      }
      continue
    }
    if (record.type === 'text-chunks' && reasoningStartedAt !== undefined) {
      const firstText = runFirstTokenTime(record)
      if (firstText !== undefined) reasoningCompletedAt ??= firstText
    }
  }
  return {
    ...(reasoningStartedAt === undefined ? {} : { reasoningStartedAt }),
    ...(reasoningCompletedAt === undefined ? {} : { reasoningCompletedAt }),
  }
}

function teamMessageNode(
  team: TeamProjectionContext['team'],
  message: TeamMessage,
  seq: number,
  time: number,
): Extract<ConversationNode, { kind: 'team-message' }> {
  if (message.sender.kind === 'system') {
    return {
      id: message.id,
      kind: 'team-message',
      seq,
      time,
      text: message.content,
      senderName: 'Team event',
      senderId: message.sender.id,
      senderRole: 'system',
      messageType: message.type,
      ...(message.relatedTaskId === undefined ? {} : { relatedTaskId: message.relatedTaskId }),
    }
  }
  const current = team.members[message.sender.id]
  const retired = Object.values(team.retiredSessions)
    .find(session => session.formerSlotId === message.sender.id)
  return {
    id: message.id,
    kind: 'team-message',
    seq,
    time,
    text: message.content,
    senderName: current?.displayName ?? retired?.displayName ?? 'Removed member',
    senderId: message.sender.id,
    senderRole: message.sender.id === team.leaderSlotId ? 'leader' : 'member',
    messageType: message.type,
    ...(message.relatedTaskId === undefined ? {} : { relatedTaskId: message.relatedTaskId }),
  }
}

function isVisibleUserSource(source: MessageSource): boolean {
  return source.kind === 'user' || isAgentTeamRelaySource(source)
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => {
    if (block.type === 'text') return [block.text]
    if (block.type === 'image') return ['[image]']
    return []
  }).filter(Boolean).join('\n')
}

function reasoningOf(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'reasoning' ? [block.text] : []).join('\n')
}
