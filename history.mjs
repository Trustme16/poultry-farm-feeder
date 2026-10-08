import { getStore } from "@netlify/blobs";
import { getUser, isAdmin, json } from "../lib/auth.mjs";
import { localParts } from "../lib/time.mjs";

const ONLINE_WINDOW_MS = 15000;
const DEFAULT_LIMIT = 5;

export default async (req) => {
  const user = getUser(req);
  if (!user) return json({ error: "Please log in again" }, 401);

  const store = getStore("feeder");
  const [history, seen, command, settings] = await Promise.all([
    store.get("history", { type: "json" }),
    store.get("lastSeen", { type: "json" }),
    store.get("command", { type: "json" }),
    store.get("settings", { type: "json" }),
  ]);
  const list = history || [];

  const online = Boolean(seen) && Date.now() - seen.t < ONLINE_WINDOW_MS;
  const busy =
    Boolean(command) &&
    (command.status === "pending" || command.status === "sent") &&
    Date.now() - command.createdAt < 30000;

  const admin = isAdmin(user);
  const dailyLimit = settings?.dailyLimit ?? DEFAULT_LIMIT;
  let remaining = null;
  if (!admin) {
    const today = localParts().date;
    const used = list.filter((h) => h.user === user && localParts(h.time).date === today).length;
    remaining = Math.max(0, dailyLimit - used);
  }

  return json({ user, admin, online, busy, remaining, dailyLimit, history: list.slice(0, 50) });
};

export const config = { path: "/api/history" };
