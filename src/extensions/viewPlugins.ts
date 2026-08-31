import type { DiscoveredLocalProject, DiscoveredUiPlugin, ProjectionSortDescriptor, ProjectionViewDescriptor } from '../types'

export const BUILTIN_PROJECT_SORTS: ProjectionSortDescriptor[] = [
  { id: 'opensaddle.recent', title: 'Most recent', field: 'lastSeenAt', direction: 'desc', missing: 'last' },
  { id: 'opensaddle.tokens', title: 'Most tokens', field: 'tokenUsage', direction: 'desc', missing: 'last' },
  { id: 'opensaddle.estimated-cost', title: 'Estimated token cost', field: 'estimatedCostUsd', direction: 'desc', missing: 'last' },
  { id: 'opensaddle.name', title: 'Name', field: 'name', direction: 'asc', missing: 'last' },
]

export const BUILTIN_PROJECT_VIEWS: ProjectionViewDescriptor[] = [
  { id: 'opensaddle.comfortable', title: 'Comfortable', density: 'comfortable', showPath: true, showUsage: true, showSources: true },
  { id: 'opensaddle.compact', title: 'Compact', density: 'compact', showPath: false, showUsage: true, showSources: true },
]

export function projectProjectionCatalog(plugins: DiscoveredUiPlugin[]) {
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()]
  return {
    sorts: unique([...BUILTIN_PROJECT_SORTS, ...plugins.flatMap((plugin) => plugin.projectSorts)]),
    views: unique([...BUILTIN_PROJECT_VIEWS, ...plugins.flatMap((plugin) => plugin.projectViews)]),
  }
}

function fieldValue(project: DiscoveredLocalProject, field: ProjectionSortDescriptor['field']): string | number | null {
  if (field === 'name') return project.name.toLocaleLowerCase()
  return project[field]
}

export function sortDiscoveredProjects(projects: DiscoveredLocalProject[], descriptor: ProjectionSortDescriptor) {
  return [...projects].sort((left, right) => {
    const leftValue = fieldValue(left, descriptor.field)
    const rightValue = fieldValue(right, descriptor.field)
    if (leftValue === null || rightValue === null) {
      if (leftValue === rightValue) return left.name.localeCompare(right.name)
      const missing = descriptor.missing === 'first' ? -1 : 1
      return leftValue === null ? missing : -missing
    }
    const comparison = typeof leftValue === 'string'
      ? leftValue.localeCompare(String(rightValue))
      : leftValue - Number(rightValue)
    return (descriptor.direction === 'desc' ? -comparison : comparison) || left.name.localeCompare(right.name)
  })
}
