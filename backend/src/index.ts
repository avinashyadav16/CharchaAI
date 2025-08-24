import cors from "cors";
import "dotenv/config";
import express from "express";
import { createAgent } from "./agents/createAgent";
import { AgentPlatform, AIAgent } from "./agents/types";
import { apikey, serverClient } from "./serverClient";

const app = express();
app.use(express.json());

// TODO: Change it during hosting
app.use(cors({ origin: "*" }));

// Map to store the AI Agent instances
// [user_id string]: AI Agent
const aiAgentCache = new Map<string, AIAgent>();
const pendingAiAgents = new Set<string>();

// TODO: temporary setting to 8 hours, should be cleaned up at some point
const inactivityThreshold = 480 * 60 * 1000;

// Periodically check for inactive AI agents and dispose of them
setInterval(async () => {
  const now = Date.now();
  for (const [userId, aiAgent] of aiAgentCache) {
    if (now - aiAgent.getLastInteraction() > inactivityThreshold) {
      console.log(`Disposing AI Agent Due To Inactivity: ${userId}`);
      await disposeAiAgent(aiAgent);
      aiAgentCache.delete(userId);
    }
  }
}, 5000);

app.get("/", (req, res) => {
  res.json({
    message: "AI Writing Assistant Server is running...",
    apikey: apikey,
    activeAgents: aiAgentCache.size,
  });
});

/**
 * Handling the request to start the AI Agent
 */
app.post("/start-ai-agent", async (req, res) => {
  const { channel_id, channel_type = "messaging" } = req.body;
  console.log(`[API] /start-ai-agent called For Channel: ${channel_id}`);

  // Simple validation
  if (!channel_id) {
    res.status(400).json({ error: "Missing Required Fields" });
    return;
  }

  const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;

  try {
    // Prevent multiple agents from being created for the same channel simultaneously
    if (!aiAgentCache.has(user_id) && !pendingAiAgents.has(user_id)) {
      console.log(`[API] Creating New Agent For ${user_id}`);
      pendingAiAgents.add(user_id);

      await serverClient.upsertUser({
        id: user_id,
        name: "AI Writing Assistant",
      });

      const channel = serverClient.channel(channel_type, channel_id);
      await channel.addMembers([user_id]);

      const agent = await createAgent(
        user_id,
        AgentPlatform.OPENAI,
        channel_type,
        channel_id
      );

      await agent.init();

      // Final check to prevent race conditions where an agent might have been added
      // while this one was initializing.
      if (aiAgentCache.has(user_id)) {
        await agent.dispose();
      } else {
        aiAgentCache.set(user_id, agent);
      }
    } else {
      console.log(`AI Agent ${user_id} Already Started OR Is Pending.`);
    }

    res.json({ message: "AI Agent Started", data: [] });
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error("Failed To Start AI Agent", errorMessage);

    res
      .status(500)
      .json({ error: "Failed To Start AI Agent", reason: errorMessage });
  } finally {
    pendingAiAgents.delete(user_id);
  }
});

/**
 * Handling the request to stop the AI Agent
 */
app.post("/stop-ai-agent", async (req, res) => {
  const { channel_id } = req.body;
  console.log(`[API] /stop-ai-agent Called For Channel: ${channel_id}`);
  const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;

  try {
    const aiAgent = aiAgentCache.get(user_id);

    if (aiAgent) {
      console.log(`[API] Disposing Agent For ${user_id}`);
      await disposeAiAgent(aiAgent);
      aiAgentCache.delete(user_id);
    } else {
      console.log(`[API] Agent For ${user_id} Not Found In Cache.`);
    }

    res.json({ message: "AI Agent Stopped", data: [] });
  } catch (error) {
    const errorMessage = (error as Error).message;

    console.error("Failed To Stop AI Agent", errorMessage);

    res
      .status(500)
      .json({ error: "Failed To Stop AI Agent", reason: errorMessage });
  }
});

app.get("/agent-status", (req, res) => {
  const { channel_id } = req.query;

  if (!channel_id || typeof channel_id !== "string") {
    return res.status(400).json({ error: "Missing channel_id" });
  }

  const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;
  console.log(
    `[API] /agent-status Called For Channel: ${channel_id} (user: ${user_id})`
  );

  if (aiAgentCache.has(user_id)) {
    console.log(`[API] Status For ${user_id}: Connected`);
    res.json({ status: "connected" });
  } else if (pendingAiAgents.has(user_id)) {
    console.log(`[API] Status For ${user_id}: Connecting`);
    res.json({ status: "connecting" });
  } else {
    console.log(`[API] Status For ${user_id}: Disconnected`);
    res.json({ status: "disconnected" });
  }
});

// Token provider endpoint - generates secure tokens
app.post("/token", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    // Create token with expiration (1 hour) and issued at time for security
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiration = issuedAt + 60 * 60; // 1 hour from now

    const token = serverClient.createToken(userId, expiration, issuedAt);

    res.json({ token });
  } catch (error) {
    console.error("Error Generating Token:", error);

    res.status(500).json({
      error: "Failed To Generate Token",
    });
  }
});

async function disposeAiAgent(aiAgent: AIAgent) {
  await aiAgent.dispose();

  if (!aiAgent.user) {
    return;
  }

  await serverClient.deleteUser(aiAgent.user.id, {
    hard_delete: true,
  });
}

// Start the Express server
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
