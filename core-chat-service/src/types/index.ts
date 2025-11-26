export interface ChatMessage {
  messageId: string;
  channelId: string;
  userId: string;
  text: string;
  timestamp: number;
}

export interface ReplayRequest {
  channelId: string;
  lastTimestamp: number;
}