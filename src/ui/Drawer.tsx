import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'
import { useModalFocus } from './modalFocus'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  side?: 'left' | 'right'
  closeOnBackdrop?: boolean
  className?: string
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  closeOnBackdrop = true,
  className,
}: DrawerProps) {
  const drawerRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useModalFocus(open, drawerRef, onClose)

  if (!open) return null

  return createPortal(
    <div
      className="os-overlay os-overlay--drawer"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        ref={drawerRef}
        className={cx('os-drawer', `os-drawer--${side}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="os-drawer__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="os-dialog__close" type="button" aria-label="Close panel" onClick={onClose}>×</button>
        </header>
        <div className="os-drawer__body">{children}</div>
        {footer && <footer className="os-drawer__footer">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  )
}
