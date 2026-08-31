import type {
  CompiledPerspective,
  PerspectiveCapabilityId,
  PerspectiveDefinition,
} from './contracts'

export const BUILTIN_PERSPECTIVES = [
  {
    id: 'opensaddle.developer',
    version: '1.0.0',
    title: 'Developer',
    description: 'Trace execution evidence and follow active work through a derived project board.',
    surfaceId: 'developer-perspective',
    requiredCapabilities: ['projection.trace-evidence.v1', 'projection.kanban.v1'],
  },
  {
    id: 'opensaddle.designer',
    version: '1.0.0',
    title: 'Designer',
    description: 'Explore screens, journeys, and visual artifacts with their source context.',
    surfaceId: 'designer-perspective',
    requiredCapabilities: ['projection.design-canvas.v1'],
  },
  {
    id: 'opensaddle.research-manager',
    version: '1.0.0',
    title: 'Research manager',
    description: 'Review claims, evidence quality, research progress, and decision-ready briefs.',
    surfaceId: 'research-manager-perspective',
    requiredCapabilities: ['projection.research-brief.v1'],
  },
] as const satisfies readonly PerspectiveDefinition[]

export const BUILTIN_PERSPECTIVE_CAPABILITIES = new Set<PerspectiveCapabilityId>([
  'projection.trace-evidence.v1',
  'projection.kanban.v1',
])

export function compilePerspectiveCatalog(
  definitions: readonly PerspectiveDefinition[],
  availableCapabilities: ReadonlySet<PerspectiveCapabilityId>,
): CompiledPerspective[] {
  const seen = new Set<string>()
  return definitions.map((definition) => {
    if (seen.has(definition.id)) throw new Error(`Duplicate perspective id: ${definition.id}`)
    seen.add(definition.id)
    const missingCapabilities = definition.requiredCapabilities.filter((capability) => !availableCapabilities.has(capability))
    return {
      ...definition,
      availability: missingCapabilities.length
        ? { status: 'capability-unavailable' as const, missingCapabilities }
        : { status: 'enabled' as const },
    }
  })
}

export const COMPILED_BUILTIN_PERSPECTIVES = compilePerspectiveCatalog(
  BUILTIN_PERSPECTIVES,
  BUILTIN_PERSPECTIVE_CAPABILITIES,
)

export function getPerspective(id: string) {
  return COMPILED_BUILTIN_PERSPECTIVES.find((perspective) => perspective.id === id)
}
