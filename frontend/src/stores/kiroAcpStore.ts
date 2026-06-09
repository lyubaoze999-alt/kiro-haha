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
 *
 *  IMPORTANT — why default mode does NOT wrap:
 *  Kiro Agent reads `.kiro/steering` and `.kiro/skills` automatically based on
 *  the ACP cwd, so prepending "本次任务运行在当前 Kiro 项目上下文中..." to every
 *  user message is redundant. Worse, Kiro uses the first ~80 chars of the user
 *  message as the session title, so wrapping pollutes every session title and
 *  makes the sidebar look like duplicate "本次任务运行在当..." entries.
 *
 *  We only wrap in debug mode, which the user explicitly opts into and
 *  expects diagnostic output (it's a one-off probe, not the normal flow).
 *
 *  Never inline SKILL.md or steering full text — that's Kiro Agent's job
 *  based on cwd. */
export function wrapPrompt(userInput: string, mode: ChatMode): string {
  if (mode === 'debug_check_skills') {
    return `请先输出以下诊断信息：\n[VisibleSkills: 列出当前可见 Skill 名称]\n[MatchedSkill: 如果有匹配 Skill，输出 Skill 名称；没有则输出 none]\n[Reason: 简述匹配原因]\n\n然后再完成用户任务。\n\n用户任务：\n${userInput}`
  }
  // auto_project_skills 与 plain 都不包装：Kiro Agent 已通过 cwd 自动加载
  // .kiro/steering 和 .kiro/skills，前端无需再注入提示。
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
