import type {ProjectTaskFeedAuthority} from '../../services/projectTaskFeed'
import React, {useEffect, useState, type ReactNode} from 'react'
import type {JourneyAuthority} from '../../features/onboarding/ConnectedJourneySurface'
import {projectTaskModel, type ProjectTaskModel} from './model'
void React

/** The host owns freshness; plugin code receives only the current projection. */
export function ProjectTaskFeed({authority, projectId, connectionKey, children, taskFeed}: {
  taskFeed?:ProjectTaskFeedAuthority
  authority: Pick<JourneyAuthority, 'snapshot'>
  projectId: string
  connectionKey: string
  children: (model: ProjectTaskModel) => ReactNode
}) {
  const [value, setValue] = useState<{taskFeed?:ProjectTaskFeedAuthority;authority: typeof authority; projectId: string; connectionKey: string; model: ProjectTaskModel}>()
  const [error, setError] = useState('')
  useEffect(() => {
    let stopped = false
    let next: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    setValue(undefined)
    setError('')
    const refresh = async () => {
      let expired = false
      deadline = setTimeout(() => {
        if (stopped) return
        expired = true
        setValue(undefined)
        setError('Task updates timed out. Check your connection or refresh the workspace.')
      }, 15000)
      try {
        const model = taskFeed?await taskFeed.read(projectId):projectTaskModel(await authority.snapshot(projectId), projectId)
        if(model.projectId!==projectId)throw Error('Project task feed identity mismatch')
        if (stopped || expired) return
        setValue(previous => previous?.authority === authority && previous.taskFeed===taskFeed && previous.projectId === projectId && previous.connectionKey === connectionKey && JSON.stringify(previous.model) === JSON.stringify(model)
          ? previous : {authority, taskFeed, projectId, connectionKey, model})
        setError('')
      } catch {
        if (!stopped) {
          setValue(undefined)
          setError('Task updates are unavailable. Rechecking connection and Project access…')
        }
      } finally {
        clearTimeout(deadline)
        // Never overlap requests; an unresolved request remains hidden after its deadline.
        if (!stopped) next = setTimeout(() => void refresh(), 5000)
      }
    }
    void refresh()
    return () => {stopped = true; clearTimeout(next); clearTimeout(deadline)}
  }, [authority, projectId, connectionKey, taskFeed])
  const current = value?.authority === authority && value.taskFeed===taskFeed && value.projectId === projectId && value.connectionKey === connectionKey ? value.model : undefined
  if (!current) return <p role="status">{error || 'Loading project tasks…'}</p>
  return <>{children(current)}</>
}
