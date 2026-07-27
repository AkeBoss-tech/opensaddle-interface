import type { ControlPlaneConfig } from './config.js'
import type { RouteEstimate } from './types.js'

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
  error?: { message?: string }
}

type CompletionContent = string | Array<{ type?: string; text?: string }> | undefined

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function contentText(content: CompletionContent): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => part.text ?? '').join('')
}

export function containsUnsupportedToolCall(text: string): boolean {
  return /<\|tool_call>|<tool_call\|>|(?:^|\n)\s*(?:TOOL|tool_call:)[\s:_-]/i.test(text)
}

export class ModelGateway {
  constructor(private readonly config: ControlPlaneConfig) {}

  configuredKeys(): string[] {
    return Object.keys(this.config.modelRoutes)
  }

  async complete(input: {
    route: RouteEstimate
    task: string
    projectId: string
    agentId?: string
    signal: AbortSignal
  }): Promise<string> {
    const text = await this.completeMessages({
      route: input.route,
      signal: input.signal,
      messages: [
        {
          role: 'system',
          content: [
            'You are an OpenSaddle enterprise agent.',
            `Project: ${input.projectId}.`,
            input.agentId ? `Agent: ${input.agentId}.` : '',
            `Harness: ${input.route.harnessKey}.`,
            'Follow least privilege. Never claim a tool action occurred unless the runtime reports it.',
            'This route has no workspace or browser tool protocol. Never emit tool calls or control tokens; say when a coding or browser harness is required.',
          ].filter(Boolean).join(' '),
        },
        { role: 'user', content: input.task },
      ],
    })
    if (containsUnsupportedToolCall(text)) {
      throw new Error('The model requested workspace tools on a route without tools. Retry with the Coding harness.')
    }
    return text
  }

  async completeMessages(input: {
    route: RouteEstimate
    messages: ChatMessage[]
    signal: AbortSignal
  }): Promise<string> {
    const route = this.config.modelRoutes[input.route.modelKey]
    if (!route) {
      throw new Error(
        `No endpoint configured for model key "${input.route.modelKey}". `
        + 'Set OPENSADDLE_MODEL_ROUTES_JSON or OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL.',
      )
    }

    const secret = route.apiKey ?? (route.apiKeyEnv ? process.env[route.apiKeyEnv] : undefined)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...route.headers,
    }
    if (secret) headers.Authorization = `Bearer ${secret}`

    const endpoint = `${route.baseUrl.replace(/\/$/, '')}/chat/completions`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: input.signal,
      body: JSON.stringify({
        model: input.route.modelId ?? route.model,
        stream: false,
        messages: input.messages,
      }),
    })

    const body = await response.json() as ChatCompletionResponse
    if (!response.ok) {
      throw new Error(body.error?.message ?? `Model endpoint returned HTTP ${response.status}`)
    }
    const text = contentText(body.choices?.[0]?.message?.content)
    if (!text.trim()) throw new Error('Model endpoint returned no assistant content')
    return text
  }
}
