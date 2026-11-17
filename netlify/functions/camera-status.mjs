import { getStore } from "@netlify/blobs";
import { getUser, json } from "../lib/auth.mjs";

const ONLINE_WINDOW_MS = 20000;

export default async (req) => {
  if (!getUser(req)) return json({ error: "Please log in again" }, 401);
  const store = getStore("feeder");
  const [cam, photo] = await Promise.all([
    store.get("camera", { type: "json" }),
    store.getMetadata("photo"),
  ]);
  const online = Boolean(cam) && Date.now() - cam.t < ONLINE_WINDOW_MS;
  return json({ online, ip: online ? cam.ip : "", photo: photo?.metadata || null });
};

export const config = { path: "/api/camera-status" };
