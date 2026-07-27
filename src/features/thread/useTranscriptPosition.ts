import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type UIEventHandler,
} from 'react'

export interface UseTranscriptPositionOptions {
  itemCount: number
  revision?: string | number
  threshold?: number
  autoFollow?: boolean
}

export interface TranscriptPosition {
  containerRef: RefObject<HTMLDivElement | null>
  onScroll: UIEventHandler<HTMLDivElement>
  isAtLatest: boolean
  unreadCount: number
  jumpToLatest: (behavior?: ScrollBehavior) => void
}

export function useTranscriptPosition({
  itemCount,
  revision = '',
  threshold = 72,
  autoFollow = true,
}: UseTranscriptPositionOptions): TranscriptPosition {
  const containerRef = useRef<HTMLDivElement>(null)
  const atLatestRef = useRef(true)
  const previousItemCount = useRef<number | null>(null)
  const previousRevision = useRef<string | number | null>(null)
  const [isAtLatest, setIsAtLatest] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)

  const readPosition = useCallback((element: HTMLDivElement) => {
    const next = element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
    atLatestRef.current = next
    setIsAtLatest(next)
    if (next) setUnreadCount(0)
  }, [threshold])

  const onScroll: UIEventHandler<HTMLDivElement> = useCallback((event) => {
    readPosition(event.currentTarget)
  }, [readPosition])

  const jumpToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = containerRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
    atLatestRef.current = true
    setIsAtLatest(true)
    setUnreadCount(0)
  }, [])

  useLayoutEffect(() => {
    const isFirstLayout = previousItemCount.current === null
    const countDelta = Math.max(0, itemCount - (previousItemCount.current ?? itemCount))
    const changed = isFirstLayout || countDelta > 0 || revision !== previousRevision.current
    previousItemCount.current = itemCount
    previousRevision.current = revision
    if (!changed) return

    if (atLatestRef.current && autoFollow) {
      const frame = window.requestAnimationFrame(() => jumpToLatest('auto'))
      return () => window.cancelAnimationFrame(frame)
    }

    if (!atLatestRef.current) {
      setUnreadCount((current) => current + Math.max(1, countDelta))
    }
  }, [autoFollow, itemCount, jumpToLatest, revision])

  return { containerRef, onScroll, isAtLatest, unreadCount, jumpToLatest }
}
