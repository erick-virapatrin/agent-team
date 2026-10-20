import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { AgentTeamError } from '../domain/errors.js'
import type {
  InteractionResponseInput,
  PendingInteractionView,
  QuestionAnswerView,
  QuestionItemView,
} from '../transport/contracts.js'

interface PendingInteractionBase {
  id: string
  sessionId: string
  /** Settle the in-flight waterfall as withdrawn (request aborted, agent gone). */
  abandon: () => void
}

interface PendingQuestionRecord extends PendingInteractionBase {
  kind: 'question'
  questions: QuestionItemView[]
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: Error) => void
}

interface PendingApprovalRecord extends PendingInteractionBase {
  kind: 'approval'
  toolName: string
  callId?: string
  reason?: string
  resolve: (outcome: ApprovalOutcome) => void
  reject: (error: Error) => void
}

type PendingInteractionRecord = PendingQuestionRecord | PendingApprovalRecord

export interface TeamInteractionScope {
  acceptsSession: (sessionId: string) => boolean
  onChange: (sessionId: string) => void
}

/**
 * Answers the Harness approval and user-question seams for plugin-owned Agents.
 *
 * Harness 0.2.0 retired the client RPC multiplexer: a decision is a cordis
 * waterfall (`approval/request`, `user-questions/request`) that stays open
 * until an answerer claims it. This bridge claims the waterfall for its own
 * Sessions, publishes the pending item over SSE, and settles the waiting
 * promise when the workbench answers over HTTP.
 */
export class TeamInteractionBridge {
  private readonly records = new Map<string, PendingInteractionRecord>()
  private readonly scopes = new Set<TeamInteractionScope>()
  private disposeApprovalListener: (() => boolean) | undefined
  private disposeQuestionListener: (() => boolean) | undefined

  constructor(
    private readonly ctx: Context,
    scope?: TeamInteractionScope,
  ) {
    if (scope !== undefined) this.scopes.add(scope)
  }

  registerScope(scope: TeamInteractionScope): () => void {
    this.scopes.add(scope)
    return () => { this.scopes.delete(scope) }
  }

  start(): void {
    if (this.disposeApprovalListener !== undefined) return
    this.disposeApprovalListener = this.ctx.on('approval/request', (request, next) => (
      this.askApproval(request, next)
    ))
    this.disposeQuestionListener = this.ctx.on('user-questions/request', (request, next) => (
      this.askQuestions(request, next)
    ))
  }

  list(sessionId: string): PendingInteractionView[] {
    return [...this.records.values()]
      .filter(record => record.sessionId === sessionId)
      .map(toView)
  }

  forget(sessionId: string): void {
    for (const [id, record] of this.records) {
      if (record.sessionId === sessionId) this.withdraw(id)
    }
  }

  async respond(
    sessionId: string,
    interactionId: string,
    response: InteractionResponseInput,
  ): Promise<void> {
    const record = this.records.get(interactionId)
    if (record === undefined) {
      throw new AgentTeamError('INTERACTION_NOT_FOUND', 'This interaction request has ended or does not exist')
    }
    if (record.sessionId !== sessionId || !this.acceptsSession(sessionId)) {
      throw new AgentTeamError('INTERACTION_NOT_FOUND', 'This interaction request does not belong to the specified session')
    }
    if (record.kind === 'question') {
      if (response.kind !== 'question') {
        throw new AgentTeamError('INTERACTION_INVALID', 'The interaction response type does not match the pending request')
      }
      record.resolve({ answers: normalizeQuestionAnswers(record.questions, response.answers) })
    } else {
      if (response.kind !== 'approval') {
        throw new AgentTeamError('INTERACTION_INVALID', 'The interaction response type does not match the pending request')
      }
      record.resolve(response.outcome)
    }
    this.records.delete(interactionId)
    this.notifyChange(sessionId)
  }

  async dispose(): Promise<void> {
    this.disposeApprovalListener?.()
    this.disposeQuestionListener?.()
    this.disposeApprovalListener = undefined
    this.disposeQuestionListener = undefined
    for (const id of [...this.records.keys()]) this.withdraw(id)
  }

  /**
   * Claim one approval request for an owned Session, delegating every other one.
   * @param request - the pending approval decision.
   * @param next - delegate the decision to the remaining answerers.
   * @returns the human's outcome, or the delegated outcome.
   */
  private askApproval(
    request: ApprovalRequestEvent,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    const sessionId = String(request.agent.id)
    if (!this.acceptsSession(sessionId)) return next()
    const reason = request.displayReason?.en ?? request.reason
    return new Promise<ApprovalOutcome>((resolve, reject) => {
      const record: PendingApprovalRecord = {
        id: `approval:${randomUUID()}`,
        kind: 'approval',
        sessionId,
        toolName: request.toolName,
        ...(request.callId === undefined ? {} : { callId: String(request.callId) }),
        ...(reason === undefined ? {} : { reason }),
        resolve,
        reject,
        abandon: () => {
          reject(new Error('agent-team: the approval request was withdrawn'))
        },
      }
      this.attach(record, request.signal)
      this.notifyChange(sessionId)
    })
  }

  /**
   * Claim one user-question request for an owned Session, delegating every other one.
   * @param request - the pending questions.
   * @param next - delegate the questions to the remaining answerers.
   * @returns the human's answers, or the delegated answers.
   */
  private askQuestions(
    request: AskUserQuestionRequestEvent,
    next: () => Promise<AskUserQuestionAnswer>,
  ): Promise<AskUserQuestionAnswer> {
    const sessionId = request.agent === undefined ? undefined : String(request.agent.id)
    if (sessionId === undefined || !this.acceptsSession(sessionId)) return next()
    const questions = request.questions.map(toQuestionView)
    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      const record: PendingQuestionRecord = {
        id: `question:${randomUUID()}`,
        kind: 'question',
        sessionId,
        questions,
        resolve,
        reject,
        abandon: () => {
          reject(new Error('agent-team: the question request was withdrawn'))
        },
      }
      this.attach(record, request.signal)
      this.notifyChange(sessionId)
    })
  }

  private attach(record: PendingInteractionRecord, signal: AbortSignal | undefined): void {
    this.records.set(record.id, record)
    if (signal === undefined) return
    if (signal.aborted) {
      this.withdraw(record.id)
      return
    }
    signal.addEventListener('abort', () => { this.withdraw(record.id) }, { once: true })
  }

  private withdraw(id: string): void {
    const record = this.records.get(id)
    if (record === undefined) return
    this.records.delete(id)
    record.abandon()
    this.notifyChange(record.sessionId)
  }

  private acceptsSession(sessionId: string): boolean {
    return [...this.scopes].some(scope => scope.acceptsSession(sessionId))
  }

  private notifyChange(sessionId: string): void {
    for (const scope of this.scopes) {
      if (scope.acceptsSession(sessionId)) scope.onChange(sessionId)
    }
  }
}

export function normalizeQuestionAnswers(
  questions: readonly QuestionItemView[],
  answers: readonly QuestionAnswerView[],
): QuestionAnswerView[] {
  const byId = new Map<string, QuestionAnswerView>()
  for (const answer of answers) {
    if (byId.has(answer.id)) {
      throw new AgentTeamError('INTERACTION_INVALID', `Question "${answer.id}" has duplicate answers`)
    }
    byId.set(answer.id, answer)
  }
  if (byId.size !== questions.length) {
    throw new AgentTeamError('INTERACTION_INVALID', 'Answer every question before submitting')
  }
  return questions.map(question => {
    const answer = byId.get(question.id)
    if (answer === undefined) {
      throw new AgentTeamError('INTERACTION_INVALID', `Question "${question.id}" is missing an answer`)
    }
    const selected = [...answer.selected]
    if (new Set(selected).size !== selected.length) {
      throw new AgentTeamError('INTERACTION_INVALID', `Question "${question.id}" contains duplicate options`)
    }
    const allowed = new Set(question.options?.map(option => option.label) ?? [])
    if (selected.some(label => !allowed.has(label))) {
      throw new AgentTeamError('INTERACTION_INVALID', `Question "${question.id}" contains invalid options`)
    }
    const custom = answer.custom?.trim()
    if (question.multiSelect !== true && selected.length > 0 && custom !== undefined && custom.length > 0) {
      throw new AgentTeamError('INTERACTION_INVALID', `The custom answer for question "${question.id}" cannot be submitted together with an option`)
    }
    if (selected.length === 0 && (custom === undefined || custom.length === 0)) {
      throw new AgentTeamError('INTERACTION_INVALID', `Answer the question "${question.question}"`)
    }
    return {
      id: question.id,
      selected,
      ...(custom === undefined || custom.length === 0 ? {} : { custom }),
    }
  })
}

function toQuestionView(question: AskUserQuestionItem): QuestionItemView {
  return {
    id: question.id,
    question: question.question,
    ...(question.detail === undefined ? {} : { detail: question.detail }),
    ...(question.header === undefined ? {} : { header: question.header }),
    ...(question.options === undefined ? {} : {
      options: question.options.map(option => ({
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
      })),
    }),
    ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
    ...(question.intent === undefined ? {} : {
      intent: { kind: question.intent.kind, approve: question.intent.approve },
    }),
  }
}

function toView(record: PendingInteractionRecord): PendingInteractionView {
  if (record.kind === 'question') {
    return { id: record.id, kind: record.kind, questions: record.questions }
  }
  return {
    id: record.id,
    kind: record.kind,
    approvalId: record.id,
    toolName: record.toolName,
    ...(record.callId === undefined ? {} : { callId: record.callId }),
    ...(record.reason === undefined ? {} : { reason: record.reason }),
  }
}
