import OpenAI from "openai";
import type { AssistantStream } from "openai/lib/AssistantStream";
import type { Channel, Event, MessageResponse, StreamChat } from "stream-chat";

export class OpenAIResponseHandler {
  // To accumulate the ai response text as a stream in real-time
  private message_text = "";

  // For debugging and monitoring the number of chunks coming in
  private chunk_counter = 0;

  // Unique Run Identifier to avoid duplicate request
  private run_id = "";

  // To dispose handler and avoid memory leak
  private is_done = false;

  private last_update_time = 0;

  constructor(
    private readonly openai: OpenAI,
    private readonly openAiThread: OpenAI.Beta.Threads.Thread,
    private readonly assistantStream: AssistantStream,
    private readonly chatClient: StreamChat,
    private readonly channel: Channel,
    private readonly message: MessageResponse,
    private readonly onDispose: () => void
  ) {
    this.chatClient.on("ai_indicator.stop", this.handleStopGenerating);
  }

  run = async () => {};

  dispose = async () => {
    if (this.is_done) {
      return;
    }

    this.is_done = true;
    this.chatClient.off("ai_indicator.stop", this.handleStopGenerating);
    this.onDispose();
  };

  private handleStopGenerating = async (event: Event) => {
    if (this.is_done || event.message_id !== this.message.id) {
      return;
    }

    console.log("Stop Generating For Message ", this.message.id);

    if (!this.openai || !this.openAiThread || !this.run_id) {
      return;
    }

    try {
      await this.openai.beta.threads.runs.cancel(this.run_id, {
        thread_id: this.openAiThread.id,
      });
    } catch (error) {
      console.log("Error Cancelling Run", error);
    }

    await this.channel.sendEvent({
      type: "ai_indicator.clear",
      cid: this.message.cid,
      message_id: this.message.id,
    });

    await this.dispose();
  };

  private handleStreamEvent = async (event: Event) => {};

  private handleError = async (error: Error) => {
    if (this.is_done) {
      return;
    }

    await this.channel.sendEvent({
      type: "ai_indicator.update",
      ai_state: "AI_STATE_ERROR",
      cid: this.message.cid,
      message_id: this.message.id,
    });

    await this.chatClient.partialUpdateMessage(this.message.id, {
      set: {
        text: error.message ?? "Error Generating The Message",
        message: error.toString(),
      },
    });

    await this.dispose();
  };

  private performWebSearch = async (query: String): Promise<string> => {
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

    if (!TAVILY_API_KEY) {
      return JSON.stringify({
        error: "Web Search is not availabel, TAVILY_API_KEY is not configured.",
      });
    }

    console.log(`Performing a web search for ${query}`);
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
          query: query,
          search_depth: "advanced",
          max_results: 5,
          include_answer: true,
          include_raw_content: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();

        console.log(`Tavily Search Failed For Query "${query}: `, errorText);

        return JSON.stringify({
          error: `Search Failed With Status: ${response.status}`,
          details: errorText,
        });
      }

      const data = await response.json();

      console.log(`Tavily Search Successful For Query: ${query}`);

      return JSON.stringify(data);
    } catch (error) {
      console.error(`An Exception Occured During Web Seach For ${query}`);

      return JSON.stringify({
        error: "An Exception Occured During Web Search",
      });
    }
  };
}
