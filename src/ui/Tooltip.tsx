import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { cx } from './cx'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement<{ 'aria-describedby'?: string }>
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const tooltipId = useId()
  const describedBy = [children.props['aria-describedby'], tooltipId].filter(Boolean).join(' ')
  return (
    <span className={cx('os-tooltip', className)}>
      <span className="os-tooltip__trigger">
        {cloneElement(children, { 'aria-describedby': describedBy })}
      </span>
      <span id={tooltipId} className={cx('os-tooltip__content', `os-tooltip__content--${side}`)} role="tooltip">
        {content}
      </span>
    </span>
  )
}
