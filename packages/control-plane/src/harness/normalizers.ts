/**
 * Normalize CLI stdout lines into assistant-visible text.
 * Keeps provider-native JSON in adapters; shared runtime only sees plain deltas.
 */

export function normalizeCliLine(providerId: string, line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const text = extractJsonText(providerId, parsed)
      if (text) return text
    } catch {
      // fall through to raw line
    }
  }

  // Drop noisy progress/spinner lines
  if (/^\s*[\|\/\-\\]\s*$/.test(trimmed)) return undefined
  return trimmed
}

function extractJsonText(providerId: string, parsed: Record<string, unknown>): string | undefined {
  // Codex JSONL event shapes
  if (providerId === 'codex') {
    const type = String(parsed.type ?? parsed.msg ?? '')
    if (type.includes('agent_message') || type === 'message') {
      const message = parsed.message ?? parsed.text ?? parsed.content
      if (typeof message === 'string') return message
    }
    if (typeof parsed.last_agent_message === 'string') return parsed.last_agent_message
  }

  // Claude Code stream-json
  if (providerId === 'claude') {
    const type = String(parsed.type ?? '')
    if (type === 'assistant' || type === 'result') {
      const message = parsed.message as { content?: Array<{ text?: string }> | string } | undefined
      if (typeof message?.content === 'string') return message.content
      if (Array.isArray(message?.content)) {
        return message.content.map((c) => c.text ?? '').join('')
      }
      if (typeof parsed.result === 'string') return parsed.result
    }
    if (type === 'content_block_delta') {
      const delta = parsed.delta as { text?: string } | undefined
      if (delta?.text) return delta.text
    }
  }

  // Gemini stream-json
  if (providerId === 'gemini') {
    if (typeof parsed.response === 'string') return parsed.response
    if (typeof parsed.text === 'string') return parsed.text
  }

  // Generic fallbacks
  for (const key of ['text', 'content', 'message', 'delta', 'output'] as const) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}
