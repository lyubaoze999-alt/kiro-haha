import { useEffect, useState } from 'react'
import { useKiroAcpStore } from '../../stores/kiroAcpStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'

export function KiroAcpSettings() {
  const { config, isConfigLoading, configError, fetchConfig, updateConfig, acpStatus, acpCwd, acpSessionId, lastError } = useKiroAcpStore()
  const currentWs = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.currentWorkspaceId) || null)

  const [cliPath, setCliPath] = useState('')
  const [defaultAgent, setDefaultAgent] = useState('')
  const [globalSkillRoot, setGlobalSkillRoot] = useState('')
  const [trustAllTools, setTrustAllTools] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { void fetchConfig() }, [fetchConfig])
  useEffect(() => {
    if (config) {
      setCliPath(config.cliPath || '')
      setDefaultAgent(config.defaultAgent || '')
      setGlobalSkillRoot(config.globalSkillRoot || '')
      setTrustAllTools(!!config.trustAllTools)
    }
  }, [config])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateConfig({ cliPath, defaultAgent, globalSkillRoot, trustAllTools })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Kiro ACP</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          管理 Kiro CLI 启动参数。`kiro-cli acp` 进程和 session/new 都将使用当前 Workspace 的 rootPath 作为 cwd。
        </p>
      </section>

      {/* 当前连接状态 */}
      <section
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: 16,
          background: 'var(--color-surface)',
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>连接状态</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }}>
          <span style={{ color: 'var(--color-text-muted)' }}>状态</span>
          <span style={{ color: acpStatus === 'connected' ? 'var(--color-success, #2e7d32)' : acpStatus === 'error' ? 'var(--color-danger)' : 'inherit' }}>
            {acpStatus}
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>当前 cwd</span>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all' }}>
            {acpCwd || currentWs?.rootPath || '—'}
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>sessionId</span>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all' }}>{acpSessionId || '—'}</span>
          {lastError && (
            <>
              <span style={{ color: 'var(--color-text-muted)' }}>最近错误</span>
              <span style={{ color: 'var(--color-danger)' }}>{lastError}</span>
            </>
          )}
        </div>
      </section>

      {/* 配置表单 */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 0 }}>配置</h3>
        <Field label="Kiro CLI 路径">
          <Input value={cliPath} onChange={(e) => setCliPath(e.target.value)} placeholder="kiro-cli" />
        </Field>
        <Field label="默认 Agent">
          <Input value={defaultAgent} onChange={(e) => setDefaultAgent(e.target.value)} placeholder="kiro_default" />
        </Field>
        <Field label="全局 Skill 库路径">
          <Input value={globalSkillRoot} onChange={(e) => setGlobalSkillRoot(e.target.value)} placeholder="~/.cc-haha/kiro-skills" />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={trustAllTools}
            onChange={(e) => setTrustAllTools(e.target.checked)}
          />
          启动参数 --trust-all-tools
        </label>
        <div>
          <Button onClick={handleSave} disabled={saving || isConfigLoading}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
        {configError && <div style={{ color: 'var(--color-danger)', fontSize: 12 }}>{configError}</div>}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</label>
      {children}
    </div>
  )
}
