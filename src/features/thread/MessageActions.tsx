import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/common/Icon'
import { IconButton, Tooltip, cx } from '../../ui'
import { writeClipboardText } from './clipboard'
import './transcript-ergonomics.css'

export interface MessageActionsProps {
  text: string
  onRetry?: () => void
  onBranch?: () => void
  onCopy?: (text: string) => void | Promise<void>
  onCopyError?: (error: unknown) => void
  retryDisabled?: boolean
  branchDisabled?: boolean
  className?: string
}

type CopyState = 'idle' | 'copied' | 'failed'

export function MessageActions({
  text,
  onRetry,
  onBranch,
  onCopy,
  onCopyError,
  retryDisabled = false,
  branchDisabled = false,
  className,
}: MessageActionsProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const copy = async () => {
    window.clearTimeout(resetTimer.current)
    try {
      await (onCopy ? onCopy(text) : writeClipboardText(text))
      setCopyState('copied')
    } catch (error) {
      setCopyState('failed')
      onCopyError?.(error)
    }
    resetTimer.current = window.setTimeout(() => setCopyState('idle'), 1800)
  }

  const copyLabel = copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy message'

  return (
    <div className={cx('tf-message-actions', className)} role="group" aria-label="Message actions">
      <Tooltip content={copyLabel}>
        <IconButton
          label={copyLabel}
          size="sm"
          onClick={() => void copy()}
          disabled={!text}
          className={cx(copyState === 'copied' && 'is-success', copyState === 'failed' && 'is-error')}
        >
          <Icon name={copyState === 'copied' ? 'check' : 'code'} className="icon sm" />
        </IconButton>
      </Tooltip>

      {onRetry && (
        <Tooltip content="Retry from this message">
          <IconButton label="Retry from this message" size="sm" onClick={onRetry} disabled={retryDisabled}>
            <Icon name="refresh" className="icon sm" />
          </IconButton>
        </Tooltip>
      )}

      {onBranch && (
        <Tooltip content="Branch from this message">
          <IconButton label="Branch from this message" size="sm" onClick={onBranch} disabled={branchDisabled}>
            <Icon name="branch" className="icon sm" />
          </IconButton>
        </Tooltip>
      )}

      <span className="os-sr-only" role="status" aria-live="polite">
        {copyState === 'copied' ? 'Message copied to clipboard.' : copyState === 'failed' ? 'Message could not be copied.' : ''}
      </span>
    </div>
  )
}
