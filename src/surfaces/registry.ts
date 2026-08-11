import type { ComponentType } from 'react'

export type SurfaceInputs = object

export interface SurfacePermissionGate {
  resourceKind: 'project'
  action: 'read'
}

export interface SurfaceDefinition<Id extends string, Inputs extends SurfaceInputs> {
  id: Id
  /** The complete, explicit data contract between the shell and this surface. */
  inputs: readonly (keyof Inputs & string)[]
  Component: ComponentType<Inputs>
  permission?: SurfacePermissionGate
  empty?: (inputs: Inputs) => boolean
  emptyState?: { title: string; description: string }
}

const surfaces = new Map<string, SurfaceDefinition<string, SurfaceInputs>>()

export function registerSurface<Id extends string, Inputs extends SurfaceInputs>(definition: SurfaceDefinition<Id, Inputs>) {
  if (surfaces.has(definition.id)) throw new Error(`Surface "${definition.id}" is already registered`)
  surfaces.set(definition.id, definition as unknown as SurfaceDefinition<string, SurfaceInputs>)
  return definition
}

export function getSurface(id: string) {
  return surfaces.get(id)
}

/** Clears registrations for isolated tests only. */
export function clearSurfaceRegistry() {
  surfaces.clear()
}
