import { Icon } from '../../components/common/Icon'
import { cx } from '../../ui'
import './transcript-ergonomics.css'

export interface JumpToLatestProps {
  unreadCount?: number
  onJump: () => void
  visible?: boolean
  busy?: boolean
  className?: string
}

export function JumpToLatest({
  unreadCount = 0,
  onJump,
  visible = true,
  busy = false,
  className,
}: JumpToLatestProps) {
  if (!visible) return null

  const label = unreadCount > 0
    ? `Jump to latest, ${unreadCount} unread ${unreadCount === 1 ? 'update' : 'updates'}`
    : 'Jump to latest'

  return (
    <button
      type="button"
      className={cx('tf-jump-latest', busy && 'is-busy', className)}
      aria-label={label}
      onClick={onJump}
    >
      <Icon name="arrow" className="icon sm tf-jump-latest__icon" />
      {unreadCount > 0 && <span>{unreadCount > 99 ? '99+' : unreadCount} new</span>}
    </button>
  )
}
