export interface RunRecoverySupport { available: boolean; reason?: string }

export function negotiateRunRecovery(legacyHealthAvailable: boolean, v2CapabilitiesAvailable: boolean): RunRecoverySupport {
  if (legacyHealthAvailable) return { available: true }
  if (v2CapabilitiesAvailable) return { available: false, reason: 'Conversation task recovery is not advertised by this v2 control plane.' }
  return { available: false }
}
