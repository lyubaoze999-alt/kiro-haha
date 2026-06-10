import { useEffect, useMemo, useState } from 'react'
import { useKiroAcpStore } from '../../stores/kiroAcpStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUIStore } from '../../stores/uiStore'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useSessionStore } from '../../stores/sessionStore'
import { projectSkillsApi } from '../../api/kiro'

// Per-project skill names cache, shared across all RuntimeContextCard instances.
// Keyed by projectRoot. TTL 30s — Skill changes don't happen mid-session typically.
const skillNamesCache = new Map<string, { names: string[]; at: number }>()
const SKILL_TTL_MS = 30_000
const inFlightScans = new Map<string, Promise<string[]>>()

async function getProjectSkillNames(projectRoot: string): Promise<string[]> {
  const now = Date.now()
  const hit = skillNamesCache.get(projectRoot)
  if (hit && now - hit.at < SKILL_TTL_MS) return hit.names
  const inFlight = inFlightScans.get(projectRoot)
  if (inFlight) return inFlight
  const p = (async () => {
    try {
      const res = await projectSkillsApi.scan(projectRoot)
      const names = (res?.skills || []).map((s) => s.name)
      skillNamesCache.set(projectRoot, { names, at: Date.now() })
      return names
    } finally {
      inFlightScans.delete(projectRoot)
    }
  })()
  inFlightScans.set(projectRoot, p)
  return p
}

/**
 * 右侧面板顶部：只读运行上下文卡片
 *
 * Performance note: do NOT call fetchConfig / fetchAll here. Each opened
 * session mounts its own RuntimeContextCard; if every card fires its own
 * HTTP fetches we issue O(N_sessions) duplicate requests on tab switch.
 * Instead we read whatever is already in the stores (Sidebar card and
 * Settings page bootstrap them once) and only do a per-projectRoot
 * project-skills scan with module-level cache + in-flight de-dup.
 */
export function RuntimeContextCard({ sessionId }: { sessionId: string }) {
  const acpStatus = useKiroAcpStore((s) => s.acpStatus)
  const acpCwd = useKiroAcpStore((s) => s.acpCwd)
  const acpSessionId = useKiroAcpStore((s) => s.acpSessionId)
  const config = useKiroAcpStore((s) => s.config)

  const currentWs = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.currentWorkspaceId) || null)
  const validation = useWorkspaceStore((s) => s.validation)

  const setPendingSettingsTab = useUIStore((s) => s.setPendingSettingsTab)
  const openTab = useTabStore((s) => s.openTab)

  // Subscribe only to the workDir of the *one* session this card belongs to,
  // not the entire sessions array. Otherwise every chatStore tick on any
  // other tab forces this card (and any other tab's card) to re-render.
  const sessionWorkDir = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId)?.workDir ?? null)
  const sessionTitle = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId)?.title ?? '')
  // Keep `currentSession` shape only for downstream usage compat.
  const currentSession = useMemo(
    () => (sessionWorkDir ? { id: sessionId, title: sessionTitle, workDir: sessionWorkDir } : null),
    [sessionId, sessionWorkDir, sessionTitle],
  )

  const [skillNames, setSkillNames] = useState<string[]>([])

  const projectRoot = currentSession?.workDir || currentWs?.rootPath || null

  useEffect(() => {
    if (!projectRoot) { setSkillNames([]); return }
    let cancelled = false
    getProjectSkillNames(projectRoot).then((names) => {
      if (!cancelled) setSkillNames(names)
    }).catch(() => { if (!cancelled) setSkillNames([]) })
    return () => { cancelled = true }
  }, [projectRoot])

  const goToSettings = (tab: 'workspace' | 'kiroAcp' | 'steering' | 'kiroSkills') => {
    setPendingSettingsTab(tab)
    try { openTab(SETTINGS_TAB_ID, '设置', 'settings' as never) } catch { /* ignore */ }
  }

  const cwd = acpCwd || projectRoot || '—'
  const skillsCount = validation?.skillsCount ?? skillNames.length
  const steeringCount = validation?.steeringCount ?? 0

  return (
    <div
      style={{
        margin: 8,
        padding: 10,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-surface-container-lowest, var(--color-surface))',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
      data-testid="runtime-context-card"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>运行上下文</strong>
        <span
          style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 3,
            background: acpStatus === 'connected' ? 'rgba(46,125,50,0.12)' : acpStatus === 'error' ? 'rgba(212,75,75,0.12)' : 'rgba(120,120,120,0.12)',
            color: acpStatus === 'connected' ? '#2e7d32' : acpStatus === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)',
          }}
        >
          ACP {acpStatus}
        </span>
      </div>

      <Row label="cwd">
        <span style={{ fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all' }}>{cwd}</span>
      </Row>
      <Row label="sessionId">
        <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--color-text-muted)' }}>
          {acpSessionId || sessionId.slice(0, 12)}
        </span>
      </Row>
      <Row label="agent">
        <span>{config?.defaultAgent || currentWs?.agentName || 'kiro_default'}</span>
      </Row>
      <Row label="skills">
        <span>{skillsCount} 个</span>
      </Row>
      <Row label="steering">
        <span>{steeringCount} 个</span>
      </Row>

      {skillNames.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ color: 'var(--color-text-muted)', marginBottom: 2 }}>可见 Skills</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {skillNames.slice(0, 8).map((n) => (
              <span
                key={n}
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'var(--color-surface-hover)',
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {n}
              </span>
            ))}
            {skillNames.length > 8 && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>+{skillNames.length - 8}</span>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
        <NavButton onClick={() => goToSettings('workspace')}>Workspace</NavButton>
        <NavButton onClick={() => goToSettings('kiroAcp')}>Kiro ACP</NavButton>
        <NavButton onClick={() => goToSettings('steering')}>Steering</NavButton>
        <NavButton onClick={() => goToSettings('kiroSkills')}>Skills</NavButton>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 6, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{label}</span>
      <span style={{ overflow: 'hidden' }}>{children}</span>
    </div>
  )
}

function NavButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        padding: '3px 8px',
        fontSize: 11,
        cursor: 'pointer',
        color: 'var(--color-text-primary)',
      }}
    >
      去 Settings · {children}
    </button>
  )
}
