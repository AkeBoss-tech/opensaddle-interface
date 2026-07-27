import type { Chat } from '../types'

export type NativeContinuationProvider = NonNullable<Chat['continuation']>['provider']

export function adoptNativeContinuation(input: {
  existing?: Chat['continuation']
  sessionId: string
  checkpointId?: string
  provider?: NativeContinuationProvider
  sourcePath: string
}): Chat['continuation'] {
  const base = input.existing ?? (input.provider ? {
    provider: input.provider,
    sourcePath: input.sourcePath,
    authority: 'opensaddle_managed' as const,
  } : undefined)
  if (!base) return undefined
  return {
    ...base,
    sessionId: input.sessionId,
    checkpointId: input.checkpointId,
    mode: 'resume',
  }
}
