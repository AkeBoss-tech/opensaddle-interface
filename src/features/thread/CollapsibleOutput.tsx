import { useId, useState, type ReactNode } from 'react'
import { Icon } from '../../components/common/Icon'
import { IconButton, Tooltip, cx } from '../../ui'
import { writeClipboardText } from './clipboard'
import './transcript-ergonomics.css'

export type OutputKind = 'tool' | 'terminal'
export type OutputStatus = 'idle' | 'running' | 'success' | 'error'

export interface CollapsibleOutputProps {
  title: string
  output: ReactNode
  kind?: OutputKind
  command?: string
  summary?: string
  status?: OutputStatus
  statusLabel?: string
  duration?: string
  copyText?: string
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  onCopyError?: (error: unknown) => void
  className?: string
}

export function CollapsibleOutput({
  title,
  output,
  kind = 'tool',
  command,
  summary,
  status = 'idle',
  statusLabel,
  duration,
  copyText,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
  onCopyError,
  className,
}: CollapsibleOutputProps) {
  const regionId = useId()
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded)
  const [copied, setCopied] = useState(false)
  const isExpanded = expanded ?? localExpanded
  const canCopy = typeof copyText === 'string' && copyText.length > 0

  const toggle = () => {
    const next = !isExpanded
    if (expanded === undefined) setLocalExpanded(next)
    onExpandedChange?.(next)
  }

  const copy = async () => {
    if (!copyText) return
    try {
      await writeClipboardText(copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (error) {
      onCopyError?.(error)
    }
  }

  return (
    <section className={cx('tf-output', `tf-output--${status}`, className)} aria-label={`${title} output`}>
      <div className="tf-output__header">
        <button
          type="button"
          className="tf-output__toggle"
          aria-expanded={isExpanded}
          aria-controls={regionId}
          onClick={toggle}
        >
          <Icon name={kind === 'terminal' ? 'terminal' : 'tools'} className="icon sm tf-output__kind" />
          <span className="tf-output__title">
            <strong>{title}</strong>
            {(command || summary) && <small>{command ?? summary}</small>}
          </span>
          {status !== 'idle' && (
            <span className="tf-output__status">
              <i aria-hidden="true" />
              {statusLabel ?? status}
            </span>
          )}
          {duration && <span className="tf-output__duration">{duration}</span>}
          <Icon name="chevron" className={cx('icon xs tf-output__chevron', isExpanded && 'is-expanded')} />
        </button>

        {canCopy && (
          <Tooltip content={copied ? 'Copied' : 'Copy output'}>
            <IconButton label={copied ? 'Output copied' : 'Copy output'} size="sm" onClick={() => void copy()}>
              <Icon name={copied ? 'check' : 'code'} className="icon sm" />
            </IconButton>
          </Tooltip>
        )}
      </div>

      {isExpanded && (
        <div id={regionId} className="tf-output__body" role="region" aria-label={`${title} details`}>
          {command && <div className="tf-output__command"><span aria-hidden="true">$</span> {command.replace(/^\$\s*/, '')}</div>}
          {typeof output === 'string'
            ? <pre><code>{output}</code></pre>
            : <div className="tf-output__content">{output}</div>}
        </div>
      )}
    </section>
  )
}
