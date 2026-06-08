import { useState, useRef } from 'react'
import { Zap } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useQuotaSummary, formatNumber, formatResetDate } from './useQuotaSummary'

/**
 * Compact composer-toolbar chip. Account-level credits also live in the
 * Sidebar via {@link SidebarQuotaCard}; this chip is kept for parity with
 * pre-v3 layouts so users who learned the old position can still find it.
 */
export function QuotaIndicator({ compact = false }: { compact?: boolean }) {
  const t = useTranslation()
  const { data, refreshing, refresh, derived } = useQuotaSummary()
  const [hover, setHover] = useState(false)
  const triggerRef = useRef<HTMLDivElement | null>(null)

  if (!data || !data.available) {
    // Sidebar card already surfaces the unavailable state with a clear CTA.
    // Keep the composer chip clean — return null when quota is missing.
    return null
  }

  const { used, limit, pct, toneColorVar, overUsed } = derived
  const plan = data.plan || 'Kiro'

  return (
    <div
      ref={triggerRef}
      className="relative flex items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums hover:bg-[var(--color-surface-hover)]/40 disabled:opacity-60"
        style={{ color: toneColorVar }}
        title={`${plan} · ${t('quota.clickToRefresh')}`}
      >
        <Zap size={12} strokeWidth={2} className={refreshing ? 'animate-pulse' : ''} />
        {!compact && (
          <span>
            {formatNumber(used)} / {formatNumber(limit)}
          </span>
        )}
      </button>

      {hover && (
        <div
          role="tooltip"
          className="absolute bottom-full right-0 z-50 mb-2 w-[280px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px] shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[var(--color-brand)]" />
              <span className="font-medium">{plan}</span>
            </div>
            {data.nextResetAt && (
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {t('quota.resetOn', { date: formatResetDate(data.nextResetAt) })}
              </span>
            )}
          </div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[var(--color-text-secondary)]">{t('quota.used')}</span>
            <span className="font-medium tabular-nums" style={{ color: toneColorVar }}>
              {used.toFixed(2)} / {limit.toFixed(0)} credits
            </span>
          </div>
          <div className="my-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-container-low)]">
            <div
              className="h-full transition-all"
              style={{ width: `${Math.max(2, pct)}%`, background: toneColorVar }}
            />
          </div>
          {data.overageEnabled && (
            <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
              <span>{t('quota.overage')} · {t('quota.overageOn')}</span>
              {overUsed && data.overage !== undefined && (
                <span className="text-[var(--color-error)]">+{data.overage.toFixed(2)}</span>
              )}
            </div>
          )}
          {data.fetchedAt && (
            <div className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
              {t('quota.lastUpdated', { secs: Math.floor((Date.now() - data.fetchedAt) / 1000) })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
