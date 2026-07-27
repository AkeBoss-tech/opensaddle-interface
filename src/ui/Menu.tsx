import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cx } from './cx'

export interface MenuItem {
  id: string
  label: ReactNode
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  destructive?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

export interface MenuProps {
  label: string
  trigger: ReactNode
  items: MenuItem[]
  align?: 'start' | 'end'
  className?: string
}

export function Menu({ label, trigger, items, align = 'start', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const focusItem = (index: number) => {
    const enabled = items.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => !item.disabled)
    if (!enabled.length) return
    const normalized = ((index % enabled.length) + enabled.length) % enabled.length
    const target = enabled[normalized]
    setActiveIndex(target.itemIndex)
    itemRefs.current[target.itemIndex]?.focus()
  }

  const openMenu = (atEnd = false) => {
    setOpen(true)
    requestAnimationFrame(() => focusItem(atEnd ? -1 : 0))
  }

  const closeMenu = (restoreFocus = true) => {
    setOpen(false)
    setActiveIndex(-1)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabledIndexes = items.flatMap((item, index) => item.disabled ? [] : [index])
    const enabledPosition = enabledIndexes.indexOf(activeIndex)
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      closeMenu(event.key === 'Escape')
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusItem(enabledPosition + 1)
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(enabledPosition - 1)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusItem(0)
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusItem(-1)
    }
  }

  return (
    <div ref={rootRef} className={cx('os-menu', className)}>
      <button
        ref={triggerRef}
        className="os-menu__trigger"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => open ? closeMenu(false) : openMenu()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu(event.key === 'ArrowUp')
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          className={cx('os-menu__content', `os-menu__content--${align}`)}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <div key={item.id}>
              {item.separatorBefore && <div className="os-menu__separator" role="separator" />}
              <button
                ref={(node) => { itemRefs.current[index] = node }}
                className={cx('os-menu__item', item.destructive && 'os-menu__item--danger')}
                type="button"
                role="menuitem"
                tabIndex={index === activeIndex ? 0 : -1}
                disabled={item.disabled}
                onMouseEnter={() => {
                  if (!item.disabled) setActiveIndex(index)
                }}
                onClick={() => {
                  item.onSelect()
                  closeMenu()
                }}
              >
                {item.icon && <span className="os-menu__icon">{item.icon}</span>}
                <span className="os-menu__label">{item.label}</span>
                {item.shortcut && <kbd className="os-menu__shortcut">{item.shortcut}</kbd>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
