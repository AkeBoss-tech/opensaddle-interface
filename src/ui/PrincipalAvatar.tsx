export type PrincipalKind = 'human' | 'agent'
export type PresenceState = 'online' | 'away' | 'offline'

export interface PresenceDotProps {
  state: PresenceState
}

export function PresenceDot({ state }: PresenceDotProps) {
  return <span className={`os-presence-dot os-presence-dot--${state}`} aria-label={state} />
}

export interface PrincipalAvatarProps {
  name: string
  kind?: PrincipalKind
  imageUrl?: string
  presence?: PresenceState
  size?: 'sm' | 'md'
}

function initialsFor(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

export function PrincipalAvatar({
  name,
  kind = 'human',
  imageUrl,
  presence,
  size = 'md',
}: PrincipalAvatarProps) {
  return (
    <span className={`os-principal-avatar os-principal-avatar--${size} os-principal-avatar--${kind}`} aria-label={name}>
      {imageUrl ? <img src={imageUrl} alt="" /> : kind === 'agent' ? <span aria-hidden="true">✦</span> : initialsFor(name)}
      {presence && <PresenceDot state={presence} />}
    </span>
  )
}
