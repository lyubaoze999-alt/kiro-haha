import { useRef, useState } from 'react'
import { Zap, RefreshCw } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useQuotaSummary, formatNumber, formatResetDate } from '../chat/useQuotaSummary'
import { MobileBottomSheet } from '../shared/MobileBottomSheet'

type Mode = 'expanded' | 'collapsed' | 'mobile'

type Props = {
  mode: Mode
}

/**
 * Account-level credits indicator that lives at the top of Sidebar
 * (just below the brand strip, above the NavItems).
 *
 * - expanded: full card with label + amount + plan pill + progress + footer
 * - collapsed: 44x44 icon button with status dot, popover on hover/focus
 * - mobile: compact card; tap opens MobileBottomSheet with full detail
 */
export function SidebarQuotaCard({ mode }: Props) {
  const t = useTranslation()
  const { data, refreshing, refresh, derived } = useQuotaSummary()
  const { tone, toneColorVar, pct, used, limit, remaining, overUsed } = derived
  const plan = data?.plan || 'Kiro Power'
  const available = !!data?.available

  // ── Card frame styling per tone ───────────────────────────────────
  const frameStyle: React.CSSProperties = (() => {
    if (!available) {
      return {
        borderColor: 'var(--color-border)',
        background: 'color-mix(in srgb, var(--color-surface-container-lowest) 70%, transparent)',
      }
    }
    if (tone === 'danger') {
      return {
        borderColor: 'color-mix(in srgb, var(--color-error) 38%, var(--color-border))',
        background: 'color-mix(in srgb, var(--color-error-container) 36%, var(--color-surface-container-lowest))',
      }
    }
    if (tone === 'warning') {
      return {
        borderColor: 'color-mix(in srgb, var(--color-warning) 42%, var(--color-border))',
        background: 'color-mix(in srgb, var(--color-warning-container) 50%, var(--color-surface-container-lowest))',
      }
    }
    return {
      borderColor: 'var(--color-border)',
      background: 'var(--color-surface-container-lowest)',
    }
  })()

  // ── Footer text per tone ──────────────────────────────────────────
  const footerLeft = !available
    ? t('quota.errorMeta')
    : tone === 'warning'
      ? t('quota.warningHint')
      : tone === 'danger'
        ? t('quota.dangerHint')
        : data?.nextResetAt
          ? t('quota.resetOn', { date: formatResetDate(data.nextResetAt) })
          : ''
  const footerRight = !available
    ? t('quota.retry')
    : `${Math.round(pct)}%`

  const amountText = available
    ? `${formatNumber(used)} / ${formatNumber(limit)}`
    : t('quota.emptyAmount')

  // ── Hover popover state for expanded / collapsed ──────────────────
  const [hovered, setHovered] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // ── Render: collapsed (rail) ──────────────────────────────────────
  if (mode === 'collapsed') {
    return (
      <div
        ref={containerRef}
        className="relative flex w-full justify-center"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          type="button"
          onClick={() => available && refresh()}
          aria-label={`${plan} · ${amountText}`}
          title={`${plan} · ${amountText}`}
          className="relative flex h-11 w-11 items-center justify-center rounded-[14px] border bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-sidebar-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          style={{ borderColor: frameStyle.borderColor as string }}
        >
          <Zap size={16} strokeWidth={2} className={refreshing ? 'animate-pulse' : ''} style={{ color: toneColorVar }} aria-hidden="true" />
          {/* status dot in lower-right */}
          <span
            aria-hidden="true"
            className="absolute right-1 bottom-1 h-2 w-2 rounded-full ring-2 ring-[var(--color-surface-sidebar)]"
            style={{ background: toneColorVar }}
          />
        </button>
        {hovered && <RailTooltip plan={plan} pct={pct} used={used} limit={limit} remaining={remaining} tone={tone} toneColorVar={toneColorVar} available={available} nextResetAt={data?.nextResetAt} t={t} onRefresh={refresh} refreshing={refreshing} />}
      </div>
    )
  }

  // ── Render: mobile (tap → BottomSheet) ────────────────────────────
  if (mode === 'mobile') {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-[14px] border px-3 py-2 text-left transition-colors hover:bg-[var(--color-sidebar-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          style={frameStyle}
          aria-label={`${plan} · ${amountText}`}
        >
          <ZapBadge color={toneColorVar} pulsing={refreshing} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{plan}</span>
              {available && <PlanPill text={planTier(plan)} />}
            </div>
            <div className="mt-0.5 truncate font-mono text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">
              {amountText}
            </div>
            <ProgressBar pct={available ? pct : 0} color={toneColorVar} />
            <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
              <span className="truncate">{footerLeft}</span>
              <span className="font-semibold text-[var(--color-text-secondary)]">{footerRight}</span>
            </div>
          </div>
        </button>
        <MobileBottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={t('quota.detailTitle')}
          headerExtra={
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] disabled:opacity-60"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
              {t('quota.refresh')}
            </button>
          }
        >
          <div className="px-4 py-4">
            <DetailBody plan={plan} used={used} limit={limit} remaining={remaining} pct={pct} tone={tone} toneColorVar={toneColorVar} available={available} overageEnabled={data?.overageEnabled} overage={data?.overage} overUsed={overUsed} nextResetAt={data?.nextResetAt} fetchedAt={data?.fetchedAt} t={t} />
          </div>
        </MobileBottomSheet>
      </>
    )
  }

  // ── Render: expanded (desktop sidebar default) ────────────────────
  return (
    <div
      ref={containerRef}
      className="relative px-3 pb-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => available && refresh()}
        disabled={!available && refreshing}
        className="group flex w-full items-center gap-2 rounded-[12px] border px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-sidebar-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        style={frameStyle}
        aria-label={`${plan} · ${amountText}`}
        title={available ? t('quota.clickToRefresh') : t('quota.errorTitle')}
      >
        <ZapBadge color={toneColorVar} pulsing={refreshing} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]" style={{ letterSpacing: '0.06em' }}>
              {plan}
            </span>
            {available
              ? <PlanPill text={planTier(plan)} />
              : <span className="text-[10px] font-semibold text-[var(--color-text-tertiary)]">{t('quota.retry')}</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">
            {amountText}
          </div>
          <ProgressBar pct={available ? pct : 0} color={toneColorVar} />
          <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
            <span className="truncate">{footerLeft}</span>
            <span className="font-semibold text-[var(--color-text-secondary)] tabular-nums">{footerRight}</span>
          </div>
        </div>
      </button>

      {hovered && available && (
        <div
          role="tooltip"
          className="absolute left-3 right-3 top-full z-50 mt-1 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3 text-[12px] shadow-[0_10px_30px_rgba(27,28,26,0.12)]"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={13} style={{ color: toneColorVar }} />
              <span className="font-semibold text-[var(--color-text-primary)]">{plan}</span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); refresh() }}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] disabled:opacity-60"
            >
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
              {t('quota.refresh')}
            </button>
          </div>
          <DetailBody plan={plan} used={used} limit={limit} remaining={remaining} pct={pct} tone={tone} toneColorVar={toneColorVar} available={available} overageEnabled={data?.overageEnabled} overage={data?.overage} overUsed={overUsed} nextResetAt={data?.nextResetAt} fetchedAt={data?.fetchedAt} t={t} />
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function ZapBadge({ color, pulsing }: { color: string; pulsing?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border"
      style={{
        background: 'color-mix(in srgb, var(--color-warning-container) 65%, var(--color-surface-container-lowest))',
        borderColor: 'color-mix(in srgb, var(--color-warning) 30%, var(--color-border))',
      }}
    >
      <Zap size={13} strokeWidth={2.2} className={pulsing ? 'animate-pulse' : ''} style={{ color }} />
    </span>
  )
}

function PlanPill({ text }: { text: string }) {
  if (!text) return null
  return (
    <span
      className="rounded-full border px-2 py-[1px] text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface-container-low)',
      }}
    >
      {text}
    </span>
  )
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      className="mt-1.5 h-1 overflow-hidden rounded-full"
      style={{ background: 'var(--color-surface-container-high)' }}
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${Math.max(2, pct)}%`, background: color }}
      />
    </div>
  )
}

type DetailBodyProps = {
  plan: string
  used: number
  limit: number
  remaining: number
  pct: number
  tone: string
  toneColorVar: string
  available: boolean
  overageEnabled?: boolean
  overage?: number
  overUsed: boolean
  nextResetAt?: number | null
  fetchedAt?: number
  t: (key: any, params?: Record<string, string | number>) => string
}

function DetailBody({ used, limit, remaining, pct, toneColorVar, available, overageEnabled, overage, overUsed, nextResetAt, fetchedAt, t }: DetailBodyProps) {
  if (!available) {
    return (
      <div className="text-[12px] text-[var(--color-text-secondary)]">
        <p className="mb-2">{t('quota.errorTitle')}</p>
        <p className="text-[var(--color-text-tertiary)]">{t('quota.errorBody')}</p>
      </div>
    )
  }
  return (
    <>
      <div className="flex items-center justify-between text-[12px] text-[var(--color-text-secondary)]">
        <span>{t('quota.used')}</span>
        <span className="font-mono font-semibold tabular-nums" style={{ color: toneColorVar }}>
          {formatNumber(used)} / {formatNumber(limit)} credits
        </span>
      </div>
      <div className="my-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-surface-container-high)' }}>
        <div className="h-full transition-[width]" style={{ width: `${Math.max(2, pct)}%`, background: toneColorVar }} />
      </div>
      <div className="flex items-center justify-between text-[12px] text-[var(--color-text-secondary)]">
        <span>{t('quota.remaining')}</span>
        <span className="font-mono font-semibold tabular-nums">{formatNumber(remaining)} credits</span>
      </div>
      {nextResetAt && (
        <div className="mt-1.5 flex items-center justify-between text-[12px] text-[var(--color-text-secondary)]">
          <span>{t('quota.resetTime')}</span>
          <span className="font-medium">{formatResetDate(nextResetAt)}</span>
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between text-[12px] text-[var(--color-text-secondary)]">
        <span>{t('quota.overage')}</span>
        <span className="font-medium">
          {overageEnabled
            ? overUsed && overage !== undefined
              ? <span style={{ color: 'var(--color-error)' }}>+{formatNumber(overage)}</span>
              : t('quota.overageOn')
            : <span className="text-[var(--color-text-tertiary)]">{t('quota.overageOff')}</span>}
        </span>
      </div>
      {fetchedAt && (
        <div className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
          {t('quota.lastUpdated', { secs: Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000)) })}
        </div>
      )}
    </>
  )
}

function RailTooltip({ plan, pct, used, limit, remaining, toneColorVar, available, nextResetAt, t, onRefresh, refreshing }: {
  plan: string
  pct: number
  used: number
  limit: number
  remaining: number
  tone: string
  toneColorVar: string
  available: boolean
  nextResetAt?: number | null
  t: (k: any, p?: Record<string, string | number>) => string
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <div
      role="tooltip"
      className="absolute left-full top-0 z-50 ml-2 w-[220px] rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-3 text-[12px] shadow-[0_10px_30px_rgba(27,28,26,0.12)]"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={13} style={{ color: toneColorVar }} />
          <span className="font-semibold text-[var(--color-text-primary)]">{plan}</span>
        </div>
        {available && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRefresh() }}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] disabled:opacity-60"
          >
            <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            {t('quota.refresh')}
          </button>
        )}
      </div>
      {available ? (
        <>
          <div className="flex items-center justify-between text-[12px] text-[var(--color-text-secondary)]">
            <span>{t('quota.used')}</span>
            <span className="font-mono font-semibold tabular-nums" style={{ color: toneColorVar }}>{formatNumber(used)}</span>
          </div>
          <div className="my-2 h-1 overflow-hidden rounded-full" style={{ background: 'var(--color-surface-container-high)' }}>
            <div className="h-full transition-[width]" style={{ width: `${Math.max(2, pct)}%`, background: toneColorVar }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-[var(--color-text-secondary)]">
            <span>{t('quota.remaining')}</span>
            <span className="font-mono tabular-nums">{formatNumber(remaining)} / {formatNumber(limit)}</span>
          </div>
          {nextResetAt && (
            <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--color-text-tertiary)]">
              <span>{t('quota.resetTime')}</span>
              <span>{formatResetDate(nextResetAt)}</span>
            </div>
          )}
        </>
      ) : (
        <p className="text-[12px] text-[var(--color-text-secondary)]">{t('quota.errorTitle')}</p>
      )}
    </div>
  )
}

// Detect tier text from plan string ("Kiro Power Pro" -> "Pro").
function planTier(plan: string): string {
  if (!plan) return ''
  const m = plan.match(/\b(Free|Pro|Power|Plus|Team|Enterprise|Max)\b/i)
  if (m && m[1]) return m[1]
  const parts = plan.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] || '' : ''
}
