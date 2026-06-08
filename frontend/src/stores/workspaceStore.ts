import { create } from 'zustand'
import { workspacesApi } from '../api/kiro'
import type { Workspace, WorkspaceValidationResult } from '../types/kiro'

type WorkspaceStore = {
  workspaces: Workspace[]
  currentWorkspaceId: string | null
  validation: WorkspaceValidationResult | null
  isLoading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  createWorkspace: (rootPath: string, name?: string, agentName?: string) => Promise<Workspace>
  switchWorkspace: (workspaceId: string) => Promise<Workspace | null>
  updateWorkspace: (
    workspaceId: string,
    patch: Partial<Pick<Workspace, 'name' | 'agentName'>>,
  ) => Promise<Workspace | null>
  deleteWorkspace: (workspaceId: string) => Promise<void>
  validate: (rootPath: string) => Promise<WorkspaceValidationResult>
  refreshValidationForCurrent: () => Promise<void>
  getCurrentWorkspace: () => Workspace | null
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  currentWorkspaceId: null,
  validation: null,
  isLoading: false,
  error: null,

  fetchAll: async () => {
    set({ isLoading: true, error: null })
    try {
      const { workspaces, currentWorkspaceId } = await workspacesApi.list()
      set({ workspaces, currentWorkspaceId, isLoading: false })
      await get().refreshValidationForCurrent()
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'failed to load workspaces' })
    }
  },

  createWorkspace: async (rootPath, name, agentName) => {
    const { workspace } = await workspacesApi.create(rootPath, name, agentName)
    const list = [...get().workspaces.filter((w) => w.id !== workspace.id), workspace]
    set({ workspaces: list, currentWorkspaceId: workspace.id })
    await get().refreshValidationForCurrent()
    return workspace
  },

  switchWorkspace: async (workspaceId) => {
    try {
      const { workspace } = await workspacesApi.switch(workspaceId)
      set({ currentWorkspaceId: workspace.id })
      await get().refreshValidationForCurrent()
      return workspace
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'failed to switch workspace' })
      return null
    }
  },

  updateWorkspace: async (workspaceId, patch) => {
    try {
      const { workspace } = await workspacesApi.update(workspaceId, patch)
      const list = get().workspaces.map((w) => (w.id === workspace.id ? workspace : w))
      set({ workspaces: list })
      return workspace
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'failed to update workspace' })
      return null
    }
  },

  deleteWorkspace: async (workspaceId) => {
    await workspacesApi.delete(workspaceId)
    const list = get().workspaces.filter((w) => w.id !== workspaceId)
    const current = get().currentWorkspaceId === workspaceId ? list[0]?.id ?? null : get().currentWorkspaceId
    set({ workspaces: list, currentWorkspaceId: current })
    await get().refreshValidationForCurrent()
  },

  validate: async (rootPath) => {
    const result = await workspacesApi.validate(rootPath)
    return result
  },

  refreshValidationForCurrent: async () => {
    const ws = get().getCurrentWorkspace()
    if (!ws) {
      set({ validation: null })
      return
    }
    try {
      const result = await workspacesApi.validate(ws.rootPath)
      set({ validation: result })
    } catch {
      set({ validation: null })
    }
  },

  getCurrentWorkspace: () => {
    const id = get().currentWorkspaceId
    if (!id) return null
    return get().workspaces.find((w) => w.id === id) || null
  },
}))
