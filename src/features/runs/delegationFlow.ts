import type { DelegationRequest, DelegationResult, RuntimeClient } from '../../services/contracts'
import type { AgentRunBlock, Message } from '../../types'

/** A placeholder or client-only run card must never become a delegator. */
export function selectAuthoritativeRootRun(messages: readonly Message[]): AgentRunBlock | undefined {
  return [...messages].reverse().find((message) =>
    message.run
    && !message.run.parentRunId
    && Boolean(message.runtimeRunId)
    && message.run.id === message.runtimeRunId)?.run
}

/**
 * Open an authoritative delegated Channel without fabricating client state.
 * The child must be hydrated before navigation so the route never observes a
 * missing or locally-created Channel.
 */
export async function createAndOpenDelegatedChannel(input: {
  runtime: Pick<RuntimeClient, 'delegate'>
  parentRunId: string
  request: DelegationRequest
  hydrateThread: (threadId: string) => Promise<unknown>
  navigate: (path: string) => void
}): Promise<DelegationResult> {
  const result = await input.runtime.delegate(input.parentRunId, input.request)
  await input.hydrateThread(result.childThreadId)
  input.navigate(`/chat/${result.childThreadId}`)
  return result
}
