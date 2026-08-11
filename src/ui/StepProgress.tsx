import React, { type ReactNode } from 'react'
import { cx } from './cx'

// Node-based component tests use the classic JSX transform.
void React

export function StepProgress({
  current,
  steps,
  className,
}: {
  current: number
  steps: Array<{ label: string; detail?: ReactNode }>
  className?: string
}) {
  const safeCurrent = Math.min(Math.max(current, 0), Math.max(steps.length - 1, 0))

  return (
    <div
      className={cx('os-step-progress', className)}
      role="progressbar"
      aria-label={`Step ${safeCurrent + 1} of ${steps.length}: ${steps[safeCurrent]?.label ?? ''}`}
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuenow={safeCurrent + 1}
    >
      <div className="os-step-progress__track" aria-hidden="true">
        {steps.map((step, index) => (
          <span
            className={cx(
              'os-step-progress__segment',
              index < safeCurrent && 'is-complete',
              index === safeCurrent && 'is-current',
            )}
            key={step.label}
          />
        ))}
      </div>
      <div className="os-step-progress__labels" aria-hidden="true">
        {steps.map((step, index) => (
          <span className={cx(index <= safeCurrent && 'is-reached')} key={step.label}>
            <strong>{step.label}</strong>
            {step.detail && <small>{step.detail}</small>}
          </span>
        ))}
      </div>
    </div>
  )
}
