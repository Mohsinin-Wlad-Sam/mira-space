import { useSyncExternalStore } from 'react'

/** The census progress feed the sky viewer also reads (web/public/data/summary.json). */
export interface CensusSummary {
  updated: string
  tiles_done: number
  tiles_total: number
  sky_fraction: number
  n_det: number
  n_rows: number
  n_reliable_motion: number
}

const URL = '/data/summary.json'
const REFRESH_MS = 120_000

let current: CensusSummary | null = null
let timer = 0
const listeners = new Set<() => void>()

async function refresh(): Promise<void> {
  try {
    const r = await fetch(URL, { cache: 'no-store' })
    if (!r.ok) return
    const json = (await r.json()) as CensusSummary
    if (typeof json?.tiles_total !== 'number') return
    current = json
    listeners.forEach((fn) => fn())
  } catch {
    // Feed missing or not JSON (e.g. dev without synced data): keep the static copy.
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  if (listeners.size === 1) {
    void refresh()
    timer = window.setInterval(refresh, REFRESH_MS)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) window.clearInterval(timer)
  }
}

/** Live census summary, shared by every component (one fetch, refreshed every 2 min). Null until loaded. */
export function useSummary(): CensusSummary | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}

export const tilesLabel = (s: CensusSummary): string =>
  s.tiles_done >= s.tiles_total - 5 ? 'whole-sky census complete' : `census: ${s.tiles_done.toLocaleString()} / ${s.tiles_total.toLocaleString()} sky tiles`
