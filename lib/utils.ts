/**
 * Truncate a name for display, adding ".." suffix if too long.
 */
export function shortName(name: string | null | undefined, maxLen = 11): string {
  const n = String(name || '')
  return n.length > maxLen ? n.slice(0, maxLen) + '..' : n
}
