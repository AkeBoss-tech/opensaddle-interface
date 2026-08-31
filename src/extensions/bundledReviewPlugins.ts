export interface BundledReviewPlugin {
  id: string
  version: string
  title: string
  description: string
  surfaceId: string
  bundled: true
  authority: 'projection-only'
  capabilities: readonly string[]
}

export const SESSION_AUDIT_PLUGIN = {
  id: 'opensaddle.session-audit',
  version: '1.0.0',
  title: 'Session Audit',
  description: 'Evidence-aware project review analytics with a governed, harness-selectable audit action.',
  surfaceId: 'session-audit-review',
  bundled: true,
  authority: 'projection-only',
  capabilities: [
    'projection.agent-session-analytics.v1',
    'projection.prompt-patterns.v1',
    'action.project-audit.v1',
  ],
} as const satisfies BundledReviewPlugin

export const BUNDLED_REVIEW_PLUGINS = [SESSION_AUDIT_PLUGIN] as const

export function getBundledReviewPlugin(id: string) {
  return BUNDLED_REVIEW_PLUGINS.find((plugin) => plugin.id === id)
}
