import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'approval'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone
  icon?: ReactNode
}

export function Badge({ tone = 'neutral', icon, className, children, ...props }: BadgeProps) {
  return (
    <span {...props} className={cx('os-badge', `os-badge--${tone}`, className)}>
      {icon}
      {children}
    </span>
  )
}

export interface StatusProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone
  pulse?: boolean
  label: string
}

export function Status({ tone = 'neutral', pulse = false, label, className, ...props }: StatusProps) {
  return (
    <span
      {...props}
      className={cx('os-status', `os-status--${tone}`, pulse && 'os-status--pulse', className)}
      role="status"
    >
      <span className="os-status__dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
