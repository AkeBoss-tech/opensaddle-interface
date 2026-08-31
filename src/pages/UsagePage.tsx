import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DiscoveredLocalProject, Project, PublicTokenPrice, TokenBreakdown, UsageBucket } from '../types'
import '../styles/usage-pricing.css'

type Measure = 'tokens' | 'cached' | 'cost' | 'sessions'
type TimeRange = '7' | '14' | '30' | '90' | '180' | '365' | 'all'
type SliceDimension = { key: string; label: string; tokens: number; cached: number; cacheWrite: number; cost: number; sessions: Set<string>; measuredSessions: Set<string>; costSessions: Set<string> }
type DayDimension = SliceDimension & { day: string }

const measureLabels: Record<Measure, string> = { tokens: 'Tokens', cached: 'Cached reads', cost: 'Estimated cost', sessions: 'Sessions' }
const timeRanges: Array<{ value: TimeRange; label: string }> = [
  { value: '7', label: 'Last week' },
  { value: '14', label: 'Last 2 weeks' },
  { value: '30', label: 'Last month' },
  { value: '90', label: 'Last 3 months' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last year' },
  { value: 'all', label: 'All observed' },
]

function compact(value: number) { return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value) }
function money(value: number | null, digits = 2) { return value === null ? 'Unavailable' : Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(value) }
function normalizedPath(value: string) { return value.replaceAll('\\', '/').replace(/\/+$/, '') }
function emptyBreakdown(): TokenBreakdown { return { uncachedInputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningTokens: 0, unclassifiedTokens: 0 } }
function addBreakdown(target: TokenBreakdown, value: TokenBreakdown) { for (const key of Object.keys(target) as Array<keyof TokenBreakdown>) target[key] += value[key] }
function newDimension(key: string, label: string): SliceDimension { return { key, label, tokens: 0, cached: 0, cacheWrite: 0, cost: 0, sessions: new Set(), measuredSessions: new Set(), costSessions: new Set() } }
function addBucket(target: SliceDimension, bucket: UsageBucket) { target.tokens += bucket.tokens; target.cached += bucket.tokenBreakdown.cachedInputTokens; target.cacheWrite += bucket.tokenBreakdown.cacheWriteInputTokens; target.cost += bucket.costLowerUsd; target.sessions.add(bucket.sessionKey); if (bucket.tokenMeasurement === 'measured') target.measuredSessions.add(bucket.sessionKey); if (bucket.costMeasurement !== 'unavailable') target.costSessions.add(bucket.sessionKey) }
function valueFor(row: SliceDimension, measure: Measure) { return measure === 'tokens' ? row.tokens : measure === 'cached' ? row.cached : measure === 'cost' ? row.cost : row.sessions.size }
function formatValue(value: number, measure: Measure) { return measure === 'cost' ? money(value) : compact(value) }
function costRange(lower: number, upper: number) { return Math.abs(upper - lower) > 0.000000001 ? `${money(lower)}–${money(upper)}` : money(lower) }
function rate(value: number | undefined) { return value === undefined ? '—' : money(value, value < 1 ? 3 : 2) }

function TimeRangeSelect({ value, onChange, compact = false }: { value: TimeRange; onChange: (value: TimeRange) => void; compact?: boolean }) {
  return <label className={compact ? 'pricing-chart-range' : undefined}>{compact ? 'Window' : 'Time range'}<select value={value} onChange={(event) => onChange(event.target.value as TimeRange)}>{timeRanges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}</select></label>
}

function RankedBars({ rows, measure, empty }: { rows: SliceDimension[]; measure: Measure; empty: string }) {
  const sorted = [...rows].filter((row) => valueFor(row, measure) > 0).sort((a, b) => valueFor(b, measure) - valueFor(a, measure)).slice(0, 8)
  const maximum = Math.max(...sorted.map((row) => valueFor(row, measure)), 0)
  if (!sorted.length || !maximum) return <div className="pricing-chart-empty">{empty}</div>
  return <div className="pricing-bars">{sorted.map((row, index) => <div className="pricing-bar-row" key={row.key}>
    <div><strong>{row.label}</strong><small>{row.sessions.size.toLocaleString()} session{row.sessions.size === 1 ? '' : 's'}</small></div>
    <div className="pricing-bar-track"><i className={`chart-color-${index % 6}`} style={{ width: `${Math.max(valueFor(row, measure) / maximum * 100, 1.5)}%` }} /></div>
    <b>{formatValue(valueFor(row, measure), measure)}</b>
  </div>)}</div>
}

function CacheByModel({ rows }: { rows: SliceDimension[] }) {
  const sorted = [...rows].filter((row) => row.cached || row.cacheWrite).sort((a, b) => b.cached - a.cached).slice(0, 8)
  const maximum = Math.max(...sorted.map((row) => row.cached + row.cacheWrite), 0)
  if (!sorted.length || !maximum) return <div className="pricing-chart-empty">No model-level cache measurements exist for these filters.</div>
  return <div className="pricing-cache-models">{sorted.map((row) => {
    const totalInput = row.tokens > 0 ? row.tokens : 0
    const utilization = totalInput ? row.cached / totalInput * 100 : 0
    return <div key={row.key} className="pricing-cache-row"><div><strong>{row.label}</strong><small>{utilization.toFixed(1)}% of observed tokens were cache reads</small></div><div className="pricing-cache-track"><i className="cache-read" style={{ width: `${row.cached / maximum * 100}%` }} /><i className="cache-write" style={{ width: `${row.cacheWrite / maximum * 100}%` }} /></div><b>{compact(row.cached)}</b><small>{row.cacheWrite ? `${compact(row.cacheWrite)} writes` : 'No writes'}</small></div>
  })}<div className="pricing-cache-key"><span><i className="cache-read" />Cached reads</span><span><i className="cache-write" />Cache writes</span></div></div>
}

function LineChart({ rows, measure, empty }: { rows: DayDimension[]; measure: Measure; empty: string }) {
  const maximum = Math.max(...rows.map((row) => valueFor(row, measure)), 0)
  if (!rows.length || !maximum) return <div className="pricing-chart-empty">{empty}</div>
  const data = rows.map((row) => ({ day: row.day, timestamp: new Date(`${row.day}T00:00:00`).getTime(), value: valueFor(row, measure) }))
  const dateLabel = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return <div className="pricing-trend" role="img" aria-label={`${measureLabels[measure]} over time`}><ResponsiveContainer width="100%" height={232}>
    <AreaChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 4 }}>
      <CartesianGrid stroke="var(--border)" vertical={false} />
      <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => dateLabel(new Date(Number(value)).toISOString().slice(0, 10))} minTickGap={34} tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
      <YAxis width={54} tickFormatter={(value) => formatValue(Number(value), measure)} tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} />
      <Tooltip labelFormatter={(label) => dateLabel(new Date(Number(label)).toISOString().slice(0, 10))} formatter={(value) => [formatValue(Number(value), measure), measureLabels[measure]]} contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
      <Area type="linear" dataKey="value" stroke="#80a9ff" fill="#80a9ff" fillOpacity={0.14} strokeWidth={2.25} activeDot={{ r: 5, fill: '#80a9ff', stroke: 'var(--surface)', strokeWidth: 2 }} />
    </AreaChart>
  </ResponsiveContainer></div>
}

function HarnessCoverage({ rows }: { rows: SliceDimension[] }) {
  const data = rows.map((row) => ({ name: row.label, measured: row.measuredSessions.size, unavailable: Math.max(row.sessions.size - row.measuredSessions.size, 0) })).filter((row) => row.measured || row.unavailable)
  if (!data.length) return <div className="pricing-chart-empty">No indexed harness sessions exist for these filters.</div>
  return <div className="pricing-coverage-chart"><ResponsiveContainer width="100%" height={Math.max(210, data.length * 58)}>
    <BarChart data={data} layout="vertical" margin={{ top: 12, right: 22, bottom: 8, left: 16 }}>
      <CartesianGrid stroke="var(--border)" horizontal={false} />
      <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
      <YAxis type="category" dataKey="name" width={90} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name === 'measured' ? 'Token-measured sessions' : 'Session metadata only']} contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
      <Legend formatter={(value) => value === 'measured' ? 'Token-measured' : 'Session metadata only'} wrapperStyle={{ color: 'var(--dim)', fontSize: 10 }} />
      <Bar dataKey="measured" stackId="coverage" fill="#80a9ff" radius={[5, 0, 0, 5]} />
      <Bar dataKey="unavailable" stackId="coverage" fill="#697382" radius={[0, 5, 5, 0]} />
    </BarChart>
  </ResponsiveContainer></div>
}

function TokenComposition({ breakdown }: { breakdown: TokenBreakdown }) {
  const rows = [['Uncached input', breakdown.uncachedInputTokens], ['Cached read', breakdown.cachedInputTokens], ['Cache write', breakdown.cacheWriteInputTokens], ['Output', breakdown.outputTokens], ['Reasoning', breakdown.reasoningTokens], ['Unclassified', breakdown.unclassifiedTokens]] as const
  const total = rows.reduce((sum, [, value]) => sum + value, 0)
  if (!total) return <div className="pricing-chart-empty">No token-class breakdown was reported for these filters.</div>
  return <div className="pricing-composition"><div className="pricing-stack">{rows.filter(([, value]) => value > 0).map(([label, value], index) => <i className={`chart-color-${index % 6}`} key={label} style={{ width: `${value / total * 100}%` }} title={`${label}: ${value.toLocaleString()}`} />)}</div><div className="pricing-legend">{rows.map(([label, value], index) => <div key={label}><i className={`chart-color-${index % 6}`} /><span>{label}</span><strong>{compact(value)}</strong><small>{Math.round(value / total * 100)}%</small></div>)}</div></div>
}

export function UsagePage({ projects, activeProject }: { projects: DiscoveredLocalProject[]; activeProject: Project | null }) {
  const [prices, setPrices] = useState<PublicTokenPrice[]>([])
  const [priceReady, setPriceReady] = useState(false)
  const [query, setQuery] = useState('')
  const [showAllPrices, setShowAllPrices] = useState(false)
  const [days, setDays] = useState<TimeRange>('30')
  const [modelKey, setModelKey] = useState('all')
  const [harnessKey, setHarnessKey] = useState('all')
  const [measure, setMeasure] = useState<Measure>('tokens')

  useEffect(() => { let cancelled = false; if (!window.opensaddle?.listTokenPrices) { setPriceReady(true); return }; void window.opensaddle.listTokenPrices().then((rows) => { if (!cancelled) setPrices(rows) }).finally(() => { if (!cancelled) setPriceReady(true) }); return () => { cancelled = true } }, [])

  const project = useMemo(() => { const root = activeProject?.local?.rootPath; if (!root) return null; return projects.find((candidate) => normalizedPath(candidate.rootPath) === normalizedPath(root)) ?? null }, [activeProject, projects])
  const options = useMemo(() => ({
    models: [...new Map((project?.usageAnalytics.buckets ?? []).map((bucket) => [bucket.modelKey, bucket.modelLabel])).entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    harnesses: [...new Map((project?.usageAnalytics.buckets ?? []).map((bucket) => [bucket.harnessKey, bucket.harnessLabel])).entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
  }), [project])

  const slice = useMemo(() => {
    const allBuckets = project?.usageAnalytics.buckets ?? []
    const latestDay = allBuckets.reduce((latest, bucket) => bucket.day > latest ? bucket.day : latest, '')
    const cutoff = days === 'all' || !latestDay ? '' : new Date(new Date(`${latestDay}T00:00:00`).getTime() - (Number(days) - 1) * 86_400_000).toISOString().slice(0, 10)
    const buckets = allBuckets.filter((bucket) => (!cutoff || bucket.day >= cutoff) && (modelKey === 'all' || bucket.modelKey === modelKey) && (harnessKey === 'all' || bucket.harnessKey === harnessKey))
    const models = new Map<string, SliceDimension>(), harnesses = new Map<string, SliceDimension>(), daily = new Map<string, DayDimension>()
    const breakdown = emptyBreakdown(); let tokens = 0, lower = 0, upper = 0
    const sessions = new Set<string>(), measuredSessions = new Set<string>(), costSessions = new Set<string>()
    for (const bucket of buckets) {
      tokens += bucket.tokens; lower += bucket.costLowerUsd; upper += bucket.costUpperUsd; sessions.add(bucket.sessionKey); addBreakdown(breakdown, bucket.tokenBreakdown)
      if (bucket.tokenMeasurement === 'measured') measuredSessions.add(bucket.sessionKey)
      if (bucket.costMeasurement !== 'unavailable') costSessions.add(bucket.sessionKey)
      const model = models.get(bucket.modelKey) ?? newDimension(bucket.modelKey, bucket.modelLabel); addBucket(model, bucket); models.set(bucket.modelKey, model)
      const harness = harnesses.get(bucket.harnessKey) ?? newDimension(bucket.harnessKey, bucket.harnessLabel); addBucket(harness, bucket); harnesses.set(bucket.harnessKey, harness)
      const day = daily.get(bucket.day) ?? { ...newDimension(bucket.day, bucket.day), day: bucket.day }; addBucket(day, bucket); daily.set(bucket.day, day)
    }
    return { buckets, models: [...models.values()], harnesses: [...harnesses.values()], daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)), breakdown, tokens, lower, upper, sessions: sessions.size, measuredSessions: measuredSessions.size, costSessions: costSessions.size }
  }, [days, harnessKey, modelKey, project])

  const inputTotal = slice.breakdown.uncachedInputTokens + slice.breakdown.cachedInputTokens + slice.breakdown.cacheWriteInputTokens
  const cacheUtilization = inputTotal ? slice.breakdown.cachedInputTokens / inputTotal : 0
  const usedModels = new Set(slice.models.filter((row) => row.tokens > 0).map((row) => row.label.toLowerCase().replace(/^(openai|anthropic)\//, '')))
  const visiblePrices = prices.filter((price) => { const normalized = price.modelId.toLowerCase(); return (showAllPrices || [...usedModels].some((model) => normalized === model || normalized.endsWith(`/${model}`))) && normalized.includes(query.trim().toLowerCase()) })

  return <div className="content-page pricing-page">
    <header className="page-header pricing-header"><div className="page-header-copy"><div className="eyebrow">Measured usage · {activeProject?.name ?? 'No project selected'}</div><h1>Tokens &amp; pricing</h1><p>Filterable model, harness, cache, session, cost, and token analytics for this project only.</p></div><div className="pricing-trust"><span className={priceReady && prices.length ? 'ready' : 'unavailable'} />{priceReady ? prices.length ? `${prices.length} priced model offerings` : 'Pricing catalog unavailable' : 'Loading pricing catalog…'}</div></header>
    {!project ? <section className="pricing-scope-empty"><strong>No measured usage matched this project</strong><p>{activeProject?.local?.rootPath ? `No Codex or Claude usage record matched ${activeProject.local.rootPath}.` : 'This project has no registered local source folder, so usage cannot be attributed without guessing.'}</p></section> : <>
      <section className="pricing-filter-bar" aria-label="Usage filters"><TimeRangeSelect value={days} onChange={setDays} /><label>Model<select value={modelKey} onChange={(event) => setModelKey(event.target.value)}><option value="all">All models</option>{options.models.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label>Harness<select value={harnessKey} onChange={(event) => setHarnessKey(event.target.value)}><option value="all">All harnesses</option>{options.harnesses.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label>Measure<select value={measure} onChange={(event) => setMeasure(event.target.value as Measure)}>{Object.entries(measureLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" onClick={() => { setDays('30'); setModelKey('all'); setHarnessKey('all'); setMeasure('tokens') }}>Reset</button></section>
      <div className="task-summary pricing-summary"><article className="summary-card"><span className="label">Observed tokens</span><strong>{slice.measuredSessions ? compact(slice.tokens) : 'Unavailable'}</strong><span className="metric-sub">{slice.measuredSessions.toLocaleString()} of {slice.sessions.toLocaleString()} sessions report tokens</span></article><article className="summary-card"><span className="label">Estimated token cost</span><strong>{slice.costSessions ? costRange(slice.lower, slice.upper) : 'Unavailable'}</strong><span className="metric-sub">{slice.costSessions.toLocaleString()} sessions have estimated or reported cost</span></article><article className="summary-card"><span className="label">Sessions</span><strong>{slice.sessions.toLocaleString()}</strong><span className="metric-sub">Distinct indexed agent sessions</span></article><article className="summary-card"><span className="label">Cache utilization</span><strong>{inputTotal ? `${(cacheUtilization * 100).toFixed(1)}%` : 'Unavailable'}</strong><span className="metric-sub">Cached reads ÷ measured input tokens</span></article></div>
      <div className="pricing-dashboard-grid">
        <section className="pricing-card pricing-chart-card pricing-trend-card"><header><div><span>Movement</span><h2>{measureLabels[measure]} over time</h2></div><div className="pricing-chart-range-group"><small>{slice.daily.length} observed day{slice.daily.length === 1 ? '' : 's'}</small><TimeRangeSelect value={days} onChange={setDays} compact /></div></header><LineChart rows={slice.daily} measure={measure} empty={`No ${measureLabels[measure].toLowerCase()} exist for these filters.`} /></section>
        <section className="pricing-card pricing-chart-card"><header><div><span>Composition</span><h2>Token types</h2></div><small>Filtered token denominator</small></header><TokenComposition breakdown={slice.breakdown} /></section>
        <section className="pricing-card pricing-chart-card"><header><div><span>Cache behavior</span><h2>Cached tokens by model</h2></div><small>Reads and writes remain separate</small></header><CacheByModel rows={slice.models} /></section>
        <section className="pricing-card pricing-chart-card"><header><div><span>Model comparison</span><h2>{measureLabels[measure]} by model</h2></div><small>Top 8</small></header><RankedBars rows={slice.models} measure={measure} empty="No model measurements exist for these filters." /></section>
        <section className="pricing-card pricing-chart-card"><header><div><span>Harness comparison</span><h2>{measureLabels[measure]} by harness</h2></div></header><RankedBars rows={slice.harnesses} measure={measure} empty="No harness measurements exist for these filters." /></section>
        <section className="pricing-card pricing-chart-card"><header><div><span>Coverage</span><h2>Session coverage by harness</h2></div><small>Measured tokens vs metadata-only sessions</small></header><HarnessCoverage rows={slice.harnesses} /></section>
        <section className="pricing-card pricing-chart-card"><header><div><span>Session movement</span><h2>Sessions over time</h2></div><small>Distinct sessions by day</small></header><LineChart rows={slice.daily} measure="sessions" empty="No sessions exist for these filters." /></section>
        <section className="pricing-card pricing-chart-card"><header><div><span>Cost movement</span><h2>Estimated cost over time</h2></div><small>Lower-bound estimate</small></header><LineChart rows={slice.daily} measure="cost" empty="No priced usage exists for these filters." /></section>
      </div>
      <section className="pricing-card"><header><div><span>Project evidence</span><h2>{project.name} usage details</h2></div><small>{project.rootPath}</small></header><div className="pricing-facts"><div><span>Indexed harnesses</span><strong>{slice.harnesses.map((row) => row.label).join(', ') || 'None'}</strong></div><div><span>Token sources</span><strong>{project.tokenUsageSources.join(', ') || 'No token source'}</strong></div><div><span>Token coverage</span><strong>{slice.measuredSessions.toLocaleString()} / {slice.sessions.toLocaleString()} sessions</strong></div><div><span>Cached reads</span><strong>{slice.breakdown.cachedInputTokens.toLocaleString()}</strong></div><div><span>Cache writes</span><strong>{slice.breakdown.cacheWriteInputTokens.toLocaleString()}</strong></div></div></section>
      <section className="pricing-card"><header><div><span>Rate catalog</span><h2>{showAllPrices ? 'All model token prices' : 'Rates for filtered project models'}</h2></div><div className="pricing-rate-controls"><button type="button" onClick={() => setShowAllPrices((value) => !value)}>{showAllPrices ? 'Show filtered models' : 'Show full catalog'}</button><label>Filter models<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="openai/gpt or anthropic/claude" /></label></div></header><div className="pricing-table-wrap pricing-rates"><table className="pricing-table"><thead><tr><th>Offering</th><th>Context tier</th><th>Input / 1M</th><th>Cached read / 1M</th><th>Cache write / 1M</th><th>Output / 1M</th><th>Reasoning / 1M</th></tr></thead><tbody>{visiblePrices.flatMap((price) => price.tiers.map((tier, index) => <tr key={`${price.modelId}:${index}`}><td><strong>{price.modelId}</strong><small>{price.source}</small></td><td>{tier.minPromptTokens ? `≥ ${compact(tier.minPromptTokens)} input` : 'Base'}</td><td>{rate(tier.inputUsdPerMillion)}</td><td>{rate(tier.cachedInputUsdPerMillion)}</td><td>{rate(tier.cacheWriteUsdPerMillion)}</td><td>{rate(tier.outputUsdPerMillion)}</td><td>{rate(tier.reasoningUsdPerMillion)}</td></tr>))}</tbody></table></div>{!visiblePrices.length && <p className="pricing-empty">{priceReady ? 'No priced offering matches the filtered models.' : 'Loading model prices…'}</p>}</section>
    </>}
    <aside className="pricing-method"><strong>Metric definitions</strong><p>Time windows anchor to the latest observed session. Claude Code totals come from per-session assistant usage records when available, with the latest-session project summary used only as a fallback. Cursor exposes reliable local session metadata but generally does not expose cumulative billed tokens; those sessions appear as metadata-only instead of receiving invented token totals. Cache utilization is cached reads divided by measured input tokens.</p></aside>
  </div>
}
