import {
  EDITING_CONTRACT_VERSION,
  type EditAuthor,
  type LiveEditPolicy,
} from '../../src/features/editing/index.ts'

export const DIGEST_A = `sha256:${'a'.repeat(64)}`
export const DIGEST_B = `sha256:${'b'.repeat(64)}`

export const planCapabilitySnapshot = Object.freeze({
  contract_version: EDITING_CONTRACT_VERSION,
  capability_id: 'edit.plan-draft',
  resource: { kind: 'plan_draft', id: 'plan-1' },
  current: { version: 'revision:7', digest: DIGEST_A },
  fields: [
    {
      path: '/objective',
      label: 'Objective',
      value_type: 'string',
      validation: { required: true, minLength: 3, maxLength: 200 },
      required_roles: ['editor'],
      required_capabilities: ['plan.write'],
      effect_class: 'draft',
      availability: 'available',
      sensitivity: 'normal',
    },
    {
      path: '/publish',
      label: 'Publish',
      value_type: 'boolean',
      validation: {},
      required_roles: ['editor'],
      required_capabilities: ['plan.publish'],
      effect_class: 'consequential',
      availability: 'available',
      sensitivity: 'normal',
    },
    {
      path: '/connector/token',
      label: 'TOP SECRET TOKEN LABEL',
      value_type: 'string',
      validation: { pattern: 'SECRET_PATTERN' },
      required_roles: ['admin'],
      required_capabilities: ['secret.read'],
      effect_class: 'consequential',
      availability: 'policy_denied',
      sensitivity: 'secret',
    },
  ],
  required_roles: ['editor'],
  required_capabilities: ['plan.write'],
  workflow: {
    draft_first: true,
    publish_mode: 'explicit_publish',
    direct_commit: 'policy_permitted_low_risk_draft',
  },
  reversibility: { mode: 'revert', requires_proposal: false },
  available: true,
  availability: 'available',
  policy_revision: 'policy:12',
})

export const immutableEvidenceSnapshot = Object.freeze({
  contract_version: EDITING_CONTRACT_VERSION,
  capability_id: 'edit.evidence',
  resource: { kind: 'evidence', id: 'evidence-1' },
  current: { version: 'revision:4', digest: DIGEST_A },
  fields: [],
  required_roles: [],
  required_capabilities: [],
  workflow: { draft_first: true, publish_mode: 'proposal_only', direct_commit: 'never' },
  reversibility: { mode: 'supersede', requires_proposal: true },
  available: true,
  availability: 'available',
  policy_revision: 'policy:12',
})

export const humanAuthor: EditAuthor = Object.freeze({
  kind: 'human', principalId: 'user-1', roles: ['editor'], capabilities: ['plan.write', 'plan.publish'],
})

export const agentAuthor: EditAuthor = Object.freeze({
  kind: 'agent', principalId: 'agent-1', delegatedBy: 'user-1', delegationId: 'delegation-1',
  delegatedCapabilityIds: ['edit.plan-draft'], roles: ['editor'], capabilities: ['plan.write', 'plan.publish'],
})

export const livePolicy: LiveEditPolicy = Object.freeze({
  revision: 'policy:12',
  active: true,
  principalRoles: ['editor'],
  principalCapabilities: ['plan.write', 'plan.publish'],
  permittedCapabilityIds: ['edit.plan-draft'],
  allowLowRiskDraftDirectCommit: true,
})
