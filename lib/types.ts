export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatMessage extends Message {
  id: string
  sources?: { title: string; url: string }[]
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}
