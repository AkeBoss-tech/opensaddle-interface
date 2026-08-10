export type EditingUnavailableCode =
  | 'unsupported_contract'
  | 'invalid_snapshot'
  | 'unavailable'
  | 'immutable_resource'
  | 'stale_resource'
  | 'policy_changed'
  | 'policy_denied'
  | 'delegation_denied'
  | 'validation_failed'
  | 'transport_unavailable'

const SAFE_MESSAGES: Readonly<Record<EditingUnavailableCode, string>> = Object.freeze({
  unsupported_contract: 'Editing is unavailable for this contract version.',
  invalid_snapshot: 'Editing is unavailable because the capability is invalid.',
  unavailable: 'Editing is currently unavailable.',
  immutable_resource: 'This record is immutable. Use an available correction workflow instead.',
  stale_resource: 'The resource changed. Compare with the latest version before continuing.',
  policy_changed: 'Editing policy changed. Refresh permissions before continuing.',
  policy_denied: 'Editing is not available under the active policy.',
  delegation_denied: 'The delegated author is not permitted to commit this edit.',
  validation_failed: 'The draft contains changes that cannot be submitted.',
  transport_unavailable: 'No authoritative edit transport is available.',
})

/** Typed, intentionally opaque failure for all fail-closed edit paths. */
export class EditingUnavailableError extends Error {
  readonly code: EditingUnavailableCode

  constructor(code: EditingUnavailableCode) {
    super(SAFE_MESSAGES[code])
    this.name = 'EditingUnavailableError'
    this.code = code
  }
}
