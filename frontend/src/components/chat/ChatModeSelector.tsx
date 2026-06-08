import { useState, useRef, useEffect } from 'react'
import { useKiroAcpStore } from '../../stores/kiroAcpStore'
import type { ChatMode } from '../../types/kiro'

const MODE_LABELS: Record<ChatMode, { label: string; hint: string }> = {
  auto_project_skills: {
    label: '自动 Skills',
    hint: '自动使用项目 Skills（默认）',
  },
  debug_check_skills: {
    label: 'Debug Skills',
    hint: '强制检查 Skills 后回答',
  },
  plain: {
    label: '普通',
    hint: '普通对话',
  },
}

const MODES: ChatMode[] = ['auto_project_skills', 'debug_check_skills', 'plain']

export function ChatModeSelector({ compact = false }: { compact?: boolean }) {
  const chatMode = useKiroAcpStore((s) => s.chatMode)
  const setChatMode = useKiroAcpStore((s) => s.setChatMode)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = MODE_LABELS[chatMode]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={current.hint}
        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        style={{
          padding: compact ? '4px 6px' : '5px 8px',
          fontSize: 12,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>auto_awesome</span>
        <span>{current.label}</span>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_drop_down</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            minWidth: 220,
            background: 'var(--color-surface-container-lowest)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-dropdown)',
            padding: 4,
          }}
        >
          {MODES.map((m) => {
            const opt = MODE_LABELS[m]
            const active = m === chatMode
            return (
              <button
                key={m}
                type="button"
                onClick={() => { setChatMode(m); setOpen(false) }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 12,
                  background: active ? 'var(--color-surface-hover)' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--color-text-primary)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = active ? 'var(--color-surface-hover)' : 'transparent' }}
              >
                <span style={{ fontWeight: 600 }}>{opt.label}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{opt.hint}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
