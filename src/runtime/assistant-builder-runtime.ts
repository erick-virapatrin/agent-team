import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from '../config.js'
import { AgentTeamError } from '../domain/errors.js'
import type { CreateAssistantInput } from '../domain/types.js'
import type { AgentTeamService } from '../service/agent-team-service.js'
import type {
  AssistantBuilderModelPreferenceStore,
  AssistantBuilderModelReference,
} from '../storage/assistant-builder-preferences.js'
import type {
  AssistantBuilderConversationListView,
  AssistantBuilderConversationSummary,
  AssistantBuilderConversationView,
  AssistantBuilderDraftView,
  InteractionResponseInput,
} from '../transport/contracts.js'
import { AssistantStreamTracker, projectConversation } from './conversation-projector.js'
import { liveSessionEvents, readPersistedSessionEvents } from './session-log.js'
import type { TeamInteractionBridge } from './team-interaction-bridge.js'

export const ASSISTANT_BUILDER_SESSION_ID = 'agent-team:assistant-builder'
const ASSISTANT_BUILDER_SESSION_PREFIX = `${ASSISTANT_BUILDER_SESSION_ID}:`
const ASSISTANT_BUILDER_DRAFT_ID = `${ASSISTANT_BUILDER_SESSION_PREFIX}draft`

export const ASSISTANT_BUILDER_PROMPT = `
You are the "Team Agent Assistant", responsible for helping users create reusable Agent assistant templates through conversation.

Working rules:
1. First understand the responsibilities, scope and boundaries, output style, and working conventions the user wants this assistant to take on.
2. Before creating, you must collect the name, Provider, model, Agent Preset, permission preset, and standing prompt. Collect the description as needed; the available Skills and MCP Servers are chosen by the user from the real catalog, and both may be left unselected.
3. You must first call assistant_builder_get_catalog to obtain the current real options; Provider, model, Preset and permission may only use identifiers that exist in the catalog, never fabricate them. After the model is chosen, call the catalog tool once more with provider and model to read the reasoning modes the model really supports; when no reasoning capability is returned, it must not be configured. After the Agent Preset is chosen, call the catalog tool once more with agentPresetId to obtain the Skills and MCP Servers available to that Preset.
4. When parameters are incomplete or the intent is ambiguous, prefer calling ask_user_question, asking one to three of the most critical questions at a time, and give brief options and suggestions based on the real catalog. When a question is open-ended, needs the user to describe details, or is just a normal explanation, you may output text directly in the user's language.
5. The standing prompt should describe stable responsibilities, constraints, workflow, and acceptance criteria; do not write in the one-off task currently in front of the user.
6. Only save the Skills and MCP Servers the user explicitly selected; not selected means not used, and names must not be guessed. Do not ask about or restrict ordinary tools; tool capabilities are provided by the Agent Preset.
7. Once the configuration is complete, call assistant_builder_prepare to validate and stage the draft; this step does not create the assistant, and a new draft replaces the older one.
8. Restate the final configuration in a concise list, and ask the user whether they confirm creating it. The user may express agreement in natural language, for example "confirm", "OK", "create it like this", "no problem, go ahead and create it"; do not require a fixed phrase. You must wait for a new user message, and must not confirm on the user's behalf in the same turn.
9. Only call assistant_builder_commit after the user has clearly expressed agreement with the current final configuration. If the user's reply is ambiguous, denies creating, raises a question, or asks to change the configuration, do not commit; first answer or modify the draft, show the final configuration again, and ask for confirmation.
10. After a successful creation, explicitly state the assistant name, and note that it can now join a team.
11. You may only help design and create assistant templates; do not create teams, do not modify or delete existing assistants, and do not perform Workspace tasks.

Reply in the user's language, be concise and proactive, but do not guess on the user's behalf parameters that would significantly affect cost, permissions, or capability scope.
`.trim()

interface AssistantBuilderConfiguration {
  provider: string
  model: string
  agentPresetId: string
  permissionPresetId: string
}

interface PendingAssistantDraft {
  input: CreateAssistantInput
  preparedThroughSeq: number
}

export class AssistantBuilderRuntime {
  private handle: AgentHandle | undefined
  private starting: Promise<AgentHandle> | undefined
  private reconfiguring: Promise<void> | undefined
  private switching: Promise<void> | undefined
  private activeSessionId: string | undefined
  private configuration: AssistantBuilderConfiguration | undefined
  private readonly configurations = new Map<string, AssistantBuilderConfiguration>()
  private readonly pendingDrafts = new Map<string, PendingAssistantDraft>()
  private publishTimer: ReturnType<typeof setTimeout> | undefined
  private readonly disposeStatusListener: () => void
  private readonly disposeConversationListener: () => void
  private readonly disposeStreamListener: () => void
  private readonly streams = new AssistantStreamTracker()
  private readonly disposeInteractionScope: () => void
  private closing = false

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly service: AgentTeamService,
    private readonly modelPreferences: AssistantBuilderModelPreferenceStore,
    private readonly interactions: TeamInteractionBridge,
  ) {
    this.disposeInteractionScope = interactions.registerScope({
      acceptsSession: isAssistantBuilderSessionId,
      onChange: sessionId => {
        if (sessionId === this.activeSessionId) this.publishCurrent()
      },
    })
    this.disposeStatusListener = ctx.on('agent/status', ({ agent }) => {
      if (String(agent.id) !== this.activeSessionId || this.closing) return
      this.publishCurrent()
    })
    this.disposeConversationListener = ctx.on('session/event', session => {
      this.schedulePublish(String(session.id))
    })
    this.disposeStreamListener = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      const sessionId = String(agent.id)
      this.streams.observe(sessionId, frame)
      if (frame.type === 'start') return
      this.schedulePublish(sessionId)
    })
  }

  /**
   * Coalesce conversation publishes of the active Assistant Builder session.
   * @param sessionId - the Session whose view is stale.
   * @returns nothing.
   */
  private schedulePublish(sessionId: string): void {
    if (sessionId !== this.activeSessionId || this.closing || this.publishTimer !== undefined) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined
      this.publishCurrent()
    }, 48)
  }

  async listConversations(): Promise<AssistantBuilderConversationListView> {
    const headers = (await this.ctx.sessionPersistence.list())
      .map(snapshot => snapshot.header)
      .filter(header => (
        isAssistantBuilderSessionId(String(header.id))
        && !this.isConversationArchived(String(header.id))
      ))
    const active = this.handle?.agent.session
    const ids = new Map<string, SessionHeader>(headers.map(header => [String(header.id), header]))
    if (
      active !== undefined
      && isAssistantBuilderSessionId(String(active.id))
      && !this.isConversationArchived(String(active.id))
    ) {
      ids.set(String(active.id), active.header)
    }
    const summaries = await Promise.all([...ids.entries()].map(async ([sessionId, header]) => {
      const events = active !== undefined && String(active.id) === sessionId
        ? liveSessionEvents(active)
        : await readPersistedSessionEvents(this.ctx.sessionPersistence, SessionId(sessionId))
      return summarizeConversation(sessionId, header.createdAt, events)
    }))
    const items = summaries.filter(item => item.state !== 'new')
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))
    return { items, total: items.length }
  }

  async getDraft(): Promise<AssistantBuilderDraftView> {
    return {
      schemaVersion: 1,
      configuration: await this.resolveConfiguration(ASSISTANT_BUILDER_DRAFT_ID),
    }
  }

  async configureDraft(rawProvider: string, rawModel: string): Promise<AssistantBuilderDraftView> {
    const provider = rawProvider.trim()
    const model = rawModel.trim()
    await this.validateModelReference(provider, model)
    await this.modelPreferences.setLastSelectedModel(provider, model)
    const configuration = await this.resolveConfiguration(ASSISTANT_BUILDER_DRAFT_ID)
    return { schemaVersion: 1, configuration: { ...configuration, provider, model } }
  }

  async startConversation(
    rawProvider: string,
    rawModel: string,
    rawContent: string,
  ): Promise<AssistantBuilderConversationView> {
    const provider = rawProvider.trim()
    const model = rawModel.trim()
    const content = rawContent.trim()
    if (content.length === 0) throw new AgentTeamError('INVALID_REQUEST', 'Message content is required')
    await this.validateModelReference(provider, model)
    const base = await this.resolveConfiguration(ASSISTANT_BUILDER_DRAFT_ID)
    const sessionId = `${ASSISTANT_BUILDER_SESSION_PREFIX}${randomUUID()}`
    const configuration = { ...base, provider, model }
    this.configurations.set(sessionId, configuration)
    await this.modelPreferences.setSelectedModel(sessionId, provider, model)
    const handle = await this.ensureOnline(sessionId, true)
    const message = createUserMessage({
      content: [{ type: 'text', text: content }],
      source: { kind: 'user' },
    })
    handle.agent.followup(message)
    return this.project(sessionId, liveSessionEvents(handle.agent.session), handle.agent.status)
  }

  async getConversation(rawSessionId: string): Promise<AssistantBuilderConversationView> {
    const sessionId = await this.requireExistingSessionId(rawSessionId)
    const handle = await this.ensureOnline(sessionId)
    return this.project(sessionId, liveSessionEvents(handle.agent.session), handle.agent.status)
  }

  async sendMessage(sessionId: string, rawContent: string): Promise<{ messageId: string }> {
    const content = rawContent.trim()
    if (content.length === 0) throw new AgentTeamError('INVALID_REQUEST', 'Message content is required')
    const handle = await this.ensureOnline(await this.requireExistingSessionId(sessionId))
    const message = createUserMessage({
      content: [{ type: 'text', text: content }],
      source: { kind: 'user' },
    })
    handle.agent.followup(message)
    return { messageId: String(message.id) }
  }

  async configure(sessionId: string, rawProvider: string, rawModel: string): Promise<AssistantBuilderConversationView> {
    if (this.closing) throw new Error('Assistant Builder runtime is closing')
    if (this.reconfiguring !== undefined) await this.reconfiguring
    const provider = rawProvider.trim()
    const model = rawModel.trim()
    if (provider.length === 0 || model.length === 0) {
      throw new AgentTeamError('INVALID_REQUEST', 'Assistant Builder provider and model are required')
    }
    const targetSessionId = await this.requireExistingSessionId(sessionId)
    const reconfiguring = this.reconfigure(targetSessionId, provider, model)
    this.reconfiguring = reconfiguring
    try {
      await reconfiguring
    } finally {
      if (this.reconfiguring === reconfiguring) this.reconfiguring = undefined
    }
    return this.getConversation(targetSessionId)
  }

  async stop(sessionId: string): Promise<void> {
    const handle = await this.ensureOnline(await this.requireExistingSessionId(sessionId))
    handle.agent.cancel({ kind: 'user' }, { keepInbox: false })
    await handle.agent.whenIdle()
    this.publishCurrent()
  }

  async respondToInteraction(
    rawSessionId: string,
    interactionId: string,
    response: InteractionResponseInput,
  ): Promise<void> {
    const sessionId = await this.requireExistingSessionId(rawSessionId)
    await this.ensureOnline(sessionId)
    if (this.activeSessionId !== sessionId) {
      throw new AgentTeamError('INTERACTION_NOT_FOUND', 'This interaction request does not belong to the current Team Agent Assistant session')
    }
    await this.interactions.respond(sessionId, interactionId, response)
  }

  async archiveConversation(rawSessionId: string): Promise<void> {
    if (this.closing) throw new Error('Assistant Builder runtime is closing')
    await this.reconfiguring?.catch(() => undefined)
    await this.switching?.catch(() => undefined)
    await this.starting?.catch(() => undefined)
    const sessionId = rawSessionId.trim()
    if (!isAssistantBuilderSessionId(sessionId)) {
      throw new AgentTeamError('INVALID_REQUEST', `Invalid Assistant Builder conversation '${sessionId}'`)
    }
    if (this.isConversationArchived(sessionId)) return
    const current = sessionId === this.activeSessionId ? this.handle : undefined
    if (current?.agent.status === 'running') {
      throw new AgentTeamError('INVALID_REQUEST', 'Stop the current Team Agent Assistant reply before archiving the session')
    }
    await this.ctx.workspaceRegistry.archiveSession(SessionId(sessionId))
    if (current !== undefined) {
      await this.ctx.sessions.flush(current.agent.session)
      await current.dispose()
      if (this.handle === current) this.handle = undefined
      this.activeSessionId = undefined
      this.configuration = undefined
    }
    this.configurations.delete(sessionId)
    this.pendingDrafts.delete(sessionId)
  }

  async dispose(): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.disposeStatusListener()
    this.disposeConversationListener()
    this.disposeStreamListener()
    this.disposeInteractionScope()
    if (this.publishTimer !== undefined) clearTimeout(this.publishTimer)
    if (this.activeSessionId !== undefined) this.streams.clear(this.activeSessionId)
    this.publishTimer = undefined
    await this.reconfiguring?.catch(() => undefined)
    await this.switching?.catch(() => undefined)
    await this.starting?.catch(() => undefined)
    const handle = this.handle
    if (handle === undefined) return
    handle.agent.cancel({ kind: 'disposed' }, { keepInbox: true })
    await handle.agent.whenIdle().catch(() => undefined)
    try {
      await this.ctx.sessions.flush(handle.agent.session)
    } catch (error) {
      this.ctx.logger.warn('agent-team: assistant builder session flush failed', error)
    }
    await handle.dispose()
    this.handle = undefined
  }

  private async ensureOnline(sessionId: string, allowCreate = false): Promise<AgentHandle> {
    if (this.closing) throw new Error('Assistant Builder runtime is closing')
    if (this.reconfiguring !== undefined) await this.reconfiguring
    await this.activate(sessionId)
    if (this.handle !== undefined && this.activeSessionId === sessionId) return this.handle
    if (this.starting !== undefined) return this.starting
    const starting = this.start(sessionId, allowCreate)
    this.starting = starting
    try {
      const handle = await starting
      this.handle = handle
      return handle
    } catch (error) {
      if (error instanceof AgentTeamError) throw error
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`agent-team: assistant builder activation failed: ${message}`, error)
      throw new AgentTeamError(
        'SESSION_CREATE_FAILED',
        `Failed to start the Team Agent Assistant: ${message}`,
        { cause: message },
        { cause: error },
      )
    } finally {
      if (this.starting === starting) this.starting = undefined
    }
  }

  private async activate(sessionId: string): Promise<void> {
    if (this.activeSessionId === sessionId) return
    if (this.switching !== undefined) await this.switching
    if (this.activeSessionId === sessionId) return
    const switching = this.switchSession(sessionId)
    this.switching = switching
    try {
      await switching
    } finally {
      if (this.switching === switching) this.switching = undefined
    }
  }

  private async switchSession(sessionId: string): Promise<void> {
    await this.starting?.catch(() => undefined)
    const current = this.handle
    if (current?.agent.status === 'running') {
      throw new AgentTeamError('INVALID_REQUEST', 'Stop the current assistant reply before switching sessions')
    }
    if (current !== undefined) {
      await this.ctx.sessions.flush(current.agent.session)
      await current.dispose()
    }
    this.handle = undefined
    this.configuration = this.configurations.get(sessionId)
    this.activeSessionId = sessionId
  }

  private async reconfigure(sessionId: string, provider: string, model: string): Promise<void> {
    await this.validateModelReference(provider, model)
    await this.activate(sessionId)
    await this.starting?.catch(() => undefined)
    const current = this.handle
    if (current !== undefined && current.agent.status === 'running') {
      throw new AgentTeamError(
        'INVALID_REQUEST',
        'Stop the current Team Agent Assistant reply before switching models',
      )
    }
    if (
      this.configuration?.provider === provider
      && this.configuration.model === model
    ) return

    await this.modelPreferences.setSelectedModel(sessionId, provider, model)

    if (current !== undefined) {
      await this.ctx.sessions.flush(current.agent.session)
      await current.dispose()
      if (this.handle === current) this.handle = undefined
    }
    const currentConfiguration = this.configuration ?? await this.resolveConfiguration(sessionId)
    const nextConfiguration = { ...currentConfiguration, provider, model }
    this.configurations.set(sessionId, nextConfiguration)
    this.configuration = nextConfiguration
  }

  private async start(rawSessionId: string, allowCreate: boolean): Promise<AgentHandle> {
    const sessionId = SessionId(rawSessionId)
    const cwd = process.cwd()
    if (this.ctx.agents.get(sessionId) !== undefined) {
      throw new AgentTeamError(
        'AGENT_HANDLE_OWNERSHIP_CONFLICT',
        `Session '${rawSessionId}' is live without this plugin's AgentHandle`,
      )
    }
    const configuration = this.configurations.get(rawSessionId) ?? await this.resolveConfiguration(rawSessionId)
    this.configurations.set(rawSessionId, configuration)
    this.configuration = configuration
    const rememberedModel = this.modelPreferences.getConversationModel(rawSessionId)
    if (
      rememberedModel?.provider !== configuration.provider
      || rememberedModel.model !== configuration.model
    ) {
      await this.modelPreferences.setConversationModel(
        rawSessionId,
        configuration.provider,
        configuration.model,
      )
    }
    const setup = async (agentCtx: Context, agent: Agent): Promise<void> => {
      await this.ctx.agentPresets.mount(agentCtx, configuration.agentPresetId)
      agentCtx.tools.presentAs('native')
      if (agent.session.header.cwd === undefined) {
        agentCtx.systemPrompt.variable('cwd', () => cwd)
      }
      const allowedTools = new Set([
        'assistant_builder_get_catalog',
        'assistant_builder_prepare',
        'assistant_builder_commit',
        'ask_user_question',
      ])
      agentCtx.tools.guard(execution => allowedTools.has(execution.name)
        ? undefined
        : 'The built-in Assistant Builder may only read its catalog, prepare a draft, and commit an explicitly confirmed draft.')
      this.registerTools(agentCtx, rawSessionId)
      const deniedTools = agentCtx.tools.schemas(agent)
        .map(tool => tool.name)
        .filter(name => !allowedTools.has(name))
      if (deniedTools.length > 0) agentCtx.tools.restrict({ deny: deniedTools })
      const promptSection = 'agent-team:assistant-builder'
      agentCtx.systemPrompt.section({
        name: promptSection,
        order: 10,
        text: ASSISTANT_BUILDER_PROMPT,
      })
      this.ctx.permissionPresets.set(agent.session, configuration.permissionPresetId)
      const assembly = await agentCtx.systemPrompt.assemble(assembleContextFor(agent))
      if (!assembly.sections.some(section => section.name === promptSection)) {
        throw new AgentTeamError(
          'PRESET_PROMPT_INCOMPATIBLE',
          `Preset '${configuration.agentPresetId}' replaced the Assistant Builder prompt`,
        )
      }
    }
    const agentOptions = { provider: configuration.provider, model: configuration.model }
    const persisted = (await this.ctx.sessionPersistence.list())
      .some(snapshot => String(snapshot.header.id) === rawSessionId)
    if (!persisted && !allowCreate) {
      throw new AgentTeamError('INVALID_REQUEST', `Unknown Assistant Builder conversation '${rawSessionId}'`)
    }
    return persisted
      ? this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
      : this.ctx.agents.create({
        sessionId,
        meta: { cwd, agentPreset: configuration.agentPresetId },
        agentOptions,
        setup,
      })
  }

  private async resolveConfiguration(sessionId: string): Promise<AssistantBuilderConfiguration> {
    const selected = this.configurations.get(sessionId)
    const persisted = selected === undefined
      ? this.modelPreferences.getConversationModel(sessionId)
        ?? this.modelPreferences.getLastSelectedModel()
      : undefined
    const persistedModel = persisted === undefined
      ? undefined
      : await this.resolvePersistedModel(persisted)
    const requestedProvider = selected?.provider
      ?? persistedModel?.provider
      ?? this.config.assistantBuilderProvider.trim()
    const requestedModel = selected?.model
      ?? persistedModel?.model
      ?? this.config.assistantBuilderModel.trim()
    if (requestedModel.length > 0 && requestedProvider.length === 0) {
      throw new AgentTeamError('INVALID_REQUEST', 'assistantBuilderModel requires assistantBuilderProvider')
    }
    const providers = this.ctx.llm.listProviders()
    const candidates = requestedProvider.length > 0
      ? providers.filter(provider => provider.id === requestedProvider)
      : providers
    if (candidates.length === 0) {
      throw new AgentTeamError(
        'MODEL_REFERENCE_INVALID',
        requestedProvider.length > 0
          ? `Unknown Assistant Builder provider '${requestedProvider}'`
          : 'No model provider is available for the Assistant Builder',
      )
    }

    let provider = ''
    let model = ''
    for (const candidate of candidates) {
      const models = await this.ctx.llm.listModels(candidate.id)
      const selected = requestedModel.length > 0
        ? models.find(item => item.id === requestedModel)
        : models[0]
      if (selected === undefined) continue
      provider = candidate.id
      model = selected.id
      break
    }
    if (provider.length === 0 || model.length === 0) {
      throw new AgentTeamError(
        'MODEL_REFERENCE_INVALID',
        requestedModel.length > 0
          ? `Unknown Assistant Builder model '${requestedProvider}/${requestedModel}'`
          : 'No catalog model is available for the Assistant Builder',
      )
    }
    await this.ctx.llm.resolveModelInfo(provider, model)

    const agentPresetId = this.config.assistantBuilderAgentPresetId.trim() || this.ctx.agentPresets.defaultId
    await this.ctx.agentPresets.resolve(agentPresetId)
    const permissionPresetId = this.config.assistantBuilderPermissionPresetId.trim()
      || (this.ctx.permissionPresets.names.includes('read-only')
        ? 'read-only'
        : this.ctx.permissionPresets.defaultPreset)
    if (!this.ctx.permissionPresets.names.includes(permissionPresetId)) {
      throw new AgentTeamError(
        'PERMISSION_PRESET_INVALID',
        `Unknown Assistant Builder permission preset '${permissionPresetId}'`,
      )
    }
    return { provider, model, agentPresetId, permissionPresetId }
  }

  private async resolvePersistedModel(
    preference: AssistantBuilderModelReference,
  ): Promise<AssistantBuilderModelReference | undefined> {
    try {
      await this.ctx.llm.resolveModelInfo(preference.provider, preference.model)
      return preference
    } catch (error) {
      this.ctx.logger.warn(
        `agent-team: saved Assistant Builder model '${preference.provider}/${preference.model}' is unavailable; falling back`,
        error,
      )
      return undefined
    }
  }

  private async validateModelReference(provider: string, model: string): Promise<void> {
    if (provider.length === 0 || model.length === 0) {
      throw new AgentTeamError('INVALID_REQUEST', 'Assistant Builder provider and model are required')
    }
    try {
      await this.ctx.llm.resolveModelInfo(provider, model)
    } catch (error) {
      throw new AgentTeamError(
        'MODEL_REFERENCE_INVALID',
        `Cannot resolve Assistant Builder model '${provider}/${model}'`,
        undefined,
        { cause: error },
      )
    }
  }

  private async requireExistingSessionId(rawSessionId: string): Promise<string> {
    const sessionId = rawSessionId.trim()
    if (!isAssistantBuilderSessionId(sessionId)) {
      throw new AgentTeamError('INVALID_REQUEST', `Invalid Assistant Builder conversation '${sessionId}'`)
    }
    if (this.isConversationArchived(sessionId)) {
      throw new AgentTeamError('INVALID_REQUEST', `Unknown Assistant Builder conversation '${sessionId}'`)
    }
    if (sessionId === this.activeSessionId) return sessionId
    const exists = (await this.ctx.sessionPersistence.list())
      .some(snapshot => String(snapshot.header.id) === sessionId)
    if (!exists) {
      throw new AgentTeamError('INVALID_REQUEST', `Unknown Assistant Builder conversation '${sessionId}'`)
    }
    return sessionId
  }

  private isConversationArchived(sessionId: string): boolean {
    return this.ctx.workspaceRegistry.archivedSessionIds
      .some(archivedSessionId => String(archivedSessionId) === sessionId)
  }

  private registerTools(agentCtx: Context, sessionId: string): void {
    agentCtx.tools.register(defineTool({
      name: 'assistant_builder_get_catalog',
      description: 'Read exact creation options. Pass provider and model after choosing a model to read its reasoning efforts. Pass agentPresetId to read its Skills and MCP Servers.',
      parameters: {
        provider: { type: 'string', description: 'Chosen Provider id; pass together with model.' },
        model: { type: 'string', description: 'Chosen model id; pass together with provider.' },
        agentPresetId: { type: 'string', description: 'Chosen Agent Preset id used to discover available Skills and MCP Servers.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        this.assertToolIdentity(exec.agent?.id, sessionId)
        const catalog = await this.service.catalog()
        const skillCatalog = args.agentPresetId === undefined
          ? undefined
          : await this.service.skillCatalog(args.agentPresetId)
        const mcpCatalog = args.agentPresetId === undefined
          ? undefined
          : await this.service.mcpCatalog(args.agentPresetId)
        if ((args.provider === undefined) !== (args.model === undefined)) {
          throw new AgentTeamError('INVALID_REQUEST', 'Provider and model must be supplied together')
        }
        const modelCapabilities = args.provider === undefined || args.model === undefined
          ? undefined
          : await this.service.modelCapabilities(args.provider, args.model)
        return {
          providers: catalog.providers.map(provider => ({ id: provider.id, name: provider.name })),
          models: catalog.models,
          agentPresets: catalog.agentPresets.filter(preset => preset.broken === undefined),
          permissionPresets: catalog.permissionPresets.map(preset => ({
            value: preset.value,
            name: preset.name,
            ...(preset.description === undefined ? {} : { description: preset.description }),
          })),
          existingAssistants: this.service.listAssistants().items.map(assistant => assistant.name),
          ...(modelCapabilities === undefined ? {} : {
            modelCapabilities: {
              provider: modelCapabilities.provider,
              model: modelCapabilities.model,
              ...(modelCapabilities.reasoning === undefined ? {} : {
                reasoning: {
                  efforts: modelCapabilities.reasoning.efforts.map(effort => ({ ...effort })),
                  ...(modelCapabilities.reasoning.defaultEffort === undefined
                    ? {}
                    : { defaultEffort: modelCapabilities.reasoning.defaultEffort }),
                },
              }),
            },
          }),
          ...(skillCatalog === undefined ? {} : { skills: skillCatalog.skills }),
          ...(mcpCatalog === undefined ? {} : {
            mcpServers: mcpCatalog.servers.map(server => ({
              name: server.name,
              toolCount: server.tools.length,
              tools: server.tools,
            })),
          }),
        }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'assistant_builder_prepare',
      description: 'Validate and temporarily store one complete assistant draft. Replaces any older draft; this tool does not create the assistant.',
      parameters: {
        name: { type: 'string', required: true, description: 'Unique, user-facing assistant name.' },
        description: { type: 'string', description: 'Short user-facing purpose.' },
        instructions: { type: 'string', required: true, description: 'Stable responsibilities, constraints, workflow, and acceptance rules.' },
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
        reasoningEffort: {
          type: 'string',
          description: 'Optional exact reasoning effort id returned by modelCapabilities. Omit to use the model default.',
        },
        agentPresetId: { type: 'string', required: true },
        permissionPresetId: { type: 'string', required: true },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact Skill names explicitly selected by the user from the chosen preset catalog.',
        },
        mcpServers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact MCP Server names explicitly selected by the user from the chosen preset catalog.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{
          type: 'text',
          text: `Draft "${value.name}" has been validated. Present the final configuration, and wait for the user to explicitly agree to the creation in a new message; the user may express it in natural language, no fixed phrase is required.`,
        }],
      },
      execute: async (args, exec) => {
        this.assertToolIdentity(exec.agent?.id, sessionId)
        if (exec.agent === undefined) {
          throw new AgentTeamError('INVALID_REQUEST', 'Assistant Builder Agent is unavailable')
        }
        const input = await this.service.validateAssistantDraft({
          name: args.name,
          ...(args.description === undefined ? {} : { description: args.description }),
          instructions: args.instructions,
          provider: args.provider,
          model: args.model,
          ...(args.reasoningEffort === undefined ? {} : { reasoningEffort: args.reasoningEffort }),
          agentPresetId: args.agentPresetId,
          permissionPresetId: args.permissionPresetId,
          skillAllowlist: args.skills ?? [],
          mcpServers: args.mcpServers ?? [],
        })
        this.pendingDrafts.set(sessionId, {
          input,
          preparedThroughSeq: liveSessionEvents(exec.agent.session).at(-1)?.seq ?? -1,
        })
        return {
          name: input.name,
          requiresExplicitUserConfirmation: true,
        }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'assistant_builder_commit',
      description: 'Create the currently prepared assistant only after a later, real user message clearly approves the final configuration. Natural-language approval is allowed; ambiguity, rejection, questions, or requested changes are not approval.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            revision: { type: 'number', required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: `Assistant "${value.name}" has been created.` }],
      },
      execute: async (_args, exec) => {
        this.assertToolIdentity(exec.agent?.id, sessionId)
        if (exec.agent === undefined) {
          throw new AgentTeamError('INVALID_REQUEST', 'Assistant Builder Agent is unavailable')
        }
        const pending = this.pendingDrafts.get(sessionId)
        if (pending === undefined) {
          throw new AgentTeamError(
            'INVALID_REQUEST',
            'No assistant draft is awaiting confirmation; validate the draft again first',
          )
        }
        if (!hasFreshAssistantDraftUserResponse(
          liveSessionEvents(exec.agent.session),
          pending.preparedThroughSeq,
        )) {
          throw new AgentTeamError(
            'INVALID_REQUEST',
            'You must wait for the user to explicitly agree to the current assistant configuration in a new message',
          )
        }
        const assistant = await this.service.createAssistant(pending.input)
        if (this.pendingDrafts.get(sessionId) === pending) this.pendingDrafts.delete(sessionId)
        return { id: assistant.id, name: assistant.name, revision: assistant.revision }
      },
    }))
  }

  private assertToolIdentity(id: unknown, sessionId: string): void {
    if (String(id) !== sessionId || !isAssistantBuilderSessionId(sessionId)) {
      throw new AgentTeamError('INVALID_REQUEST', 'Assistant Builder tool called outside its owned Agent')
    }
  }

  private project(
    sessionId: string,
    events: readonly SessionEvent[],
    status: 'idle' | 'running',
  ): AssistantBuilderConversationView {
    if (this.configuration === undefined) throw new Error('Assistant Builder configuration is unavailable')
    return {
      schemaVersion: 1,
      sessionId,
      status,
      pendingInteractions: this.interactions.list(sessionId),
      ...projectConversation(events, 240, undefined, this.streams.list(sessionId)),
      configuration: this.configuration,
    }
  }

  private publishCurrent(): void {
    const handle = this.handle
    const sessionId = this.activeSessionId
    if (handle === undefined || sessionId === undefined || this.configuration === undefined || this.closing) return
    this.service.publishAssistantBuilderConversation(
      this.project(sessionId, liveSessionEvents(handle.agent.session), handle.agent.status),
    )
  }
}

export function hasFreshAssistantDraftUserResponse(
  events: readonly SessionEvent[],
  preparedThroughSeq: number,
): boolean {
  const latestUserMessage = events.findLast(event => (
    event.seq > preparedThroughSeq
    && event.type === 'user/message'
    && event.data.source.kind === 'user'
  ))
  return latestUserMessage?.type === 'user/message'
}

function isAssistantBuilderSessionId(sessionId: string): boolean {
  return sessionId === ASSISTANT_BUILDER_SESSION_ID
    || sessionId.startsWith(ASSISTANT_BUILDER_SESSION_PREFIX)
}

function summarizeConversation(
  sessionId: string,
  createdAt: number,
  events: readonly SessionEvent[],
): AssistantBuilderConversationSummary {
  const projection = projectConversation(events, Number.MAX_SAFE_INTEGER)
  const firstUser = projection.nodes.find(node => node.kind === 'user')
  const lastUserSeq = projection.nodes.reduce((latest, node) => (
    node.kind === 'user' ? Math.max(latest, node.seq) : latest
  ), -1)
  const lastCommitSeq = projection.nodes.reduce((latest, node) => (
    node.kind === 'tool'
    && node.name === 'assistant_builder_commit'
    && node.status === 'success'
      ? Math.max(latest, node.seq)
      : latest
  ), -1)
  const lastEventAt = events.at(-1)?.time ?? createdAt
  return {
    sessionId,
    title: firstUser?.kind === 'user' ? conversationTitle(firstUser.text) : 'New conversation',
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(lastEventAt).toISOString(),
    state: lastUserSeq < 0
      ? 'new'
      : lastCommitSeq >= lastUserSeq
        ? 'completed'
        : 'in_progress',
  }
}

function conversationTitle(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length <= 28 ? compact : `${compact.slice(0, 28)}…`
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}
