export type PerspectiveId =
  | 'opensaddle.developer'
  | 'opensaddle.designer'
  | 'opensaddle.research-manager'
  | 'dialogue' | 'dispatch'

export type PerspectiveCapabilityId =
  | 'projection.trace-evidence.v1'
  | 'projection.kanban.v1'
  | 'projection.design-canvas.v1'
  | 'projection.research-brief.v1'
  | 'projection.project-runs.v1'

export interface PerspectiveDefinition {
  id: PerspectiveId
  version: string
  title: string
  description: string
  surfaceId: string
  requiredCapabilities: readonly PerspectiveCapabilityId[]
}

export type PerspectiveAvailability =
  | { status: 'enabled' }
  | { status: 'capability-unavailable'; missingCapabilities: readonly PerspectiveCapabilityId[] }

export interface CompiledPerspective extends PerspectiveDefinition {
  availability: PerspectiveAvailability
}
