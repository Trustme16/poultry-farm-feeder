import { withFeeder, getStore } from "../lib/store.mjs";
import { getUser, json } from "../lib/auth.mjs";

const ONLINE_WINDOW_MS = 20000;

export default withFeeder(async (req) => {
  if (!getUser(req)) return json({ error: "Please log in again" }, 401);
  const store = getStore("feeder");
  const settings = await store.get("settings", { type: "json" });
  const wanted = await store.get("photoReq", { type: "json" });
  const [cam, photo] = await Promise.all([
    store.get("camera", { type: "json" }),
    store.getMetadata("photo"),
  ]);
  const online = Boolean(cam) && Date.now() - cam.t < ONLINE_WINDOW_MS;
  return json({ online, ip: online ? cam.ip : "", mode: settings?.cameraMode || "after-feed", pending: Boolean(wanted && wanted.id !== photo?.metadata?.id && Date.now() - wanted.createdAt < 120000), photo: photo?.metadata || null });
});

export const config = { path: "/api/camera-status" };
