import type { ModelKey } from '../types.js'
import type { HarnessProfile } from './types.js'

/** Resolve the CLI-native model id for a harness + OpenSaddle model key. */
export function resolveCliModel(
  profile: HarnessProfile,
  modelKey: Exclude<ModelKey, 'auto'>,
  fallbackModelName?: string,
): string | undefined {
  if (!profile.modelFlag) return undefined
  return profile.modelIds?.[modelKey] ?? fallbackModelName ?? modelKey
}
