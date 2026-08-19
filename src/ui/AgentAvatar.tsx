import { useId } from 'react'
import './agent-avatar.css'

export type AgentAvatarVariant = 'builder' | 'scout' | 'coordinator' | 'reviewer' | 'guardian'
export type AgentExecutionState = 'ready' | 'running' | 'waiting' | 'needs-approval' | 'failed' | 'paused'
export type AgentAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface AgentAvatarProps {
  name: string
  variant?: AgentAvatarVariant
  state?: AgentExecutionState
  size?: AgentAvatarSize
  className?: string
}

const VARIANTS: AgentAvatarVariant[] = ['builder', 'scout', 'coordinator', 'reviewer', 'guardian']

const PATHS: Record<AgentAvatarVariant, string> = {
  builder: 'M18 83C8 73 10 55 22 45C28 40 28 32 30 25C34 12 44 6 53 12C61 18 55 29 67 34C84 40 93 55 88 70C83 86 66 91 49 91C34 91 24 88 18 83Z',
  scout: 'M14 70C9 53 19 35 37 23C50 14 70 5 81 10C92 15 87 34 80 49C72 67 60 84 46 90C32 97 19 87 14 70Z',
  coordinator: 'M29 87C15 91 7 80 13 67C17 58 26 55 28 46C30 38 24 29 30 18C38 3 56 8 60 22C63 32 57 39 65 44C72 48 82 43 90 53C99 65 91 80 78 84C67 88 61 81 52 82C43 83 38 85 29 87Z',
  reviewer: 'M20 83C10 73 12 57 24 47C30 42 28 34 32 25C38 11 47 2 53 16C56 23 60 13 66 10C74 5 76 20 75 28C74 36 83 40 88 51C97 72 77 91 55 91C39 91 27 89 20 83Z',
  guardian: 'M15 66C13 45 27 28 48 24C66 20 86 28 91 45C97 64 87 82 67 87C48 92 25 88 18 76C16 73 15 69 15 66Z',
}

const COLORS: Record<AgentAvatarVariant, [string, string]> = {
  builder: ['#9b69ff', '#5a22c9'],
  scout: ['#42a4ff', '#0754bd'],
  coordinator: ['#68d6ae', '#27936d'],
  reviewer: ['#ffd166', '#e59a19'],
  guardian: ['#ff7a72', '#d83e42'],
}

function agentAvatarVariant(identity: string): AgentAvatarVariant {
  const normalized = identity.toLowerCase()
  if (/code|coding|build|engineer|develop/.test(normalized)) return 'builder'
  if (/research|scout|search|discover|analyst/.test(normalized)) return 'scout'
  if (/coordinate|orchestrat|plan|manager/.test(normalized)) return 'coordinator'
  if (/review|quality|test|audit/.test(normalized)) return 'reviewer'
  if (/guard|reliab|release|security|ops/.test(normalized)) return 'guardian'
  let hash = 0
  for (const char of identity) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return VARIANTS[Math.abs(hash) % VARIANTS.length] ?? 'builder'
}

function RoleMark({ variant }: { variant: AgentAvatarVariant }) {
  if (variant === 'builder') return <g className="os-agent-avatar__mark"><path d="m55 69-7 6 7 6M69 69l7 6-7 6M64 66l-5 18" /></g>
  if (variant === 'scout') return <g className="os-agent-avatar__mark"><path d="M66 67c9 2 14 8 15 17" /><circle cx="83" cy="86" r="3.5" /></g>
  if (variant === 'coordinator') return <g className="os-agent-avatar__mark"><path d="M60 77 72 68M72 68l9 6" /><circle cx="58" cy="79" r="3" /><circle cx="73" cy="67" r="3" /><circle cx="83" cy="75" r="3" /></g>
  if (variant === 'reviewer') return <g className="os-agent-avatar__mark"><path d="m62 76 5 5 10-12" /></g>
  return <g className="os-agent-avatar__shield"><path d="M69 68 79 72v8c0 6-4 10-10 13-6-3-10-7-10-13v-8l10-4Z" /></g>
}

export function AgentAvatar({
  name,
  variant = agentAvatarVariant(name),
  state = 'ready',
  size = 'md',
  className = '',
}: AgentAvatarProps) {
  const gradientId = `agent-${useId().replace(/:/g, '')}`
  const [light, dark] = COLORS[variant]
  return (
    <span
      className={`os-agent-avatar os-agent-avatar--${size} os-agent-avatar--${variant} os-agent-avatar--${state} ${className}`.trim()}
      role="img"
      aria-label={`${name}, ${state.replace('-', ' ')}`}
      title={`${name} · ${state.replace('-', ' ')}`}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="25" y1="10" x2="76" y2="92" gradientUnits="userSpaceOnUse">
            <stop stopColor={light} />
            <stop offset="1" stopColor={dark} />
          </linearGradient>
          <filter id={`${gradientId}-shadow`} x="-25%" y="-25%" width="150%" height="165%">
            <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor={dark} floodOpacity=".28" />
          </filter>
        </defs>
        <g className="os-agent-avatar__body" filter={`url(#${gradientId}-shadow)`}>
          <path d={PATHS[variant]} fill={`url(#${gradientId})`} />
          <path className="os-agent-avatar__shine" d={PATHS[variant]} />
          <g className="os-agent-avatar__eyes">
            <rect x="38" y="48" width="8" height="16" rx="4" transform="rotate(-18 42 56)" />
            <rect x="55" y="48" width="8" height="16" rx="4" transform="rotate(18 59 56)" />
          </g>
          <RoleMark variant={variant} />
        </g>
      </svg>
      {state === 'running' && <span className="os-agent-avatar__orbit" aria-hidden="true"><i /></span>}
      {state === 'needs-approval' && <span className="os-agent-avatar__badge os-agent-avatar__badge--approval" aria-hidden="true">!</span>}
      {state === 'failed' && <span className="os-agent-avatar__badge os-agent-avatar__badge--failed" aria-hidden="true">×</span>}
    </span>
  )
}
