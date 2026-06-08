import { useEffect } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUIStore } from '../../stores/uiStore'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'

/**
 * Sidebar 顶部 Workspace 状态卡：
 * - 当前项目名 / rootPath
 * - .kiro 状态（已识别 / 未发现）
 * - skills / steering 数量
 * - 操作：选择 Workspace、配置（进入 Settings）
 */
export function SidebarWorkspaceCard() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const validation = useWorkspaceStore((s) => s.validation)
  const fetchAll = useWorkspaceStore((s) => s.fetchAll)
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace)

  const setPendingSettingsTab = useUIStore((s) => s.setPendingSettingsTab)
  const openTab = useTabStore((s) => s.openTab)

  useEffect(() => { void fetchAll() }, [fetchAll])

  const current = workspaces.find((w) => w.id === currentWorkspaceId) || null

  const goToWorkspaceSettings = () => {
    setPendingSettingsTab('workspace')
    try { openTab(SETTINGS_TAB_ID, '设置', 'settings' as never) } catch { /* ignore */ }
  }

  if (!current) {
    return (
      <div
        style={{
          padding: '10px 12px',
          margin: '6px 8px',
          border: '1px dashed var(--color-border)',
          borderRadius: 8,
          background: 'var(--color-surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>未选择 Workspace</div>
        <button
          onClick={goToWorkspaceSettings}
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 12,
            cursor: 'pointer',
            color: 'var(--color-text-primary)',
          }}
        >
          选择项目 →
        </button>
      </div>
    )
  }

  const kiroOk = validation?.hasKiroDir
  const handleQuickSwitch = () => {
    if (workspaces.length <= 1) {
      goToWorkspaceSettings()
      return
    }
    const idx = workspaces.findIndex((w) => w.id === currentWorkspaceId)
    const next = workspaces[(idx + 1) % workspaces.length]
    if (next) void switchWorkspace(next.id)
  }

  return (
    <div
      style={{
        padding: '10px 12px',
        margin: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current.name}
        </strong>
        <span
          style={{
            fontSize: 10,
            padding: '1px 5px',
            borderRadius: 3,
            background: kiroOk ? 'rgba(46,125,50,0.12)' : 'rgba(212,75,75,0.12)',
            color: kiroOk ? '#2e7d32' : 'var(--color-danger)',
            flexShrink: 0,
          }}
        >
          {kiroOk ? '.kiro ✓' : '无 .kiro'}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono, monospace)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={current.rootPath}
      >
        {current.rootPath}
      </div>
      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
        <span>skills {validation?.skillsCount ?? 0}</span>
        <span>steering {validation?.steeringCount ?? 0}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          onClick={handleQuickSwitch}
          style={{
            flex: 1,
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '3px 6px',
            fontSize: 11,
            cursor: 'pointer',
            color: 'var(--color-text-primary)',
          }}
        >
          {workspaces.length > 1 ? '切换' : '选择'}
        </button>
        <button
          onClick={goToWorkspaceSettings}
          style={{
            flex: 1,
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '3px 6px',
            fontSize: 11,
            cursor: 'pointer',
            color: 'var(--color-text-primary)',
          }}
        >
          配置
        </button>
      </div>
    </div>
  )
}
