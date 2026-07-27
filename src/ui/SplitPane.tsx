import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cx } from './cx'

export interface SplitPaneProps {
  primary: ReactNode
  secondary: ReactNode
  direction?: 'horizontal' | 'vertical'
  initialSize?: number
  minSize?: number
  maxSize?: number
  step?: number
  primaryLabel?: string
  secondaryLabel?: string
  onSizeChange?: (size: number) => void
  className?: string
}

export function SplitPane({
  primary,
  secondary,
  direction = 'horizontal',
  initialSize = 320,
  minSize = 220,
  maxSize = 720,
  step = 16,
  primaryLabel = 'Primary pane',
  secondaryLabel = 'Secondary pane',
  onSizeChange,
  className,
}: SplitPaneProps) {
  const [size, setSize] = useState(() => Math.min(maxSize, Math.max(minSize, initialSize)))
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const updateSize = useCallback((nextSize: number) => {
    const bounded = Math.round(Math.min(maxSize, Math.max(minSize, nextSize)))
    setSize(bounded)
    onSizeChange?.(bounded)
  }, [maxSize, minSize, onSizeChange])

  useEffect(() => {
    if (!dragging) return
    const onPointerMove = (event: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      updateSize(direction === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top)
    }
    const onPointerUp = () => setDragging(false)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [direction, dragging, updateSize])

  const onSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrementKey = direction === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
    const incrementKey = direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
    if (event.key === decrementKey) {
      event.preventDefault()
      updateSize(size - step)
    }
    if (event.key === incrementKey) {
      event.preventDefault()
      updateSize(size + step)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      updateSize(minSize)
    }
    if (event.key === 'End') {
      event.preventDefault()
      updateSize(maxSize)
    }
  }

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(true)
  }

  const primaryStyle = direction === 'horizontal' ? { width: size } : { height: size }

  return (
    <div
      ref={rootRef}
      className={cx('os-split-pane', `os-split-pane--${direction}`, dragging && 'os-split-pane--dragging', className)}
    >
      <section className="os-split-pane__primary" style={primaryStyle} aria-label={primaryLabel}>
        {primary}
      </section>
      <div
        className="os-split-pane__separator"
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${primaryLabel}`}
        aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        aria-valuenow={size}
        onPointerDown={beginResize}
        onKeyDown={onSeparatorKeyDown}
      />
      <section className="os-split-pane__secondary" aria-label={secondaryLabel}>
        {secondary}
      </section>
    </div>
  )
}
