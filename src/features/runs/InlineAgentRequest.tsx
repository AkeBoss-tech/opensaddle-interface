import { useState } from 'react'
import { Icon } from '../../components/common/Icon'
import type { AgentRunBlock } from '../../types'
import { useRunRegistry } from './RunRegistry'

export function InlineAgentRequest({ run, toast }: {
  run: AgentRunBlock
  toast: (title: string, message: string) => void
}) {
  const runRegistry = useRunRegistry()
  const request = run.inputRequest
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  if (!request) return null
  const questions = request.questions?.length
    ? request.questions
    : request.kind === 'clarification'
      ? [{ id: 'response', prompt: request.prompt, allowOther: true }]
      : []
  const supportsSession = request.availableDecisions?.some((decision) =>
    /session/i.test(decision),
  ) ?? true

  const respond = async (response: {
    approved?: boolean
    scope?: 'once' | 'session'
    text?: string
    answers?: Record<string, string[]>
  }) => {
    if (!request.id || submitting) return
    setSubmitting(true)
    try {
      await runRegistry.respond(run.id, request.id, response)
    } catch (error) {
      toast('Could not send response', error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const submitAnswers = () => {
    const submitted = Object.fromEntries(
      questions
        .map((question) => [
          question.id,
          [
            ...(answers[question.id] ?? []),
            customAnswers[question.id]?.trim() ?? '',
          ].filter((answer, index, values) => Boolean(answer) && values.indexOf(answer) === index),
        ] as const)
        .filter(([, answer]) => answer.length > 0),
    )
    if (Object.keys(submitted).length !== questions.length) {
      toast('Answer required', 'Complete each question so the agent can continue.')
      return
    }
    void respond({
      answers: submitted,
      text: questions.length === 1 ? submitted[questions[0].id]?.[0] : undefined,
    })
  }

  return (
    <div className={`tf-inline-request ${request.kind}`}>
      <Icon name={request.kind === 'approval' ? 'shield' : 'message'} className="icon sm" />
      <div className="tf-request-body">
        <div className="tf-request-heading">
          <strong>{request.kind === 'approval' ? 'Approval required' : 'Agent needs your input'}</strong>
          <span>Waiting</span>
        </div>
        <p>{request.prompt}</p>
        {request.detail && request.detail !== request.prompt && <pre className="tf-request-detail">{request.detail}</pre>}
        {request.kind === 'clarification' && questions.map((question) => (
          <div className="tf-request-question" key={question.id}>
            {(question.header || questions.length > 1) && <label>{question.header ?? question.prompt}</label>}
            {questions.length > 1 && question.header && <small>{question.prompt}</small>}
            {!!question.options?.length && (
              <div className="tf-request-options">
                {question.options.map((option) => (
                  <button
                    className={answers[question.id]?.includes(option.label) ? 'active' : ''}
                    key={option.label}
                    title={option.description}
                    type="button"
                    onClick={() => {
                      setAnswers((current) => {
                        const selected = current[question.id] ?? []
                        return {
                          ...current,
                          [question.id]: question.multiSelect
                            ? selected.includes(option.label)
                              ? selected.filter((label) => label !== option.label)
                              : [...selected, option.label]
                            : [option.label],
                        }
                      })
                      if (!question.multiSelect) {
                        setCustomAnswers((current) => ({ ...current, [question.id]: '' }))
                      }
                    }}
                  >
                    <span>{option.label}</span>
                    {option.description && <small>{option.description}</small>}
                  </button>
                ))}
              </div>
            )}
            {(question.allowOther || !question.options?.length) && (
              <input
                className="tf-request-input"
                type={question.secret ? 'password' : 'text'}
                value={customAnswers[question.id] ?? ''}
                placeholder={question.secret ? 'Enter a private answer' : question.options?.length ? 'Other answer' : 'Type your answer'}
                aria-label={question.prompt}
                onChange={(event) => {
                  const value = event.target.value
                  setCustomAnswers((current) => ({ ...current, [question.id]: value }))
                  if (!question.multiSelect && value) {
                    setAnswers((current) => ({ ...current, [question.id]: [] }))
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) submitAnswers()
                }}
              />
            )}
          </div>
        ))}
        {!request.id && <small className="tf-request-unavailable">Reconnect to the local runtime to answer this request.</small>}
        {request.id && (
          <div className="tf-request-actions">
            {request.kind === 'approval' ? (
              <>
                <button type="button" disabled={submitting} onClick={() => void respond({ approved: false, scope: 'once' })}>Deny</button>
                {supportsSession && <button type="button" disabled={submitting} onClick={() => void respond({ approved: true, scope: 'session' })}>Allow for session</button>}
                <button className="primary" type="button" disabled={submitting} onClick={() => void respond({ approved: true, scope: 'once' })}>Allow once</button>
              </>
            ) : (
              <button className="primary" type="button" disabled={submitting} onClick={submitAnswers}>
                {submitting ? 'Sending…' : 'Submit answer'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
