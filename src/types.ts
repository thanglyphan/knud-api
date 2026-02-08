export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolData?: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
}
