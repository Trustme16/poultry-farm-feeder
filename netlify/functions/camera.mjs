import { getStore } from "@netlify/blobs";
import { isDevice, json } from "../lib/auth.mjs";

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const RECENT_MS = 120000;

// The camera calls this every 5 s: "I'm here, and is there a photo to take?"
export default async (req) => {
  if (!isDevice(req)) return json({ error: "Unauthorized" }, 401);
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const store = getStore("feeder");
  const ip = new URL(req.url).searchParams.get("ip") || "";
  await store.setJSON("camera", { ip: IP_RE.test(ip) ? ip : "", t: Date.now() });

  const [cmd, last] = await Promise.all([
    store.get("command", { type: "json" }),
    store.get("photoReq", { type: "json" }),
  ]);

  // A feeding just finished and we haven't asked for its photo yet
  if (cmd && cmd.status === "done" && Date.now() - cmd.createdAt < RECENT_MS && (!last || last.id !== cmd.id)) {
    await store.setJSON("photoReq", { id: cmd.id, user: cmd.user, seconds: cmd.seconds });
    return json({ snap: true, id: cmd.id });
  }
  return json({ snap: false });
};

export const config = { path: "/api/camera" };
