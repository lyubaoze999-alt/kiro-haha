import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import type { Workspace, WorkspaceValidationResult } from '../../types/kiro'

export function WorkspaceSettings() {
  const {
    workspaces,
    currentWorkspaceId,
    validation,
    isLoading,
    error,
    fetchAll,
    createWorkspace,
    switchWorkspace,
    deleteWorkspace,
    refreshValidationForCurrent,
  } = useWorkspaceStore()

  const [newRootPath, setNewRootPath] = useState('')
  const [newName, setNewName] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const current = workspaces.find((w) => w.id === currentWorkspaceId) || null

  const handleCreate = async () => {
    if (!newRootPath.trim()) return
    setActionError(null)
    try {
      await createWorkspace(newRootPath.trim(), newName.trim() || undefined)
      setNewRootPath('')
      setNewName('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'failed to create workspace')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Workspace</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          每个 Workspace 对应一个 Kiro 项目根目录。新建会话会自动绑定当前 Workspace，并以其
          rootPath 作为 ACP cwd。
        </p>
      </section>

      {/* 当前 Workspace 状态卡 */}
      <section
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: 16,
          background: 'var(--color-surface)',
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>当前 Workspace</h3>
        {current ? (
          <CurrentWorkspaceCard workspace={current} validation={validation} onRescan={refreshValidationForCurrent} />
        ) : (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>尚未选择 Workspace。</p>
        )}
      </section>

      {/* 创建新 Workspace */}
      <section>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>添加 Workspace</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 600 }}>
          <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>项目根目录</label>
          <Input
            value={newRootPath}
            onChange={(e) => setNewRootPath(e.target.value)}
            placeholder="/Users/.../my-project"
          />
          <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>名称（可选）</label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="留空则使用目录名"
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={handleCreate} disabled={!newRootPath.trim() || isLoading}>
              添加
            </Button>
          </div>
          {actionError && <div style={{ color: 'var(--color-danger)', fontSize: 12 }}>{actionError}</div>}
        </div>
      </section>

      {/* Workspace 列表 */}
      <section>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>所有 Workspace</h3>
        {workspaces.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>还没有 Workspace。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workspaces.map((w) => (
              <WorkspaceRow
                key={w.id}
                workspace={w}
                isCurrent={w.id === currentWorkspaceId}
                onSwitch={() => void switchWorkspace(w.id)}
                onDelete={() => void deleteWorkspace(w.id)}
              />
            ))}
          </div>
        )}
      </section>

      {error && <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}
    </div>
  )
}

function CurrentWorkspaceCard({
  workspace,
  validation,
  onRescan,
}: {
  workspace: Workspace
  validation: WorkspaceValidationResult | null
  onRescan: () => void
}) {
  const kiroOk = validation?.hasKiroDir
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
      <div>
        <strong>{workspace.name}</strong>
      </div>
      <div style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all' }}>
        {workspace.rootPath}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ color: kiroOk ? 'var(--color-success, #2e7d32)' : 'var(--color-danger)' }}>
          {kiroOk ? '✓ .kiro 已识别' : '⚠ 未发现 .kiro'}
        </span>
        <span>skills {validation?.skillsCount ?? 0} 个</span>
        <span>steering {validation?.steeringCount ?? 0} 个</span>
        <span>{validation?.hasSettings ? 'settings ✓' : 'settings ✗'}</span>
      </div>
      {validation?.warnings && validation.warnings.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--color-warning, #b8860b)' }}>
          {validation.warnings.map((w: string, i: number) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button variant="ghost" size="sm" onClick={onRescan}>
          重新扫描
        </Button>
      </div>
    </div>
  )
}

function WorkspaceRow({
  workspace,
  isCurrent,
  onSwitch,
  onDelete,
}: {
  workspace: Workspace
  isCurrent: boolean
  onSwitch: () => void
  onDelete: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        background: isCurrent ? 'var(--color-surface-active, var(--color-surface))' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {workspace.name}
          {isCurrent && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-primary)' }}>当前</span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {workspace.rootPath}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {!isCurrent && (
          <Button size="sm" variant="ghost" onClick={onSwitch}>
            切换
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete}>
          删除
        </Button>
      </div>
    </div>
  )
}
