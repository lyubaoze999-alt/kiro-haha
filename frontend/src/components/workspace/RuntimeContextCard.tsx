import { useEffect, useMemo } from 'react'
import { useKiroAcpStore } from '../../stores/kiroAcpStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUIStore } from '../../stores/uiStore'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useSessionStore } from '../../stores/sessionStore'
import { projectSkillsApi } from '../../api/kiro'
import { useState } from 'react'

/**
 * 右侧面板顶部：只读运行上下文卡片
 * - ACP Connected
 * - 当前 session/new cwd
 * - 默认 Agent
 * - 可见 Skills 数 / steering 数
 * - 当前项目可见 Skills 列表（前 N 个）
 * - "去 Settings 管理"入口
 *
 * 严格只读：不在此面板做任何配置编辑。
 */
export function RuntimeContextCard({ sessionId }: { sessionId: string }) {
  const acpStatus = useKiroAcpStore((s) => s.acpStatus)
  const acpCwd = useKiroAcpStore((s) => s.acpCwd)
  const acpSessionId = useKiroAcpStore((s) => s.acpSessionId)
  const config = useKiroAcpStore((s) => s.config)
  const fetchConfig = useKiroAcpStore((s) => s.fetchConfig)

  const currentWs = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.currentWorkspaceId) || null)
  const validation = useWorkspaceStore((s) => s.validation)
  const fetchAll = useWorkspaceStore((s) => s.fetchAll)

  const setPendingSettingsTab = useUIStore((s) => s.setPendingSettingsTab)
  const openTab = useTabStore((s) => s.openTab)

  const sessions = useSessionStore((s) => s.sessions)
  const currentSession = useMemo(() => sessions.find((s) => s.id === sessionId) || null, [sessions, sessionId])

  const [skillNames, setSkillNames] = useState<string[]>([])

  const projectRoot = currentSession?.workDir || currentWs?.rootPath || null

  useEffect(() => { void fetchConfig() }, [fetchConfig])
  useEffect(() => { void fetchAll() }, [fetchAll])

  useEffect(() => {
    if (!projectRoot) return
    let cancelled = false
    projectSkillsApi.scan(projectRoot).then((res) => {
      if (cancelled) return
      setSkillNames(res.skills.map((s) => s.name))
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
