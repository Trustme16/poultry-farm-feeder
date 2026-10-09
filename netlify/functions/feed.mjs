import { getStore } from "@netlify/blobs";
import { getUser, isAdmin, json } from "../lib/auth.mjs";
import { localParts } from "../lib/time.mjs";

const ALLOWED = [5, 10, 30];
const BUSY_TIMEOUT_MS = 60000; // longest feed is 30 s, plus polling and confirming
export const DEFAULT_LIMIT = 5;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const user = getUser(req);
  if (!user) return json({ error: "Please log in again" }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const seconds = Number(body.seconds);
  if (!ALLOWED.includes(seconds)) return json({ error: "Invalid duration" }, 400);

  const store = getStore("feeder");
  const [current, settings, existing] = await Promise.all([
    store.get("command", { type: "json" }),
    store.get("settings", { type: "json" }),
    store.get("history", { type: "json" }),
  ]);
  const history = existing || [];

  const busy =
    current &&
    (current.status === "pending" || current.status === "sent") &&
    Date.now() - current.createdAt < BUSY_TIMEOUT_MS;
  if (busy) return json({ error: "The feeder is still working on the last request" }, 409);

  if (!isAdmin(user)) {
    const limit = settings?.dailyLimit ?? DEFAULT_LIMIT;
    const today = localParts().date;
    const used = history.filter((h) => h.user === user && localParts(h.time).date === today).length;
    if (used >= limit) return json({ error: `Daily limit reached (${limit} feedings per day)` }, 429);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await store.setJSON("command", { id, seconds, user, createdAt: now, status: "pending" });
  history.unshift({ id, user, seconds, time: now, status: "pending" });
  await store.setJSON("history", history.slice(0, 100));

  return json({ ok: true, id });
};

export const config = { path: "/api/feed" };
