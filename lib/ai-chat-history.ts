export type AiChatRole = 'user' | 'assistant'
export type AiChatProvider = 'openai' | 'gemini' | 'local'

export interface AiChatHistoryMessage {
  id: string
  role: AiChatRole
  content: string
  timestamp: string
  provedor?: AiChatProvider
}
