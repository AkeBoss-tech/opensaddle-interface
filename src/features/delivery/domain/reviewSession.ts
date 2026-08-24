import type { EditSession, EditSubmissionProjection } from '../../editing'
import { GovernedDeliveryValidationError, type DeliveryReviewSessionBinding } from './contracts'

/**
 * Binds delivery review state to the reviewed shared edit-command surface.
 * This deliberately exposes no submit/approve/execute callback: callers must
 * continue through src/features/editing's authoritative command adapter.
 */
export function bindDeliveryReviewSession(
  session: EditSession,
  submission: EditSubmissionProjection,
): DeliveryReviewSessionBinding {
  if (session.resource.kind !== 'thread' && session.resource.kind !== 'plan_draft') {
    throw new GovernedDeliveryValidationError('authority_mismatch')
  }
  if (session.state !== 'ready'
    || session.conflict.status !== 'current'
    || submission.command.capabilityId !== session.capabilityId
    || submission.command.resource.kind !== session.resource.kind
    || submission.command.resource.id !== session.resource.id
    || submission.command.expected.version !== session.base.version
    || submission.command.expected.digest !== session.base.digest
    || submission.command.policyRevision !== session.policyRevision) {
    throw new GovernedDeliveryValidationError('authority_mismatch')
  }
  return Object.freeze({ session, submission, transport: 'shared_edit_command_only' })
}
