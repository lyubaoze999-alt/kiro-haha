import { create } from 'zustand'
import { kiroConfigApi, type KiroConfigPayload } from '../api/kiro'
import type { ChatMode } from '../types/kiro'

const CHAT_MODE_KEY = 'kiro-haha-chat-mode'

function loadChatMode(): ChatMode {
  try {
    const v = localStorage.getItem(CHAT_MODE_KEY)
    if (v === 'auto_project_skills' || v === 'debug_check_skills' || v === 'plain') return v
  } catch { /* ignore */ }
  return 'auto_project_skills'
}

function saveChatMode(mode: ChatMode) {
  try { localStorage.setItem(CHAT_MODE_KEY, mode) } catch { /* ignore */ }
}

/** Wrap user input according to selected chat mode.
 *  Note: never inline SKILL.md or steering full text — that's Kiro Agent's job
 *  based on cwd. We only emit short hints. */
export function wrapPrompt(userInput: string, mode: ChatMode): string {
  if (mode === 'auto_project_skills') {
    return `本次任务运行在当前 Kiro 项目上下文中。请优先遵循 \`.kiro/steering/\`，并根据任务语义自动使用 \`.kiro/skills/\` 中匹配的 Skill。\n\n用户任务：\n${userInput}`
  }
  if (mode === 'debug_check_skills') {
    return `本次任务运行在当前 Kiro 项目上下文中。\n\n请先输出以下诊断信息：\n[VisibleSkills: 列出当前可见 Skill 名称]\n[MatchedSkill: 如果有匹配 Skill，输出 Skill 名称；没有则输出 none]\n[Reason: 简述匹配原因]\n\n然后再完成用户任务。\n\n用户任务：\n${userInput}`
  }
  return userInput
}

type AcpStatus = 'idle' | 'connecting' | 'connected' | 'error'

type KiroAcpStore = {
  config: KiroConfigPayload | null
  isConfigLoading: boolean
  configError: string | null

  acpStatus: AcpStatus
  acpCwd: string | null
  acpSessionId: string | null
  lastError: string | null

  chatMode: ChatMode

  fetchConfig: () => Promise<void>
  updateConfig: (patch: Partial<KiroConfigPayload>) => Promise<void>
  setChatMode: (mode: ChatMode) => void

  setAcpStatus: (status: AcpStatus, info?: { cwd?: string | null; sessionId?: string | null; error?: string | null }) => void
}

export const useKiroAcpStore = create<KiroAcpStore>((set) => ({
  config: null,
  isConfigLoading: false,
  configError: null,

  acpStatus: 'idle',
  acpCwd: null,
  acpSessionId: null,
  lastError: null,

  chatMode: loadChatMode(),

  fetchConfig: async () => {
    set({ isConfigLoading: true, configError: null })
    try {
      const config = await kiroConfigApi.get()
      set({ config, isConfigLoading: false })
    } catch (err) {
      set({ isConfigLoading: false, configError: err instanceof Error ? err.message : 'failed to load kiro config' })
    }
  },

  updateConfig: async (patch) => {
    try {
      const config = await kiroConfigApi.update(patch)
      set({ config })
    } catch (err) {
      set({ configError: err instanceof Error ? err.message : 'failed to update kiro config' })
      throw err
    }
  },

  setChatMode: (mode) => {
    saveChatMode(mode)
    set({ chatMode: mode })
  },

  setAcpStatus: (status, info) => {
    set({
      acpStatus: status,
      acpCwd: info?.cwd === undefined ? undefined : info.cwd ?? null,
      acpSessionId: info?.sessionId === undefined ? undefined : info.sessionId ?? null,
      lastError: info?.error === undefined ? undefined : info.error ?? null,
    } as Partial<KiroAcpStore>)
  },
}))
