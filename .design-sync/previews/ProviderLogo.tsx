import { ProviderLogo, PROVIDER_NAME, type ModelProvider } from 'opensaddle-interface'

const PROVIDERS: ModelProvider[] = ['openai', 'anthropic', 'google', 'meta', 'openrouter', 'opensaddle']

export function Default() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, padding: 16, background: 'var(--bg)', color: 'var(--text)' }}>
      {PROVIDERS.map((provider) => (
        <div key={provider} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
          <ProviderLogo provider={provider} className="icon lg" />
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{PROVIDER_NAME[provider]}</span>
        </div>
      ))}
    </div>
  )
}

export function FromLabel() {
  const labels = ['Claude Sonnet', 'GPT-4o', 'Gemini 1.5 Pro']
  return (
    <div style={{ display: 'flex', gap: 20, padding: 16, background: 'var(--bg)', color: 'var(--text)' }}>
      {labels.map((label) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ProviderLogo label={label} className="icon" />
          <span style={{ fontSize: 12 }}>{label}</span>
        </div>
      ))}
    </div>
  )
}
