/** Match the host router for links shared by independently mounted applications. */
export function applicationRouteHref(route: string, query: URLSearchParams): string {
  const protocol = typeof window === 'undefined' ? 'https:' : (window.location?.protocol ?? 'https:')
  const path = `${route}?${query}`
  return protocol === 'http:' || protocol === 'https:' ? path : `#/${path}`
}
