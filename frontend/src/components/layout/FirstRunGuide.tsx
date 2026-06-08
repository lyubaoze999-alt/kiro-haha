import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, ExternalLink, Copy } from 'lucide-react'
import { getBaseUrl } from '../../api/client'
import { useTranslation } from '../../i18n'

type CheckStatus = 'ok' | 'warn' | 'error'

type Check = {
  id: string
  label: string
  status: CheckStatus
  detail?: string
  action?: string
}

type DoctorResponse = {
  ok: boolean
  blocking: boolean
  checks: Check[]
  platform?: string
  kiroBinPath?: string
}

/**
 * First-launch self-check banner.
 *
 * Hits /api/doctor on mount. If any check is `status: 'error'` we surface
 * a blocking modal with actionable copy (`kiro-cli login` etc.) so users
 * who skipped the install steps in the README aren't dropped into a UI
 * that just silently fails on every action.
 *
 * Localstorage key suppresses the modal for 24h after dismissal so it
 * doesn't nag users who deliberately want to defer setup.
 */
const SUPPRESS_KEY = 'kiro-haha-doctor-suppress-until'
const SUPPRESS_HOURS = 24

export function FirstRunGuide() {
  const t = useTranslation()
  const [data, setData] = useState<DoctorResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const fetchDoctor = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${getBaseUrl().replace(/\/$/, '')}/api/doctor`)
      if (!r.ok) return
      const j = (await r.json()) as DoctorResponse
      setData(j)
    } catch { /* offline / adapter not up — silently skip */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Skip the check if user dismissed within suppression window.
    try {
      const until = Number(localStorage.getItem(SUPPRESS_KEY) || '0')
      if (until > Date.now()) { setDismissed(true); return }
    } catch {}
    void fetchDoctor()
  }, [])

  if (dismissed) return null
  if (!data || !data.blocking) return null

  const errors = data.checks.filter((c) => c.status === 'error')

  const handleDismiss = () => {
    try { localStorage.setItem(SUPPRESS_KEY, String(Date.now() + SUPPRESS_HOURS * 3600 * 1000)) } catch {}
    setDismissed(true)
  }

  const handleRetry = () => { void fetchDoctor() }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
    >
      <div className="w-full max-w-[520px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[0_24px_60px_rgba(27,28,26,0.28)]">
        {/* header */}
        <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full" style={{ background: 'color-mix(in srgb, var(--color-warning) 18%, var(--color-surface-container-lowest))' }}>
            <AlertTriangle size={18} className="text-[var(--color-warning)]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="first-run-title" className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {t('firstRun.title')}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
              {t('firstRun.subtitle')}
            </p>
          </div>
        </div>

        {/* checks */}
        <div className="px-5 py-4 space-y-2">
          {data.checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </div>

        {/* actionable hint for the most common error */}
        {errors.find((e) => e.action === 'kiro_cli_login') && (
          <CodeBlock code="kiro-cli login" />
        )}

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button
            type="button"
            onClick={handleDismiss}
            className="text-[12px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            {t('firstRun.dismissFor24h')}
          </button>
          <button
            type="button"
            onClick={handleRetry}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {t('firstRun.retry')}
          </button>
        </div>
      </div>
    </div>
  )
}

function CheckRow({ check }: { check: Check }) {
  const isOk = check.status === 'ok'
  const isErr = check.status === 'error'
  const icon = isOk
    ? <CheckCircle2 size={14} className="text-[var(--color-success)]" />
    : isErr
      ? <AlertTriangle size={14} className="text-[var(--color-error)]" />
      : <AlertTriangle size={14} className="text-[var(--color-warning)]" />
  return (
    <div className="flex items-start gap-2 rounded-lg px-2 py-1.5" style={isErr ? { background: 'color-mix(in srgb, var(--color-error-container) 38%, var(--color-surface-container-lowest))' } : undefined}>
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-[var(--color-text-primary)]">{check.label}</div>
        {check.detail && (
          <div className="mt-0.5 break-all font-mono text-[11px] leading-snug text-[var(--color-text-secondary)]">
            {check.detail}
          </div>
        )}
      </div>
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <div className="mx-5 mb-4 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container)] px-3 py-2">
      <code className="flex-1 truncate font-mono text-[12px] text-[var(--color-text-primary)]">$ {code}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
      >
        <Copy size={11} />
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  )
}

// avoid unused import warning if i18n falls back
void ExternalLink
