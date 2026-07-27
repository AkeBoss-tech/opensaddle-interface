import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  secondaryAction?: ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div {...props} className={cx('os-empty-state', className)}>
      {icon && <div className="os-empty-state__icon" aria-hidden="true">{icon}</div>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {(action || secondaryAction) && (
        <div className="os-empty-state__actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
