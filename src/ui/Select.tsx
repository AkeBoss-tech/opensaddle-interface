import { useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cx } from './cx'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string
  options: SelectOption[]
  hint?: ReactNode
  hideLabel?: boolean
}

export function Select({
  label,
  options,
  hint,
  hideLabel = false,
  id,
  className,
  ...props
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const hintId = hint ? `${selectId}-hint` : undefined

  return (
    <label className={cx('os-field', className)} htmlFor={selectId}>
      <span className={cx('os-field__label', hideLabel && 'os-sr-only')}>{label}</span>
      <span className="os-select">
        <select {...props} id={selectId} aria-describedby={hintId}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="os-select__chevron" aria-hidden="true">⌄</span>
      </span>
      {hint && <span className="os-field__hint" id={hintId}>{hint}</span>}
    </label>
  )
}
