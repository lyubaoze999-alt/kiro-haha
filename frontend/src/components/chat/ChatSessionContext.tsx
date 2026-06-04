import { createContext, useContext } from 'react'

const ChatSessionContext = createContext<string | undefined>(undefined)

export const ChatSessionProvider = ChatSessionContext.Provider

export function useChatSessionId(): string | undefined {
  return useContext(ChatSessionContext)
}
