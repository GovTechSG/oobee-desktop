// Pure message formatting for the renderer i18n layer. Kept free of React and
// JSX so it can be unit tested directly with `node --test`.
//
// Message syntax (deliberately small):
//   {name}             -> replaced with vars.name (string, number or React node)
//   <tag>text</tag>    -> vars.tag(formattedText) when vars.tag is a function,
//                         otherwise just the inner text. Tags must not nest.
// Plurals: translate(..., key, { count }) looks up `${key}_one` when count is
// 1 and `${key}_other` otherwise, before falling back to `key`.
//
// Returns a string when every part is a string/number, otherwise an array of
// parts (strings and React nodes) that the caller renders.

const TOKEN_RE = /<([a-zA-Z][\w]*)>([\s\S]*?)<\/\1>|\{([a-zA-Z][\w.]*)\}/g

const isPrimitive = (value) => typeof value === 'string' || typeof value === 'number'

const flatten = (parts) =>
  parts.reduce((acc, part) => (Array.isArray(part) ? acc.concat(flatten(part)) : acc.concat([part])), [])

export const formatMessage = (template, vars = {}) => {
  if (typeof template !== 'string') return ''
  const values = vars || {}
  const parts = []
  let lastIndex = 0
  for (const match of template.matchAll(TOKEN_RE)) {
    if (match.index > lastIndex) parts.push(template.slice(lastIndex, match.index))
    const [whole, tagName, tagContent, varName] = match
    if (tagName !== undefined) {
      const inner = formatMessage(tagContent, values)
      const wrap = values[tagName]
      parts.push(typeof wrap === 'function' ? wrap(inner) : inner)
    } else {
      const value = values[varName]
      parts.push(value === undefined || value === null ? whole : value)
    }
    lastIndex = match.index + whole.length
  }
  if (lastIndex < template.length) parts.push(template.slice(lastIndex))

  const flat = flatten(parts)
  if (flat.every(isPrimitive)) return flat.join('')
  return flat
}

const lookup = (messages, key) =>
  messages && Object.prototype.hasOwnProperty.call(messages, key) && typeof messages[key] === 'string'
    ? messages[key]
    : undefined

const candidateKeys = (key, vars) => {
  if (vars && typeof vars.count === 'number') {
    return [`${key}_${vars.count === 1 ? 'one' : 'other'}`, key]
  }
  return [key]
}

// Resolve `key` in `messages`, falling back to `fallbackMessages` (English)
// and finally to the key itself so a missing translation is visible but never
// crashes the UI.
export const translate = (messages, fallbackMessages, key, vars) => {
  for (const candidate of candidateKeys(key, vars)) {
    const template = lookup(messages, candidate) ?? lookup(fallbackMessages, candidate)
    if (template !== undefined) return formatMessage(template, vars)
  }
  return key
}
