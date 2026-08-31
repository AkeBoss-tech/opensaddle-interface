import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import {
  COMPILED_BUILTIN_PERSPECTIVES,
  getPerspective,
} from '../../perspectives/catalog'
import { PerspectiveHost } from '../../perspectives/PerspectiveHost'
import {
  deriveDeveloperPerspective,
  type DeveloperPerspectiveView,
  type DeveloperRuntimeState,
} from '../../perspectives/developer/readModel'
import type { RuntimeRunSummary } from '../../services/contracts'
import '../../surfaces/DeveloperPerspectiveSurface'
import '../../styles/perspectives.css'

export function PerspectivesPage() {
  const { data, services, setActiveProject, updateProject } = useStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryProjectId = searchParams.get('project')
  const queryPerspectiveId = searchParams.get('perspective')
  const queryView = searchParams.get('view')
  const preferred = data.projects.find((project) => project.id === (queryProjectId ?? data.activeProjectId))?.perspective
  const [selectedId, setSelectedId] = useState(queryPerspectiveId ?? preferred?.perspectiveId ?? 'opensaddle.developer')
  const [view, setView] = useState<DeveloperPerspectiveView>(queryView === 'kanban' || preferred?.viewId === 'kanban' ? 'kanban' : 'trace-evidence')
  const [durableRuns, setDurableRuns] = useState<RuntimeRunSummary[]>([])
  const [runtimeState, setRuntimeState] = useState<DeveloperRuntimeState>('loading')
  const [runtimeError, setRuntimeError] = useState<string>()
  const selected = getPerspective(selectedId) ?? COMPILED_BUILTIN_PERSPECTIVES[0]!

  useEffect(() => {
    if (queryProjectId && queryProjectId !== data.activeProjectId && data.projects.some((project) => project.id === queryProjectId)) {
      setActiveProject(queryProjectId)
    }
    if (queryPerspectiveId && queryPerspectiveId !== selectedId) setSelectedId(queryPerspectiveId)
    if (queryView === 'trace-evidence' || queryView === 'kanban') setView(queryView)
  }, [data.activeProjectId, data.projects, queryPerspectiveId, queryProjectId, queryView, selectedId, setActiveProject])

  const persistPreference = (perspectiveId: string, nextView: DeveloperPerspectiveView) => {
    setSelectedId(perspectiveId)
    setView(nextView)
    if (data.activeProjectId) updateProject(data.activeProjectId, { perspective: { perspectiveId, viewId: nextView } })
    setSearchParams({
      ...(data.activeProjectId ? { project: data.activeProjectId } : {}),
      perspective: perspectiveId,
      view: nextView,
    }, { replace: true })
  }

  useEffect(() => {
    if (!services?.runtime.listRuns) {
      setRuntimeState('unavailable')
      setRuntimeError('The active control plane does not expose durable run snapshots.')
      setDurableRuns([])
      return
    }

    let cancelled = false
    let refreshing = false
    const refresh = async () => {
      if (cancelled || refreshing) return
      refreshing = true
      try {
        const runs = await services.runtime.listRuns!()
        if (!cancelled) {
          setDurableRuns(runs)
          setRuntimeState('ready')
          setRuntimeError(undefined)
        }
      } catch (error) {
        if (!cancelled) {
          setDurableRuns([])
          setRuntimeState('unavailable')
          setRuntimeError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        refreshing = false
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [services])

  const model = useMemo(() => deriveDeveloperPerspective({
    data,
    projectId: data.activeProjectId,
    durableRuns,
    runtimeState,
    runtimeError,
    asOf: Date.now(),
  }), [data, durableRuns, runtimeError, runtimeState])

  return (
    <div className="os-perspectives-page">
      <header className="os-perspectives-page-header">
        <div>
          <span className="os-perspective-kicker">Workspace perspectives</span>
          <h1>Choose the shape of the work</h1>
          <p>Compiled views reorganize the same governed project data for different roles. They do not add authority or create a second tracker.</p>
        </div>
        <span className="os-perspectives-compiled"><Icon name="lock" className="icon sm" />Built-in catalog</span>
      </header>

      <ul className="os-perspective-catalog" aria-label="Available workspace perspectives">
        {COMPILED_BUILTIN_PERSPECTIVES.map((perspective) => {
          const enabled = perspective.availability.status === 'enabled'
          const selectedPerspective = perspective.id === selected.id
          return (
            <li key={perspective.id}>
              <button
                type="button"
                className={`os-perspective-card ${selectedPerspective ? 'selected' : ''}`}
                aria-pressed={selectedPerspective}
                onClick={() => persistPreference(perspective.id, view)}
              >
                <span className={`os-perspective-card-icon ${enabled ? 'enabled' : ''}`}><Icon name={perspective.id === 'opensaddle.developer' ? 'code' : perspective.id === 'opensaddle.designer' ? 'layout' : 'review'} /></span>
                <span className="os-perspective-card-copy">
                  <strong>{perspective.title}</strong>
                  <small>{perspective.description}</small>
                </span>
                <span className={`os-perspective-card-status ${enabled ? 'enabled' : ''}`}>{enabled ? 'Available' : 'Needs capability'}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <PerspectiveHost
        perspective={selected}
        projectId={data.activeProjectId}
        permissions={services?.permissions}
        userId={data.currentUserId}
        inputs={{
          model,
          view,
          onViewChange: (nextView: DeveloperPerspectiveView) => persistPreference(selected.id, nextView),
          onOpen: navigate,
        }}
      />
    </div>
  )
}
