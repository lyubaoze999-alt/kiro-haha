import { useEffect, useState, useCallback } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useKiroAcpStore } from '../../stores/kiroAcpStore'
import { globalSkillsApi, projectSkillsApi } from '../../api/kiro'
import { Button } from '../shared/Button'
import type { GlobalSkill, ProjectSkill } from '../../types/kiro'

const SYNC_LABEL: Record<ProjectSkill['syncStatus'], string> = {
  not_installed: '未安装',
  synced: '已同步',
  outdated: '需要更新',
  modified: '本地已修改',
  conflict: '冲突',
  local: '本地',
}

const SYNC_COLOR: Record<ProjectSkill['syncStatus'], string> = {
  not_installed: 'var(--color-text-muted)',
  synced: 'var(--color-success, #2e7d32)',
  outdated: 'var(--color-warning, #b8860b)',
  modified: 'var(--color-warning, #b8860b)',
  conflict: 'var(--color-danger)',
  local: 'var(--color-text-muted)',
}

export function KiroSkillsSettings() {
  const currentWs = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.currentWorkspaceId) || null)
  const config = useKiroAcpStore((s) => s.config)
  const fetchConfig = useKiroAcpStore((s) => s.fetchConfig)

  const [globalSkills, setGlobalSkills] = useState<GlobalSkill[]>([])
  const [projectSkills, setProjectSkills] = useState<ProjectSkill[]>([])
  const [globalRoot, setGlobalRoot] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const projectRoot = currentWs?.rootPath || ''

  useEffect(() => { void fetchConfig() }, [fetchConfig])

  const refreshGlobal = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await globalSkillsApi.scan()
      // 防御：如果 adapter server 跑旧版本（没有 /api/global-skills 路由），
      // 通用 fallback 会返回 { ok: true }，res.skills 为 undefined。
      setGlobalSkills(Array.isArray(res?.skills) ? res.skills : [])
      setGlobalRoot(typeof res?.root === 'string' ? res.root : '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to scan global skills')
      setGlobalSkills([])
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshProject = useCallback(async () => {
    if (!projectRoot) {
      setProjectSkills([])
      return
    }
    try {
      const res = await projectSkillsApi.scan(projectRoot)
      setProjectSkills(Array.isArray(res?.skills) ? res.skills : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to scan project skills')
      setProjectSkills([])
    }
  }, [projectRoot])

  useEffect(() => { void refreshGlobal() }, [refreshGlobal])
  useEffect(() => { void refreshProject() }, [refreshProject])

  const handleInstall = async (skill: GlobalSkill) => {
    if (!projectRoot) return
    try {
      await globalSkillsApi.install(skill.id, projectRoot, false)
      await refreshProject()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('已存在') || msg.includes('overwrite')) {
        if (confirm(`${skill.name} 已存在于项目中。是否覆盖？\n注意：会丢失项目本地修改。`)) {
          try {
            await globalSkillsApi.install(skill.id, projectRoot, true)
            await refreshProject()
          } catch (e2) {
            setError(e2 instanceof Error ? e2.message : 'failed')
          }
        }
      } else {
        setError(msg)
      }
    }
  }

  const handleSync = async (skill: ProjectSkill) => {
    if (!projectRoot || !skill.sourceSkillId) return
    if (skill.syncStatus === 'modified' || skill.syncStatus === 'conflict') {
      if (!confirm(`${skill.name} 状态为 ${SYNC_LABEL[skill.syncStatus]}。\n继续会用全局版本覆盖项目版本，是否继续？`)) {
        return
      }
    }
    try {
      await globalSkillsApi.sync(skill.sourceSkillId, projectRoot, true)
      await refreshProject()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sync failed')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Skills</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          全局 Skill 库只维护一份；通过同步将其安装到当前项目 <code>.kiro/skills</code>。Kiro 只稳定读取项目目录下的 Skill。
        </p>
      </section>

      {/* 全局 Skill 库 */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>全局 Skill 库（{globalSkills.length}）</h3>
          <Button size="sm" variant="ghost" onClick={refreshGlobal}>重新扫描</Button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8, fontFamily: 'var(--font-mono, monospace)' }}>
          {globalRoot || config?.globalSkillRoot || '未配置'}
        </div>
        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>加载中…</p>
        ) : globalSkills.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>暂无全局 Skill。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {globalSkills.map((s) => (
              <SkillRow
                key={s.id}
                name={s.name}
                description={s.description}
                inclusionMode={s.inclusionMode}
                status={s.status}
                warnings={s.warnings}
                actions={
                  projectRoot ? (
                    <Button size="sm" variant="ghost" onClick={() => handleInstall(s)}>安装到项目</Button>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* 项目 Skill */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>项目 Skill（{projectSkills.length}）</h3>
          <Button size="sm" variant="ghost" onClick={refreshProject}>重新扫描</Button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8, fontFamily: 'var(--font-mono, monospace)' }}>
          {projectRoot ? `${projectRoot}/.kiro/skills` : '请先选择 Workspace'}
        </div>
        {!projectRoot ? null : projectSkills.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>项目尚无 Skill。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projectSkills.map((s) => (
              <SkillRow
                key={s.id}
                name={s.name}
                description={s.description}
                inclusionMode={s.inclusionMode}
                status={s.status}
                warnings={s.warnings}
                extra={
                  <span style={{ fontSize: 11, color: SYNC_COLOR[s.syncStatus] ?? 'var(--color-text-muted)' }}>
                    {SYNC_LABEL[s.syncStatus] ?? s.syncStatus ?? '未知'}
                  </span>
                }
                actions={
                  s.source === 'global' ? (
                    <Button size="sm" variant="ghost" onClick={() => handleSync(s)}>重新同步</Button>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </section>

      {error && <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}
    </div>
  )
}

function SkillRow({
  name, description, inclusionMode, status, warnings, extra, actions,
}: {
  name: string
  description?: string
  inclusionMode?: string
  status?: string
  warnings?: string[]
  extra?: React.ReactNode
  actions?: React.ReactNode
}) {
  const safeWarnings = Array.isArray(warnings) ? warnings : []
  const safeStatus = status ?? 'ok'
  const safeMode = inclusionMode ?? 'unknown'
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 13 }}>{name}</strong>
          <span style={{
            fontSize: 11, padding: '1px 6px', borderRadius: 4,
            background: 'var(--color-surface-active, var(--color-surface))', color: 'var(--color-text-muted)',
          }}>{safeMode}</span>
          <span style={{
            fontSize: 11, padding: '1px 6px', borderRadius: 4,
            background:
              safeStatus === 'ok' ? 'var(--color-success-bg, #e8f5e9)'
              : safeStatus === 'warning' ? 'var(--color-warning-bg, #fff3e0)'
              : 'var(--color-danger-bg, #ffebee)',
            color:
              safeStatus === 'ok' ? 'var(--color-success, #2e7d32)'
              : safeStatus === 'warning' ? 'var(--color-warning, #b8860b)'
              : 'var(--color-danger)',
          }}>{safeStatus}</span>
          {extra}
        </div>
        {actions && <div style={{ display: 'flex', gap: 4 }}>{actions}</div>}
      </div>
      {description && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>{description}</p>}
      {safeWarnings.length > 0 && (
        <ul style={{ margin: '4px 0 0 0', paddingLeft: 16, color: 'var(--color-warning, #b8860b)', fontSize: 12 }}>
          {safeWarnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  )
}
