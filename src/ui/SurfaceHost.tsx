import React, { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import type { PermissionClient } from '../services/contracts'
import { getSurface, type SurfaceInputs } from '../surfaces/registry'

// Node's lightweight test runner compiles JSX in classic mode; keep React in scope
// there while Vite uses the automatic runtime in the application.
void React

interface BoundaryProps { children: ReactNode; onRetry: () => void }
interface BoundaryState { error: Error | null }

export class SurfaceErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The boundary deliberately contains surface failures so application chrome survives.
  }

  render() {
    if (this.state.error) {
      return <section className="os-surface-recovery" role="alert">
        <h2>This view could not load</h2>
        <p>Try loading the surface again. The rest of OpenSaddle is still available.</p>
        <button type="button" onClick={() => { this.setState({ error: null }); this.props.onRetry() }}>Try again</button>
      </section>
    }
    return this.props.children
  }
}

export interface SurfaceHostProps<Inputs extends SurfaceInputs> {
  surfaceId: string
  projectId: string
  inputs: Inputs
  permissions?: PermissionClient
  userId?: string
}

export function SurfaceHost<Inputs extends SurfaceInputs>({ surfaceId, projectId, inputs, permissions, userId = 'user-ad' }: SurfaceHostProps<Inputs>) {
  const definition = getSurface(surfaceId)
  const [permission, setPermission] = useState<'allowed' | 'denied' | 'pending'>('allowed')

  useEffect(() => {
    let active = true
    if (!definition?.permission || !permissions) {
      setPermission('allowed')
      return () => { active = false }
    }
    setPermission('pending')
    void permissions.check({ userId, resourceKind: definition.permission.resourceKind, resourceId: projectId, action: definition.permission.action })
      .then((result) => { if (active) setPermission(result.allowed ? 'allowed' : 'denied') })
      .catch(() => { if (active) setPermission('denied') })
    return () => { active = false }
  }, [definition, permissions, projectId, userId])

  if (!definition) return <section className="os-surface-empty" role="status"><h2>View unavailable</h2><p>This surface is not registered.</p></section>

  const supplied = Object.keys(inputs).sort()
  const declared = [...definition.inputs].sort()
  if (supplied.length !== declared.length || supplied.some((key, index) => key !== declared[index])) {
    return <section className="os-surface-recovery" role="alert"><h2>View configuration changed</h2><p>The shell did not supply the inputs this surface requires.</p></section>
  }

  if (permission === 'pending') return <section className="os-surface-empty" role="status"><h2>Checking access</h2><p>Verifying permission for this view.</p></section>
  if (permission === 'denied') return <section className="os-surface-empty" role="status"><h2>View unavailable</h2><p>You do not have permission to view this surface.</p></section>

  if (definition.empty?.(inputs)) {
    return <section className="os-surface-empty" role="status"><h2>{definition.emptyState?.title ?? 'Nothing to show'}</h2><p>{definition.emptyState?.description ?? 'There is no data for this view yet.'}</p></section>
  }

  const Surface = definition.Component
  return <SurfaceErrorBoundary onRetry={() => undefined}><Surface {...inputs} /></SurfaceErrorBoundary>
}
