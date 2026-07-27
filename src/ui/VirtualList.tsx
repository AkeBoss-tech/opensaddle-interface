import { useMemo, useState, type ReactNode, type UIEvent } from 'react'
import { cx } from './cx'

export interface VirtualListProps<T> {
  items: T[]
  height: number
  itemHeight: number
  renderItem: (item: T, index: number) => ReactNode
  getKey: (item: T, index: number) => string
  overscan?: number
  label: string
  className?: string
}

export function VirtualList<T>({
  items,
  height,
  itemHeight,
  renderItem,
  getKey,
  overscan = 4,
  label,
  className,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0)
  const range = useMemo(() => {
    const first = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const visibleCount = Math.ceil(height / itemHeight) + overscan * 2
    return { first, last: Math.min(items.length, first + visibleCount) }
  }, [height, itemHeight, items.length, overscan, scrollTop])

  const onScroll = (event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop)

  return (
    <div
      className={cx('os-virtual-list', className)}
      style={{ height }}
      role="list"
      aria-label={label}
      onScroll={onScroll}
    >
      <div className="os-virtual-list__spacer" style={{ height: items.length * itemHeight }}>
        {items.slice(range.first, range.last).map((item, localIndex) => {
          const index = range.first + localIndex
          return (
            <div
              key={getKey(item, index)}
              className="os-virtual-list__item"
              style={{ height: itemHeight, transform: `translateY(${index * itemHeight}px)` }}
              role="listitem"
              aria-posinset={index + 1}
              aria-setsize={items.length}
            >
              {renderItem(item, index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
