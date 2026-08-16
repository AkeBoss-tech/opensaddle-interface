import React, { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

// Node-rendered component tests use the classic JSX transform.
void React

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leadingIcon,
  trailingIcon,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cx('os-button', `os-button--${variant}`, `os-button--${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="os-spinner" aria-hidden="true" /> : leadingIcon}
      <span className="os-button__label">{children}</span>
      {trailingIcon}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: ButtonSize
  variant?: ButtonVariant
  loading?: boolean
  children: ReactNode
}

export function IconButton({
  label,
  size = 'md',
  variant = 'ghost',
  loading = false,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cx('os-icon-button', `os-icon-button--${variant}`, `os-icon-button--${size}`, className)}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
    >
      {loading ? <span className="os-spinner" aria-hidden="true" /> : children}
    </button>
  )
}
