import { withFeeder, getStore } from "../lib/store.mjs";
import { isDevice, json } from "../lib/auth.mjs";

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const RECENT_MS = 120000;

// The camera calls this every 5 s: "I'm here, and is there a photo to take?"
export default withFeeder(async (req) => {
  if (!isDevice(req)) return json({ error: "Unauthorized" }, 401);
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const store = getStore("feeder");
  const ip = new URL(req.url).searchParams.get("ip") || "";
  await store.setJSON("camera", { ip: IP_RE.test(ip) ? ip : "", t: Date.now() });

  const cmd = await store.get("command", { type: "json" });
  const settings = await store.get("settings", { type: "json" });
  let wanted = await store.get("photoReq", { type: "json" });
  const photo = await store.getMetadata("photo");
  // Keep returning an unfulfilled request so a failed upload is retried.
  if (wanted && wanted.id !== photo?.metadata?.id && Date.now() - wanted.createdAt < RECENT_MS) {
    return json({ snap: true, id: wanted.id });
  }
  if ((settings?.cameraMode || "after-feed") === "after-feed" && cmd?.status === "done" &&
      Date.now() - cmd.createdAt < RECENT_MS && photo?.metadata?.id !== cmd.id &&
      (await store.get("lastFeedPhoto", { type: "json" })) !== cmd.id) {
    wanted = { id: cmd.id, user: cmd.user, seconds: cmd.seconds, kind: "after-feed", createdAt: Date.now() };
    await store.setJSON("photoReq", wanted);
    await store.setJSON("lastFeedPhoto", cmd.id);
    return json({ snap: true, id: cmd.id });
  }
  if (settings?.cameraMode === "live") {
    const id = crypto.randomUUID();
    await store.setJSON("photoReq", { id, user: "Camera", seconds: 0, kind: "live", createdAt: Date.now() });
    return json({ snap: true, id });
  }
  return json({ snap: false });
});

export const config = { path: "/api/camera" };
