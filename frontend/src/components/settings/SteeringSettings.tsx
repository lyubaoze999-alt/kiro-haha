import { useEffect, useState, useCallback } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { steeringApi } from '../../api/kiro'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import type { SteeringFileMeta } from '../../types/kiro'

const STEERING_TEMPLATE = `# 规则名称

## 适用场景

说明这份规则适用于哪些任务。

## 规则

- 规则 1
- 规则 2
- 规则 3

## 输出要求

说明 Kiro 回答或生成内容时需要遵循的格式。
`

export function SteeringSettings() {
  const currentWs = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.currentWorkspaceId) || null)
  const [files, setFiles] = useState<SteeringFileMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [editingFile, setEditingFile] = useState<SteeringFileMeta | null>(null)
  const [editingContent, setEditingContent] = useState('')

  const projectRoot = currentWs?.rootPath || ''

  const refresh = useCallback(async () => {
    if (!projectRoot) {
      setFiles([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { files } = await steeringApi.scan(projectRoot)
      setFiles(Array.isArray(files) ? files : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to scan steering')
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [projectRoot])

  useEffect(() => { void refresh() }, [refresh])

  const handleCreate = async () => {
    if (!projectRoot || !newFileName.trim()) return
    try {
      await steeringApi.create(projectRoot, newFileName.trim(), STEERING_TEMPLATE)
      setNewFileName('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create steering')
    }
  }

  const handleOpen = async () => {
    if (!projectRoot) return
    await steeringApi.openFolder(projectRoot)
  }

  const handleEdit = async (file: SteeringFileMeta) => {
    try {
      const { content } = await steeringApi.read(projectRoot, file.relativePath)
      setEditingFile(file)
      setEditingContent(content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to read file')
    }
  }

  const handleSaveEdit = async () => {
    if (!editingFile) return
    try {
      await steeringApi.update(projectRoot, editingFile.relativePath, editingContent)
      setEditingFile(null)
      setEditingContent('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save')
    }
  }

  const handleDelete = async (file: SteeringFileMeta) => {
    if (!confirm(`删除 ${file.name}?`)) return
    try {
      await steeringApi.delete(projectRoot, file.relativePath)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete')
    }
  }

  const handleCopy = (file: SteeringFileMeta) => {
    try { navigator.clipboard?.writeText(file.path) } catch { /* ignore */ }
  }

  if (!projectRoot) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Steering</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>请先在 Workspace 设置中选择一个项目根目录。</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Steering</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Steering 是当前项目的规则文件夹。Kiro 会基于当前 cwd 读取 <code>.kiro/steering/</code> 下的 Markdown 文件。
          kiro-haha 只负责展示、创建、编辑和打开这些文件，不会把文件全文塞进 Prompt。
        </p>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono, monospace)', marginTop: 4 }}>
          {projectRoot}/.kiro/steering
        </div>
      </section>

      {/* 工具栏 */}
      <section style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          placeholder="新建规则文件名（如 product-principles.md）"
          style={{ flex: 1, minWidth: 240 }}
        />
        <Button size="sm" onClick={handleCreate} disabled={!newFileName.trim()}>
          新建
        </Button>
        <Button size="sm" variant="ghost" onClick={handleOpen}>
          打开文件夹
        </Button>
        <Button size="sm" variant="ghost" onClick={refresh}>
          重新扫描
        </Button>
      </section>

      {error && <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}

      {/* 文件列表 */}
      <section>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          规则文件 {loading ? '（加载中…）' : `（${files.length}）`}
        </h3>
        {files.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>暂无 steering 文件。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map((f) => (
              <div
                key={f.id}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{f.name}</strong>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background:
                          f.status === 'ok' ? 'var(--color-success-bg, #e8f5e9)'
                          : f.status === 'warning' ? 'var(--color-warning-bg, #fff3e0)'
                          : 'var(--color-danger-bg, #ffebee)',
                        color:
                          f.status === 'ok' ? 'var(--color-success, #2e7d32)'
                          : f.status === 'warning' ? 'var(--color-warning, #b8860b)'
                          : 'var(--color-danger)',
                      }}
                    >
                      {f.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(f)}>编辑</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleCopy(f)}>复制路径</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(f)}>删除</Button>
                  </div>
                </div>
                {f.description && (
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>{f.description}</p>
                )}
                {Array.isArray(f.warnings) && f.warnings.length > 0 && (
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: 16, color: 'var(--color-warning, #b8860b)', fontSize: 12 }}>
                    {f.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {(f.size / 1024).toFixed(1)} KB · {new Date(f.updatedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 简易编辑器 */}
      {editingFile && (
        <section
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setEditingFile(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-surface)',
              borderRadius: 8,
              padding: 20,
              width: 'min(800px, 90vw)',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14 }}>编辑 {editingFile.name}</h3>
            <textarea
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              style={{
                width: '100%',
                minHeight: 320,
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 13,
                padding: 12,
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="ghost" onClick={() => setEditingFile(null)}>取消</Button>
              <Button onClick={handleSaveEdit}>保存</Button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
