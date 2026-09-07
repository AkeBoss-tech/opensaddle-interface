import { useSearchParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import { SurfaceHost } from '../../ui/SurfaceHost'
import './ReviewWorkspaceSurface'
import '../command-center/command-center.css'

export function ReviewWorkspacePage() {
  const { services } = useStore()
  const [params] = useSearchParams()
  const projectId = params.get('project') ?? ''
  return <SurfaceHost surfaceId="artifact-review" projectId={projectId} inputs={{ client: services?.malleableShell, runId: params.get('run') ?? '', projectId, invocationId: params.get('invocation') ?? '' }} />
}
