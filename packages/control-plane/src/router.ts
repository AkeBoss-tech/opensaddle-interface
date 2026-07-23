import type { ControlPlaneConfig } from './config.js'
import type { CodingProvider, Harness, ModelKey, RouteEstimate, RouteTelemetry, RuntimeKind } from './types.js'

const CODING = /\b(code|implement|refactor|repository|repo|pull request|bug|test|typescript|python|build|fix|debug)\b/i
const RESEARCH = /\b(research|compare|sources|report|analy[sz]e|investigate|literature|cite)\b/i
const BROWSER = /\b(browser|website|web page|click|navigate|scrape|form|salesforce)\b/i
const RESTRICTED = /\b(pii|regulated|confidential|restricted|patient|customer data)\b/i
const GPU = /\b(gpu|cuda|train|fine[- ]?tune|embedding batch)\b/i

/** Hard / architecture-heavy coding work → quality models. */
const HARD = /\b(architect|architecture|design system|migrate|migration|security|auth|permissions|concurrency|distributed|performance|optimize|rewrite|multi[- ]?file|large refactor)\b/i
/** Quick / narrow coding work → faster cheaper models. */
const EASY = /\b(typo|rename|comment|docstring|lint|format|one[- ]?liner|trivial|simple|quick|tiny|whitespace)\b/i
const SHORT_TASK = 80

function configuredModel(config: ControlPlaneConfig, preferred: Exclude<ModelKey, 'auto'>): Exclude<ModelKey, 'auto'> {
  if (config.modelRoutes[preferred]) return preferred
  if (config.modelRoutes[config.defaultModel]) return config.defaultModel
  const first = Object.keys(config.modelRoutes)[0] as Exclude<ModelKey, 'auto'> | undefined
  return first ?? config.defaultModel
}

/** Pick a model for the task complexity when the user left Auto on. */
function optimizeModelForTask(
  task: string,
  harnessKey: Harness,
  routingPref?: string,
): { model: Exclude<ModelKey, 'auto'>; reason?: string } {
  if (routingPref === 'quality') return { model: 'claude', reason: 'Quality preference → strongest available model' }
  if (routingPref === 'fast') return { model: 'sonnet', reason: 'Latency preference → faster model' }
  if (routingPref === 'cost') return { model: 'llama', reason: 'Cost preference → economical model' }
  if (routingPref === 'local') return { model: 'llama', reason: 'Local-only preference → on-device model' }
  if (routingPref === 'enterprise') return { model: 'llama', reason: 'Enterprise preference → approved model' }

  if (harnessKey === 'coding') {
    if (HARD.test(task)) return { model: 'claude', reason: 'Complex coding task → high-capability model' }
    if (EASY.test(task) || task.trim().length < SHORT_TASK) {
      return { model: 'sonnet', reason: 'Narrow coding task → faster model' }
    }
    return { model: 'gpt', reason: 'Standard coding task → balanced model' }
  }
  if (harnessKey === 'research') return { model: 'gpt', reason: 'Research task → long-context synthesis model' }
  if (harnessKey === 'browser') return { model: 'sonnet', reason: 'Browser task → responsive tool-use model' }
  return { model: 'sonnet', reason: undefined }
}

export function estimateRoute(
  task: string,
  config: ControlPlaneConfig,
  overrides: {
    modelKey?: ModelKey
    modelId?: string
    harnessKey?: Harness
    runtimeKey?: RuntimeKind
    providerKey?: CodingProvider
    routingPref?: string
    telemetry?: RouteTelemetry[]
  } = {},
): RouteEstimate {
  let harnessKey: Harness = 'chat'
  let runtimeKey: RuntimeKind = config.runtimeProvider === 'docker' ? 'sandbox' : 'local'
  const reasons: string[] = []

  if (CODING.test(task)) {
    harnessKey = 'coding'
    reasons.push('Coding task detected')
  } else if (RESEARCH.test(task)) {
    harnessKey = 'research'
    reasons.push('Research and synthesis task detected')
  } else if (BROWSER.test(task)) {
    harnessKey = 'browser'
    runtimeKey = 'browser'
    reasons.push('Browser interaction detected')
  } else {
    reasons.push('Direct conversational task')
  }

  if (RESTRICTED.test(task)) {
    runtimeKey = 'restricted'
    reasons.push('Restricted-data terms require an isolated runtime')
  } else if (GPU.test(task)) {
    runtimeKey = 'gpu'
    reasons.push('GPU workload detected')
  }

  if (overrides.routingPref === 'local') {
    runtimeKey = 'local'
  }

  if (overrides.harnessKey) {
    harnessKey = overrides.harnessKey
    reasons.push('Harness explicitly selected')
  }
  if (overrides.runtimeKey) {
    runtimeKey = overrides.runtimeKey
    reasons.push('Runtime explicitly selected')
  }

  const optimized = optimizeModelForTask(task, harnessKey, overrides.routingPref)
  let preferredModel: Exclude<ModelKey, 'auto'> = optimized.model
  if (optimized.reason && !(overrides.modelKey && overrides.modelKey !== 'auto')) {
    reasons.push(optimized.reason)
  }

  if (overrides.modelKey && overrides.modelKey !== 'auto') {
    preferredModel = overrides.modelKey
    reasons.push('Model explicitly selected')
  }

  let providerKey: Exclude<CodingProvider, 'auto'> = config.defaultCodingProvider
  if (harnessKey === 'coding') {
    if (overrides.providerKey && overrides.providerKey !== 'auto') {
      providerKey = overrides.providerKey
      reasons.push(`Coding provider explicitly selected: ${providerKey}`)
    } else {
      // Prefer highest-affinity available provider when the default is missing
      // from the allowlist; otherwise stick to the configured default.
      providerKey = (config.codingProviders.includes(config.defaultCodingProvider)
        ? config.defaultCodingProvider
        : (config.codingProviders[0] as Exclude<CodingProvider, 'auto'> | undefined) ?? 'opensaddle')
      reasons.push(`Coding provider default: ${providerKey}`)
    }
  } else {
    providerKey = 'opensaddle'
  }

  if (
    (!overrides.modelKey || overrides.modelKey === 'auto')
    && (!overrides.providerKey || overrides.providerKey === 'auto')
    && !overrides.routingPref
    && overrides.telemetry
  ) {
    const candidates = new Map<string, { rows: RouteTelemetry[]; model: Exclude<ModelKey, 'auto'>; provider: Exclude<CodingProvider, 'auto'> }>()
    for (const row of overrides.telemetry.filter((item) => item.harnessKey === harnessKey)) {
      const key = `${row.modelKey}:${row.providerKey}`
      const candidate = candidates.get(key) ?? { rows: [], model: row.modelKey, provider: row.providerKey }
      candidate.rows.push(row)
      candidates.set(key, candidate)
    }
    const learned = [...candidates.values()]
      .filter((candidate) => candidate.rows.length >= 3)
      .filter((candidate) => config.modelRoutes[candidate.model])
      .filter((candidate) => harnessKey !== 'coding' || config.codingProviders.includes(candidate.provider))
      .map((candidate) => {
        const successRate = candidate.rows.filter((row) => row.succeeded).length / candidate.rows.length
        const averageMs = candidate.rows.reduce((sum, row) => sum + row.durationMs, 0) / candidate.rows.length
        const averageCost = candidate.rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) / candidate.rows.length
        return { ...candidate, successRate, averageMs, score: successRate * 1000 - averageMs / 1000 - averageCost * 100 }
      })
      .sort((left, right) => right.score - left.score)[0]
    if (learned && learned.successRate >= 0.6) {
      preferredModel = learned.model
      providerKey = learned.provider
      reasons.push(`Auto learned from ${learned.rows.length} runs: ${Math.round(learned.successRate * 100)}% success, ${Math.round(learned.averageMs)} ms average`)
    }
  }

  const externalCodingCli = harnessKey === 'coding' && providerKey !== 'opensaddle'
  const explicitModel = Boolean(overrides.modelId) || Boolean(overrides.modelKey && overrides.modelKey !== 'auto')
  const nativeModelDefault = externalCodingCli && !explicitModel
  if (nativeModelDefault) reasons.push(`${providerKey} native model router selected`)
  const modelKey = externalCodingCli ? preferredModel : configuredModel(config, preferredModel)
  if (modelKey !== preferredModel && config.modelRoutes[modelKey]) {
    reasons.push(`Preferred model unavailable; routed to configured ${modelKey} endpoint`)
  }
  if (!externalCodingCli && !config.modelRoutes[modelKey]) {
    reasons.push('No model endpoint is configured; runs will remain unavailable until one is added')
  }

  return {
    modelKey,
    modelId: nativeModelDefault ? undefined : overrides.modelId,
    harnessKey,
    providerKey,
    nativeModelDefault,
    runtimeKey,
    reasons,
    cost: externalCodingCli
      ? 'CLI provider metering'
      : config.modelRoutes[modelKey]
      ? config.modelProvider === 'openrouter'
        && config.modelRoutes[modelKey]?.model === 'openrouter/free'
        ? 'free via OpenRouter'
        : 'provider metering'
      : 'not configured',
    alternatives: [
      { modelKey: configuredModel(config, 'gpt'), harnessKey, score: 0.86 },
      { modelKey: configuredModel(config, HARD.test(task) ? 'claude' : 'sonnet'), harnessKey, score: 0.78 },
      { modelKey: configuredModel(config, 'llama'), harnessKey, score: 0.68 },
    ],
  }
}
