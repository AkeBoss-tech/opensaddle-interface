export interface RegisterLocalWorkspaceInput<T> {
  projectId: string
  root: string
  registerProject?: (projectId: string, root: string) => Promise<unknown>
  commitRendererState: () => T
}

/**
 * Keep the renderer transaction behind the authoritative registration.
 * A rejected backend registration must never leave a frontend-only project,
 * channel, agent, permission, or connector graph behind.
 */
export async function registerLocalWorkspace<T>({
  projectId,
  root,
  registerProject,
  commitRendererState,
}: RegisterLocalWorkspaceInput<T>): Promise<T> {
  if (registerProject) await registerProject(projectId, root)
  return commitRendererState()
}
