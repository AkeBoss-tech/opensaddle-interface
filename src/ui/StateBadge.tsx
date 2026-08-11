import React from 'react'
import type { ActionabilityState } from '../types'
import { STATE_BADGE_TONE } from './substrateFormatting'

void React

export interface StateBadgeProps {
  state: ActionabilityState
}

export function StateBadge({ state }: StateBadgeProps) {
  return <span className={`os-state-badge os-state-badge--${STATE_BADGE_TONE[state]}`}>{state}</span>
}
