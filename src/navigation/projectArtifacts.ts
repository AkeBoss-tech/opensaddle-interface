import type { AppData, Project } from '../types'

/**
 * A small, client-only projection of the workspace payload.  The sidebar
 * consumes this instead of owning a second, hard-coded navigation tree, so a
 * remotely hydrated workspace and the demo workspace render the same shell.
 */
export type ProjectArtifactKind = 'agent' | 'wiki' | 'site' | 'runs'

export interface ProjectArtifact {
  id: string
  kind: ProjectArtifactKind
  label: string
  icon: 'spark' | 'book' | 'globe' | 'clock'
  href: string
}

export function projectHref(projectId: string) {
  return `/project/${projectId}`
}

export function projectArtifacts(data: AppData, project: Project): ProjectArtifact[] {
  const artifacts: ProjectArtifact[] = []
  const agents = data.agents.filter((agent) => agent.projectId === project.id)
  const hasWiki = data.wikiSummaries.some((wiki) => wiki.projectId === project.id && wiki.scope === 'team')
  const sites = data.sites.filter((site) => site.projectId === project.id)
  const hasRuns = data.workflowRuns.some((run) => run.projectId === project.id)
    || data.workflows.some((workflow) => workflow.projectId === project.id)
    || data.agentSessions.some((session) => session.projectId === project.id)

  for (const agent of agents) {
    artifacts.push({
      id: agent.id,
      kind: 'agent',
      label: agent.name,
      icon: 'spark',
      href: `/project/${project.id}/agents`,
    })
  }
  if (hasWiki) artifacts.push({ id: project.id, kind: 'wiki', label: 'Team wiki', icon: 'book', href: `/project/${project.id}/wiki` })
  for (const site of sites) artifacts.push({ id: site.id, kind: 'site', label: site.name, icon: 'globe', href: `/site/${site.id}` })
  if (hasRuns) artifacts.push({ id: project.id, kind: 'runs', label: 'Runs', icon: 'clock', href: `/project/${project.id}/runs` })
  return artifacts
}

export function artifactIsActive(pathname: string, artifact: ProjectArtifact) {
  if (artifact.kind === 'site') return pathname === artifact.href
  return pathname === artifact.href || pathname.startsWith(`${artifact.href}/`)
}
