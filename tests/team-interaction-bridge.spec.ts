import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AgentTeamError } from '../src/domain/errors.js'
import {
  normalizeQuestionAnswers,
  TeamInteractionBridge,
} from '../src/runtime/team-interaction-bridge.js'

describe('TeamInteractionBridge', () => {
  it('claims a user-question request of an owned session and answers it', async () => {
    const events = new FakeEvents()
    const onChange = vi.fn()
    const bridge = new TeamInteractionBridge(events.context, {
      acceptsSession: id => id === 'session-1',
      onChange,
    })
    bridge.start()
    const next = vi.fn(async () => ({ answers: [] }))
    const pending = events.ask('user-questions/request', {
      agent: { id: 'session-1' },
      questions: [{
        id: 'language',
        question: 'Which language?',
        options: [{ label: 'TypeScript', description: 'Recommended' }, { label: 'Rust' }],
      }],
    })

    expect(bridge.list('session-1')).toEqual([expect.objectContaining({
      kind: 'question',
      questions: [expect.objectContaining({
        id: 'language',
        options: [{ label: 'TypeScript', description: 'Recommended' }, { label: 'Rust' }],
      })],
    })])
    expect(onChange).toHaveBeenCalledWith('session-1')

    const id = bridge.list('session-1')[0]?.id ?? ''
    await bridge.respond('session-1', id, {
      kind: 'question',
      answers: [{ id: 'language', selected: ['TypeScript'] }],
    })

    await expect(pending).resolves.toEqual({
      answers: [{ id: 'language', selected: ['TypeScript'] }],
    })
    expect(next).not.toHaveBeenCalled()
    expect(bridge.list('session-1')).toEqual([])
    await bridge.dispose()
  })

  it('delegates a user-question request of a foreign session', async () => {
    const events = new FakeEvents()
    const bridge = new TeamInteractionBridge(events.context, {
      acceptsSession: id => id === 'session-1',
      onChange: vi.fn(),
    })
    bridge.start()
    const next = vi.fn(async () => ({ answers: [{ id: 'language', selected: ['Rust'] }] }))
    const pending = events.ask('user-questions/request', {
      agent: { id: 'other-session' },
      questions: [{ id: 'language', question: 'Which language?' }],
    }, next)

    await expect(pending).resolves.toEqual({ answers: [{ id: 'language', selected: ['Rust'] }] })
    expect(next).toHaveBeenCalledTimes(1)
    expect(bridge.list('other-session')).toEqual([])
    await bridge.dispose()
  })

  it('answers an approval request with the one-shot grant and clears the record', async () => {
    const events = new FakeEvents()
    const bridge = new TeamInteractionBridge(events.context, {
      acceptsSession: () => true,
      onChange: vi.fn(),
    })
    bridge.start()
    const pending = events.ask('approval/request', {
      agent: { id: 'session-2' },
      toolName: 'bash',
      callId: 'call-1',
      reason: 'Needs access to paths outside the workspace',
    })

    expect(bridge.list('session-2')).toEqual([expect.objectContaining({
      kind: 'approval',
      toolName: 'bash',
      callId: 'call-1',
      reason: 'Needs access to paths outside the workspace',
      approvalId: expect.any(String),
    })])

    const id = bridge.list('session-2')[0]?.id ?? ''
    await bridge.respond('session-2', id, { kind: 'approval', outcome: 'allowed-once' })

    await expect(pending).resolves.toBe('allowed-once')
    expect(bridge.list('session-2')).toEqual([])
    await bridge.dispose()
  })

  it('withdraws a pending approval when the request signal aborts', async () => {
    const events = new FakeEvents()
    const onChange = vi.fn()
    const bridge = new TeamInteractionBridge(events.context, {
      acceptsSession: () => true,
      onChange,
    })
    bridge.start()
    const controller = new AbortController()
    const pending = events.ask('approval/request', {
      agent: { id: 'session-3' },
      toolName: 'bash',
      signal: controller.signal,
    })
    expect(bridge.list('session-3')).toHaveLength(1)

    controller.abort()

    await expect(pending).rejects.toThrow('withdrawn')
    expect(bridge.list('session-3')).toEqual([])
    expect(onChange).toHaveBeenLastCalledWith('session-3')
    await bridge.dispose()
  })

  it('rejects an answer for an unknown interaction', async () => {
    const events = new FakeEvents()
    const bridge = new TeamInteractionBridge(events.context, {
      acceptsSession: () => true,
      onChange: vi.fn(),
    })
    bridge.start()
    await expect(bridge.respond('session-4', 'approval:missing', {
      kind: 'approval',
      outcome: 'rejected',
    })).rejects.toMatchObject({ code: 'INTERACTION_NOT_FOUND' })
    await bridge.dispose()
  })

  it('drops every pending interaction of a forgotten session', async () => {
    const events = new FakeEvents()
    const bridge = new TeamInteractionBridge(events.context, {
      acceptsSession: () => true,
      onChange: vi.fn(),
    })
    bridge.start()
    const pending = events.ask('approval/request', { agent: { id: 'session-5' }, toolName: 'bash' })
    bridge.forget('session-5')
    expect(bridge.list('session-5')).toEqual([])
    await expect(pending).rejects.toThrow('withdrawn')
    await bridge.dispose()
  })
})

describe('normalizeQuestionAnswers', () => {
  it('rejects incomplete and forged option answers', () => {
    const questions = [{
      id: 'model',
      question: 'Which model?',
      options: [{ label: 'DeepSeek' }, { label: 'GLM' }],
    }]
    expect(() => normalizeQuestionAnswers(questions, [])).toThrow(AgentTeamError)
    expect(() => normalizeQuestionAnswers(questions, [{
      id: 'model',
      selected: ['Unknown'],
    }])).toThrow('contains invalid options')
  })
})

/** Minimal cordis Context that records waterfall listeners so tests can dispatch them. */
class FakeEvents {
  private readonly listeners = new Map<string, (request: never, next: () => unknown) => unknown>()

  readonly context = {
    on: (name: string, listener: (request: never, next: () => unknown) => unknown) => {
      this.listeners.set(name, listener)
      return () => true
    },
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as Context

  /**
   * Dispatch one waterfall request through the registered listener.
   * @param name - cordis event name.
   * @param request - the pending request payload.
   * @param next - delegation continuation; defaults to a failing stub.
   * @returns the promise the answerer waterfall returned.
   */
  ask(
    name: string,
    request: Record<string, unknown>,
    next: () => unknown = () => {
      throw new Error(`agent-team delegated ${name}`)
    },
  ): Promise<unknown> {
    const listener = this.listeners.get(name)
    if (listener === undefined) throw new Error(`no listener registered for ${name}`)
    return Promise.resolve(listener(request as never, next))
  }
}
