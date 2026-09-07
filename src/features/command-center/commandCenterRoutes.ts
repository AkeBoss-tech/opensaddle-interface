export function connectedResourcesHref(runId: string, projectId: string) {
  return `/review?${new URLSearchParams({ run: runId, project: projectId })}`
}
