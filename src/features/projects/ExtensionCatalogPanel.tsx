import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/common/Icon'
import type {
  ExtensionCatalogClient,
  ExtensionContribution,
  ProjectExtensionEnablement,
} from '../../services/contracts'

const kindLabels: Record<ExtensionContribution['kind'], string> = {
  resource_type: 'Resources', action: 'Actions', workflow_blueprint: 'Workflows',
  factory_blueprint: 'Factories', participant: 'Participants', evaluator: 'Evaluators',
  perspective: 'Perspectives', artifact_type: 'Artifacts', runtime_requirement: 'Runtime',
}

export function ExtensionCatalogPanel(props: {
  projectId: string
  client?: ExtensionCatalogClient
  onError: (message: string) => void
}) {
  const [extensions, setExtensions] = useState<ProjectExtensionEnablement[]>([])
  const [contributions, setContributions] = useState<ExtensionContribution[]>([])
  const [loading, setLoading] = useState(Boolean(props.client))

  useEffect(() => {
    let active = true
    if (!props.client) return () => { active = false }
    setLoading(true)
    setExtensions([])
    setContributions([])
    Promise.all([
      props.client.projectExtensions(props.projectId),
      props.client.contributions(props.projectId),
    ]).then(([nextExtensions, nextContributions]) => {
      if (!active) return
      setExtensions(nextExtensions)
      setContributions(nextContributions)
    }).catch((error) => {
      if (active) props.onError(error instanceof Error ? error.message : String(error))
    }).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [props.client, props.onError, props.projectId])

  const groups = useMemo(() => Object.entries(
    contributions.reduce<Partial<Record<ExtensionContribution['kind'], ExtensionContribution[]>>>((result, item) => {
      result[item.kind] = [...(result[item.kind] ?? []), item]
      return result
    }, {}),
  ) as Array<[ExtensionContribution['kind'], ExtensionContribution[]]>, [contributions])

  if (!props.client) return null
  return (
    <section className="tw-extensions" aria-labelledby="extension-catalog-title">
      <div className="tw-extension-heading">
        <span className="tw-self-driving-icon"><Icon name="plugin" className="icon sm" /></span>
        <div>
          <span className="tw-kicker">Extensible project</span>
          <h2 id="extension-catalog-title">Extension capabilities</h2>
          <p>Signed packages contribute declarative resources, actions, factories, participants, evaluators, and Perspectives. Enablement grants no authority by itself.</p>
        </div>
        <span className="tw-goal-status">{extensions.filter((item) => item.status === 'enabled').length} enabled</span>
      </div>
      {loading ? <p className="tw-extension-empty">Loading the authoritative project catalog…</p> : contributions.length === 0 ? (
        <p className="tw-extension-empty">No signed extension package is enabled for this project.</p>
      ) : (
        <div className="tw-extension-groups">
          {groups.map(([kind, items]) => (
            <article key={kind}>
              <strong>{kindLabels[kind]}</strong>
              {items.map((item) => (
                <div key={item.contributionId}>
                  <span>{item.title}</span>
                  <small>{item.packageId} · {item.packageVersion}{item.effect === 'write' ? ' · approval-bound write descriptor' : ''}</small>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
