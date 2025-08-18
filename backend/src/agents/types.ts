import type { Channel, StreamChat, User } from "stream-chat";

// The structure of Agent's Interface
export interface AIAgent {
  // optional, if it is there then it should be of the type stream-chat
  user?: User;
  channel: Channel;
  chatClient: StreamChat;

  // All the number of interactions
  getLastInteraction: () => number;

  // To initialise the chat, which returns a promise of type void
  init: () => Promise<void>;

  // To do all the chat clean ups
  dispose: () => Promise<void>;
}

// Platform Interface:
export enum AgentPlatform {
  OPENAI = "openai",
  WRITING_ASSISTANT = "writing_assistant",
}

// Extended Writing Features
export interface WritingMessage {
  custom?: {
    suggestion?: string[];
    writingTask?: string;
    messageType?: "user_input" | "ai_response" | "system_message";
  };
}
