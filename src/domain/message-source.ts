import type { ContextFormed } from '@deepseek-ai/dsh-llm'

/**
 * The plugin's own message source.
 *
 * Harness 0.2.0 removed the shared `plugin` message-source kind: every producer
 * now declares its own `kind` through {@link MessageSourceMap}. `agent-team`
 * keeps the two fields the plugin has always written (`plugin`, `form`) so
 * messages relayed into member sessions stay attributable.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-team': {
      readonly kind: 'agent-team'
      readonly plugin: string
    } & ContextFormed
  }
}

export const AGENT_TEAM_SOURCE_PLUGIN = 'dsh-agent-team'

export const AGENT_TEAM_MESSAGE_SOURCE = {
  kind: 'agent-team',
  plugin: AGENT_TEAM_SOURCE_PLUGIN,
  form: 'relay',
} as const

/**
 * Whether a user-role message was relayed by this plugin.
 *
 * Session logs written before the port carry the removed `plugin` source kind,
 * so the legacy shape stays readable; new writes use `agent-team`.
 * @param source - any message source.
 * @returns true when the plugin produced the message as a relay.
 */
export function isAgentTeamRelaySource(
  source: { readonly kind: string; readonly plugin?: string },
): boolean {
  if (source.kind === 'agent-team') return source.plugin === AGENT_TEAM_SOURCE_PLUGIN
  if (source.kind !== 'plugin') return false
  return source.plugin === AGENT_TEAM_SOURCE_PLUGIN
}
