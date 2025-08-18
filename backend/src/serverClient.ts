import { StreamChat } from "stream-chat";

export const apikey = process.env.STREAM_API_KEY as string;
export const apisecret = process.env.STREAM_API_SECRET as string;

if (!apikey || !apisecret) {
  throw new Error(
    "Missing required environment varibales for STREAM_API_KEY and STREAM_API_SECRET"
  );
}

export const serverClient = new StreamChat(apikey, apisecret);
