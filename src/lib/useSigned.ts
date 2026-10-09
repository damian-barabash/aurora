import { useEffect, useState } from 'react'
import { signedUrls } from './supabase'

/** Adresy do wyświetlenia plików z prywatnego bucketu: { ścieżka: url }. */
export function useSigned(paths: (string | null | undefined)[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = [...new Set(paths.filter(Boolean))].sort().join('|')
  useEffect(() => {
    let alive = true
    if (key) signedUrls(key.split('|')).then((u) => alive && setUrls(u))
    return () => {
      alive = false
    }
  }, [key])
  return urls
}
