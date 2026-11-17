import { withFeeder, getStore } from "../lib/store.mjs";
import { getUser, isDevice, json } from "../lib/auth.mjs";

const MAX_BYTES = 1500000;

export default withFeeder(async (req) => {
  const store = getStore("feeder");

  if (req.method === "PUT") {
    const user = getUser(req);
    if (!user) return json({ error: "Please log in again" }, 401);
    const camera = await store.get("camera", { type: "json" });
    if (!camera || Date.now() - camera.t > 20000) return json({ error: "Camera is offline" }, 409);
    const previous = await store.get("photoReq", { type: "json" });
    const latest = await store.getMetadata("photo");
    if (previous && previous.id !== latest?.metadata?.id && Date.now() - previous.createdAt < 120000)
      return json({ error: "A photo is already being taken" }, 409);
    const id = crypto.randomUUID();
    await store.setJSON("photoReq", { id, user, seconds: 0, kind: "manual", createdAt: Date.now() });
    return json({ ok: true, id });
  }

  // Camera uploads the photo
  if (req.method === "POST") {
    if (!isDevice(req)) return json({ error: "Unauthorized" }, 401);
    const id = req.headers.get("x-photo-id") || "";
    const wanted = await store.get("photoReq", { type: "json" });
    if (!wanted || wanted.id !== id) return json({ error: "No photo was requested" }, 400);

    const data = await req.arrayBuffer();
    if (data.byteLength < 100 || data.byteLength > MAX_BYTES) return json({ error: "Bad photo size" }, 400);

    await store.set("photo", data, {
      metadata: { id, time: Date.now(), user: wanted.user, seconds: wanted.seconds, kind: wanted.kind || "after-feed" },
    });
    return json({ ok: true });
  }

  // Logged-in users view the latest photo
  if (req.method === "GET") {
    if (!getUser(req)) return json({ error: "Please log in again" }, 401);
    const found = await store.getWithMetadata("photo", { type: "arrayBuffer" });
    if (!found) return json({ error: "No photo yet" }, 404);
    return new Response(found.data, {
      headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
    });
  }

  return json({ error: "Method not allowed" }, 405);
});

export const config = { path: "/api/photo" };
