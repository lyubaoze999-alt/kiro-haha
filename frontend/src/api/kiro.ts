import { api } from './client'
import type {
  Workspace,
  WorkspaceValidationResult,
  KiroConfig,
  SteeringFileMeta,
  GlobalSkill,
  ProjectSkill,
} from '../types/kiro'

// ---------- Workspaces ----------
export const workspacesApi = {
  list: () => api.get<{ workspaces: Workspace[]; currentWorkspaceId: string | null }>('/api/workspaces'),
  create: (rootPath: string, name?: string, agentName?: string) =>
    api.post<{ workspace: Workspace }>('/api/workspaces', { rootPath, name, agentName }),
  validate: (rootPath: string) =>
    api.post<WorkspaceValidationResult>('/api/workspaces/validate', { rootPath }),
  switch: (workspaceId: string) =>
    api.post<{ workspace: Workspace }>('/api/workspaces/switch', { workspaceId }),
  update: (workspaceId: string, patch: Partial<Pick<Workspace, 'name' | 'agentName'>>) =>
    api.patch<{ workspace: Workspace }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, patch),
  delete: (workspaceId: string) =>
    api.delete<{ ok: true }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`),
}

// ---------- KiroConfig ----------
export type KiroConfigPayload = KiroConfig & { globalSkillRoot: string }

export const kiroConfigApi = {
  get: () => api.get<KiroConfigPayload>('/api/kiro-config'),
  update: (patch: Partial<KiroConfigPayload>) =>
    api.patch<KiroConfigPayload>('/api/kiro-config', patch),
}

// ---------- Steering ----------
export const steeringApi = {
  scan: (projectRoot: string) =>
    api.get<{ files: SteeringFileMeta[] }>(`/api/steering?projectRoot=${encodeURIComponent(projectRoot)}`),
  read: (projectRoot: string, relativePath: string) =>
    api.get<{ content: string }>(
      `/api/steering/file?projectRoot=${encodeURIComponent(projectRoot)}&relativePath=${encodeURIComponent(relativePath)}`,
    ),
  create: (projectRoot: string, fileName: string, content: string) =>
    api.post<{ file: SteeringFileMeta }>('/api/steering', { projectRoot, fileName, content }),
  update: (projectRoot: string, relativePath: string, content: string) =>
    api.put<{ file: SteeringFileMeta }>(
      `/api/steering/file?projectRoot=${encodeURIComponent(projectRoot)}&relativePath=${encodeURIComponent(relativePath)}`,
      { projectRoot, relativePath, content },
    ),
  delete: (projectRoot: string, relativePath: string) =>
    api.delete<{ ok: true }>(
      `/api/steering/file?projectRoot=${encodeURIComponent(projectRoot)}&relativePath=${encodeURIComponent(relativePath)}`,
    ),
  openFolder: (projectRoot: string) =>
    api.post<{ ok: boolean; path: string; error?: string }>('/api/steering/open', { projectRoot }),
}

// ---------- Skills ----------
export const globalSkillsApi = {
  scan: (root?: string) =>
    api.get<{ skills: GlobalSkill[]; root: string }>(
      root ? `/api/global-skills?root=${encodeURIComponent(root)}` : '/api/global-skills',
    ),
  install: (globalSkillId: string, projectRoot: string, overwrite?: boolean) =>
    api.post<{ ok: true }>('/api/global-skills/install', { globalSkillId, projectRoot, overwrite }),
  sync: (globalSkillId: string, projectRoot: string, overwrite?: boolean) =>
    api.post<{ ok: true }>('/api/global-skills/sync', { globalSkillId, projectRoot, overwrite }),
}

export const projectSkillsApi = {
  scan: (projectRoot: string) =>
    api.get<{ skills: ProjectSkill[] }>(
      `/api/project-skills?projectRoot=${encodeURIComponent(projectRoot)}`,
    ),
}
