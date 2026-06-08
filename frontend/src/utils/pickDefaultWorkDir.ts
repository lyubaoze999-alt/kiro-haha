import type { SessionListItem } from '../types/session'
import type { RecentProject } from '../api/sessions'

export type PickedWorkDirSource =
  | 'current-tab'      // current tab's session — caller usually skips toast
  | 'recent-session'   // most-recently-modified existing session
  | 'recent-project'   // most-recently-modified entry from /api/sessions/recent-projects
  | 'none'             // nothing reasonable — caller should fall back to HOME silently

export type PickedWorkDir = {
  workDir: string | undefined
  source: PickedWorkDirSource
  /** Project name suitable for surfacing in a toast or inline label. */
  folderLabel: string | undefined
}

type Inputs = {
  /** Currently active tab's session, or null if not a session tab. */
  currentSession?: SessionListItem | null
  sessions: SessionListItem[]
  recentProjects: RecentProject[]
}

/**
 * Pick a sensible default workDir for "new session" entry points so the user
 * isn't faced with an empty project chip and accidentally lands sessions in
 * \$HOME (which isn't surfaced as a project group in the sidebar).
 *
 * Priority:
 *  1. current tab's session workDir (preserves "stay in this project")
 *  2. most-recently-modified existing session that still has a valid workDir
 *  3. most-recently-modified entry from recent-projects (IDE history merge)
 *  4. undefined — adapter will fall back to HOME
 */
export function pickDefaultWorkDir({ currentSession, sessions, recentProjects }: Inputs): PickedWorkDir {
  // 1) current tab session
  if (currentSession?.workDir && currentSession.workDirExists) {
    return { workDir: currentSession.workDir, source: 'current-tab', folderLabel: folderName(currentSession.workDir) }
  }
  if (currentSession?.projectRoot) {
    return { workDir: currentSession.projectRoot, source: 'current-tab', folderLabel: folderName(currentSession.projectRoot) }
  }

  // 2) most-recent existing session with valid workDir
  const newestSession = [...sessions]
    .filter((s) => s.workDir && s.workDirExists)
    .sort((a, b) => safeTime(b.modifiedAt) - safeTime(a.modifiedAt))[0]
  if (newestSession?.workDir) {
    return { workDir: newestSession.workDir, source: 'recent-session', folderLabel: folderName(newestSession.workDir) }
  }

  // 3) most-recent recent-project (IDE history)
  const newestProject = [...recentProjects]
    .filter((p) => p.projectPath)
    .sort((a, b) => safeTime(b.modifiedAt) - safeTime(a.modifiedAt))[0]
  if (newestProject?.projectPath) {
    return {
      workDir: newestProject.projectPath,
      source: 'recent-project',
      folderLabel: newestProject.projectName || folderName(newestProject.projectPath),
    }
  }

  return { workDir: undefined, source: 'none', folderLabel: undefined }
}

function folderName(p: string | null | undefined): string | undefined {
  if (!p) return undefined
  return p.split('/').filter(Boolean).pop() || p
}

function safeTime(ts: string | number | null | undefined): number {
  if (ts == null) return 0
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  return Number.isFinite(t) ? t : 0
}
