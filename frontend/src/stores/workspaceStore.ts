import { create } from 'zustand'
import { workspacesApi } from '../api/kiro'
import type { Workspace, WorkspaceValidationResult } from '../types/kiro'

// In-flight de-dup so multiple mounted components (Sidebar card,
// RuntimeContextCard per session, Settings page) share one HTTP request.
let inFlightFetchAll: Promise<void> | null = null
let inFlightValidate: Promise<void> | null = null
let lastFetchAllAt = 0
const FETCH_ALL_TTL_MS = 3000

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
    // Multiple components (Sidebar, RuntimeContextCard×N, Settings) all call
    // this in their useEffect. Without de-dup we issue N+1 GETs every mount.
    const now = Date.now()
    if (inFlightFetchAll) return inFlightFetchAll
    if (now - lastFetchAllAt < FETCH_ALL_TTL_MS && get().workspaces.length > 0) {
      return // recent fetch is still fresh
    }
    set({ isLoading: true, error: null })
    inFlightFetchAll = (async () => {
      try {
        const resp = await workspacesApi.list()
        const workspaces = Array.isArray(resp?.workspaces) ? resp.workspaces : []
        const currentWorkspaceId = resp?.currentWorkspaceId ?? null
        set({ workspaces, currentWorkspaceId, isLoading: false })
        lastFetchAllAt = Date.now()
        await get().refreshValidationForCurrent()
      } catch (err) {
        set({ workspaces: [], currentWorkspaceId: null, isLoading: false, error: err instanceof Error ? err.message : 'failed to load workspaces' })
      } finally {
        inFlightFetchAll = null
      }
    })()
    return inFlightFetchAll
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
    if (inFlightValidate) return inFlightValidate
    inFlightValidate = (async () => {
      try {
        const result = await workspacesApi.validate(ws.rootPath)
        set({ validation: result })
      } catch {
        set({ validation: null })
      } finally {
        inFlightValidate = null
      }
    })()
    return inFlightValidate
  },

  getCurrentWorkspace: () => {
    const id = get().currentWorkspaceId
    if (!id) return null
    return get().workspaces.find((w) => w.id === id) || null
  },
}))
