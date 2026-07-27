import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'

export interface TabItem {
  id: string
  label: ReactNode
  panel: ReactNode
  disabled?: boolean
  badge?: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onValueChange: (value: string) => void
  label: string
  className?: string
}

export function Tabs({ items, value, onValueChange, label, className }: TabsProps) {
  const instanceId = useId()
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === value))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const enabled = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.disabled)
    const current = enabled.findIndex(({ index }) => index === selectedIndex)
    let next = current
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = enabled.length - 1
    if (event.key === 'ArrowRight') next = (current + 1) % enabled.length
    if (event.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length
    const target = enabled[next]
    if (!target) return
    onValueChange(target.item.id)
    tabsRef.current[target.index]?.focus()
  }

  const activeItem = items[selectedIndex]

  return (
    <div className={cx('os-tabs', className)}>
      <div className="os-tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((item, index) => {
          const selected = item.id === value
          return (
            <button
              key={item.id}
              ref={(node) => { tabsRef.current[index] = node }}
              className="os-tabs__tab"
              id={`${instanceId}-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${instanceId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onValueChange(item.id)}
            >
              {item.label}
              {item.badge}
            </button>
          )
        })}
      </div>
      {activeItem && (
        <div
          className="os-tabs__panel"
          id={`${instanceId}-panel-${activeItem.id}`}
          role="tabpanel"
          aria-labelledby={`${instanceId}-tab-${activeItem.id}`}
          tabIndex={0}
        >
          {activeItem.panel}
        </div>
      )}
    </div>
  )
}
