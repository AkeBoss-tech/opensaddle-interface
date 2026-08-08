import type { AuthorityKind, AuthorityPresentation, ResourceAuthority, ResourceRef } from './contracts'
import { serializeResourceVersion } from './version'

const AUTHORITY_VIEW: Record<AuthorityKind, Omit<AuthorityPresentation, 'label'>> = {
  opensaddle: { badge: { label: 'OpenSaddle', tone: 'info' }, description: 'Authoritative OpenSaddle control-plane data' },
  local_workspace: { badge: { label: 'Workspace', tone: 'neutral' }, description: 'Authoritative local workspace data' },
  provider: { badge: { label: 'Provider', tone: 'info' }, description: 'Authoritative provider data' },
  connector: { badge: { label: 'Connector', tone: 'neutral' }, description: 'Data observed through a connected service' },
  user: { badge: { label: 'User supplied', tone: 'neutral' }, description: 'Data supplied by a user' },
  public_web: { badge: { label: 'Public web', tone: 'neutral' }, description: 'Data observed on the public web' },
}

export function presentAuthority(authority: ResourceAuthority): AuthorityPresentation {
  const view = AUTHORITY_VIEW[authority.kind]
  return { ...view, label: authority.id }
}

export function resourceRefKey(ref: ResourceRef): string {
  return [
    ref.authority.kind,
    encodeURIComponent(ref.authority.id),
    encodeURIComponent(ref.kind),
    encodeURIComponent(ref.id),
    encodeURIComponent(serializeResourceVersion(ref.version)),
  ].join(':')
}
