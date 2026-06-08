import { useCallback, useEffect, useState } from 'react'
import { getBaseUrl } from '../../api/client'

export type QuotaSummary = {
  available: boolean
  fetchedAt?: number
  plan?: string
  used?: number
  limit?: number
  overage?: number
  overageCap?: number
  overageEnabled?: boolean
  nextResetAt?: number | null
  error?: string | null
}

export type QuotaTone = 'normal' | 'warning' | 'danger' | 'unavailable'

export type QuotaDerived = {
  pct: number          // 0-100
  used: number
  limit: number
  remaining: number
  tone: QuotaTone
  toneColorVar: string // CSS var, e.g. var(--color-brand)
  overUsed: boolean
}

// Mirror kiro IDE: no background polling. Refresh on:
//   1. mount (one-time, reads adapter cache)
//   2. user click (force ?refresh=1)
//   3. WS new session (handled adapter-side)
export function useQuotaSummary() {
  const [data, setData] = useState<QuotaSummary | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchQuota = useCallback(async (forceRefresh: boolean) => {
    try {
      if (forceRefresh) setRefreshing(true)
      const url = `${getBaseUrl().replace(/\/$/, '')}/api/quota${forceRefresh ? '?refresh=1' : ''}`
      const r = await fetch(url)
      if (!r.ok) {
        // adapter returned non-200 (e.g. token expired) -> mark unavailable but keep card visible
        setData({ available: false, error: `HTTP ${r.status}` })
        return
      }
      const j = (await r.json()) as QuotaSummary
      setData(j)
    } catch (e) {
      setData({ available: false, error: e instanceof Error ? e.message : 'fetch failed' })
    } finally {
      if (forceRefresh) setRefreshing(false)
    }
  }, [])

  useEffect(() => { void fetchQuota(false) }, [fetchQuota])

  const derive = (q: QuotaSummary | null): QuotaDerived => {
    if (!q || !q.available) {
      return {
        pct: 0,
        used: 0,
        limit: 0,
        remaining: 0,
        tone: 'unavailable',
        toneColorVar: 'var(--color-text-tertiary)',
        overUsed: false,
      }
    }
    const used = q.used ?? 0
    const limit = q.limit ?? 0
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
    const overUsed = (q.overage ?? 0) > 0
    let tone: QuotaTone = 'normal'
    if (overUsed || pct > 85) tone = 'danger'
    else if (pct > 60) tone = 'warning'
    const toneColorVar = tone === 'danger'
      ? 'var(--color-error)'
      : tone === 'warning'
        ? 'var(--color-warning)'
        : 'var(--color-brand)'
    return {
      pct,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      tone,
      toneColorVar,
      overUsed,
    }
  }

  return {
    data,
    refreshing,
    refresh: () => void fetchQuota(true),
    derived: derive(data),
  }
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1000) return Math.round(n).toLocaleString('en-US')
  if (n >= 100) return n.toFixed(0)
  return n.toFixed(2).replace(/\.?0+$/, '')
}

export function formatResetDate(ts: number | null | undefined, locale?: string): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  } catch { return '' }
}
