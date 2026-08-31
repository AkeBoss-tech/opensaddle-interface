import React from 'react'
import type { PermissionClient } from '../services/contracts'
import type { SurfaceInputs } from '../surfaces/registry'
import { SurfaceHost } from '../ui/SurfaceHost'
import type { CompiledPerspective } from './contracts'

// Node's lightweight test runner compiles JSX in classic mode.
void React

export interface PerspectiveHostProps<Inputs extends SurfaceInputs> {
  perspective: CompiledPerspective
  projectId: string
  inputs: Inputs
  permissions?: PermissionClient
  userId?: string
}

function capabilityLabel(capability: string) {
  return capability
    .replace(/^projection\./, '')
    .replace(/\.v\d+$/, '')
    .replaceAll('-', ' ')
}

export function PerspectiveHost<Inputs extends SurfaceInputs>({
  perspective,
  projectId,
  inputs,
  permissions,
  userId,
}: PerspectiveHostProps<Inputs>) {
  if (perspective.availability.status === 'capability-unavailable') {
    return (
      <section className="os-perspective-unavailable" role="status" data-perspective-status="capability-unavailable">
        <span className="os-perspective-kicker">Compiled perspective · {perspective.version}</span>
        <h2>{perspective.title} is not available yet</h2>
        <p>This workspace does not expose the typed, provenance-preserving inputs this perspective requires.</p>
        <div className="os-perspective-missing" aria-label="Missing capabilities">
          {perspective.availability.missingCapabilities.map((capability) => (
            <span key={capability}>{capabilityLabel(capability)}</span>
          ))}
        </div>
        <p className="os-perspective-boundary">This is a capability limitation, not a permission denial. No placeholder or copied data is being shown.</p>
      </section>
    )
  }

  return (
    <SurfaceHost
      surfaceId={perspective.surfaceId}
      projectId={projectId}
      inputs={inputs}
      permissions={permissions}
      userId={userId}
    />
  )
}
