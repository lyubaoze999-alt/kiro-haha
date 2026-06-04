import { useChatStore } from '../../stores/chatStore'

type Props = {
  sessionId: string
  /** Click on a queued pill — re-open the message in the composer for editing. */
  onEditQueued?: (content: string, attachments?: unknown) => void
}

/**
 * Codex-style queued-messages strip rendered above the composer while the agent
 * is busy. Lists each pending user message as a compact pill with a hover ×.
 * When the current turn finishes (or the user presses Stop), the queue is
 * auto-flushed one message at a time.
 *
 * Visuals use design tokens (--color-*) so it adapts to all three themes
 * (light / white / dark) without per-theme styling.
 */
export function MessageQueue({ sessionId, onEditQueued }: Props) {
  const queue = useChatStore((s) => s.sessions[sessionId]?.messageQueue ?? [])
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage)
  const clearMessageQueue = useChatStore((s) => s.clearMessageQueue)

  if (queue.length === 0) return null

  return (
    <div
      data-testid="message-queue"
      className="mb-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 shadow-sm"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
          <span className="material-symbols-outlined text-[14px]">schedule</span>
          <span>
            {queue.length} 条消息排队中（当前任务结束后会按顺序发送）
          </span>
        </div>
        <button
          type="button"
          onClick={() => clearMessageQueue(sessionId)}
          className="text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:rounded"
        >
          清空
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {queue.map((item) => {
          const preview = item.content.replace(/\s+/g, ' ').trim()
          const truncated = preview.length > 60 ? preview.slice(0, 58) + '…' : preview
          return (
            <div
              key={item.id}
              className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 pl-2.5 pr-1 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              <button
                type="button"
                title={preview}
                onClick={() => {
                  if (onEditQueued) {
                    onEditQueued(item.content, item.attachments)
                    removeQueuedMessage(sessionId, item.id)
                  }
                }}
                className="min-w-0 max-w-[420px] truncate text-left focus-visible:outline-none"
              >
                {truncated || '（空消息）'}
              </button>
              <button
                type="button"
                aria-label="移除"
                onClick={() => removeQueuedMessage(sessionId, item.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] opacity-60 transition-opacity hover:bg-[var(--color-surface-hover)] hover:opacity-100 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
