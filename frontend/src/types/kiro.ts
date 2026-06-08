// Kiro ACP Client 类型定义

export type Workspace = {
  id: string
  name: string
  rootPath: string
  agentName?: string
  createdAt: number
  updatedAt: number
}

export type WorkspaceValidationResult = {
  rootPath: string
  exists: boolean
  hasKiroDir: boolean
  skillsCount: number
  steeringCount: number
  hasSettings: boolean
  warnings: string[]
}

export type KiroConfig = {
  cliPath: string
  defaultAgent?: string
  trustAllTools: boolean
}

export type ChatMode = 'auto_project_skills' | 'debug_check_skills' | 'plain'

export type SteeringFileMeta = {
  id: string
  name: string
  path: string
  projectRoot: string
  relativePath: string
  size: number
  updatedAt: number
  description: string
  status: 'ok' | 'warning' | 'error'
  warnings: string[]
}

export type SkillMeta = {
  id: string
  name: string
  path: string
  skillMdPath: string
  inclusionMode: 'always' | 'auto' | 'manual' | 'fileMatch' | 'unknown'
  description: string
  status: 'ok' | 'warning' | 'error'
  warnings: string[]
  hash: string
}

export type GlobalSkill = SkillMeta & {
  rootPath: string
  version?: string
  updatedAt: number
}

export type ProjectSkill = SkillMeta & {
  projectRoot: string
  source: 'global' | 'project'
  sourceSkillId?: string
  installedAt?: number
  lastSyncedAt?: number
  syncStatus: 'not_installed' | 'synced' | 'outdated' | 'modified' | 'conflict' | 'local'
}

export type SyncMeta = {
  source: 'global'
  globalSkillId: string
  globalPath: string
  syncedAt: number
  sourceHash: string
}
