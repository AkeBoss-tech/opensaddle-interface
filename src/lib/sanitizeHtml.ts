const ALLOWED_TAGS = new Set(['A', 'B', 'BR', 'CODE', 'EM', 'I', 'LI', 'OL', 'P', 'PRE', 'STRONG', 'UL'])
const ALLOWED_ATTRS = new Set(['href', 'target', 'rel'])

export function safeHref(value: string) {
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('./') || value.startsWith('../')) return value
  try {
    const url = new URL(value, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function sanitizeHtml(input: string) {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return input.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
  }
  const doc = new DOMParser().parseFromString(input, 'text/html')
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent ?? ''))
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        if (!ALLOWED_ATTRS.has(attr.name)) child.removeAttribute(attr.name)
      }
      if (child.tagName === 'A') {
        const href = child.getAttribute('href')
        const safe = href ? safeHref(href) : null
        if (!safe) child.removeAttribute('href')
        else child.setAttribute('href', safe)
        child.setAttribute('rel', 'noopener noreferrer')
        child.setAttribute('target', '_blank')
      }
      walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}
