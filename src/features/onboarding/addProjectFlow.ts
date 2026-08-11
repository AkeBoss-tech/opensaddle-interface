export type AddProjectKind = 'local' | 'cloud'

/** Returns the only durable action a valid details step may start. */
export function creationAction(kind: AddProjectKind, folderPath: string, cancelled = false): 'create' | 'scan' | null {
  if (cancelled) return null
  if (kind === 'cloud') return 'create'
  return folderPath.trim() ? 'scan' : null
}

export function isProjectDetailsValid(kind: AddProjectKind, name: string, folderPath: string) {
  return Boolean(name.trim()) && (kind === 'cloud' || Boolean(folderPath.trim()))
}
