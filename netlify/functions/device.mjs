import { getStore } from "@netlify/blobs";
import { isDevice, json } from "../lib/auth.mjs";
import { localParts, toMinutes } from "../lib/time.mjs";

const FRESH_MS = 60000;
const GRACE_MINUTES = 10; // a scheduled feeding missed by more than this is skipped

// If a scheduled time has arrived, create the command right now.
async function runSchedule(store) {
  const settings = await store.get("settings", { type: "json" });
  const schedule = settings?.schedule || [];
  if (!schedule.length) return null;

  const { date, time } = localParts();
  const nowMin = toMinutes(time);
  const fired = (await store.get("schedFired", { type: "json" })) || {};
  let toFire = null;
  let changed = false;

  for (const entry of schedule) {
    if (fired[entry.time] === date) continue;
    const late = nowMin - toMinutes(entry.time);
    if (late < 0) continue; // not yet
    if (late > GRACE_MINUTES) {
      fired[entry.time] = date; // missed (feeder was offline) - skip it
      changed = true;
      continue;
    }
    if (!toFire) {
      toFire = entry;
      fired[entry.time] = date;
      changed = true;
    }
  }
  if (changed) await store.setJSON("schedFired", fired);
  if (!toFire) return null;

  const id = crypto.randomUUID();
  const now = Date.now();
  await store.setJSON("command", { id, seconds: toFire.seconds, user: "Schedule", createdAt: now, status: "sent" });
  const history = (await store.get("history", { type: "json" })) || [];
  history.unshift({ id, user: "Schedule", seconds: toFire.seconds, time: now, status: "pending" });
  await store.setJSON("history", history.slice(0, 100));
  return { feed: true, id, seconds: toFire.seconds };
}

// The ESP32 cannot be reached from the internet, so it calls this endpoint instead.
//   GET  /api/device  -> "any feed command waiting for me?"
//   POST /api/device  -> "I finished command <id>"
export default async (req) => {
  if (!isDevice(req)) return json({ error: "Unauthorized" }, 401);
  const store = getStore("feeder");
  await store.setJSON("lastSeen", { t: Date.now() });

  if (req.method === "GET") {
    const cmd = await store.get("command", { type: "json" });
    const fresh = cmd && Date.now() - cmd.createdAt < FRESH_MS;

    if (fresh && cmd.status === "pending") {
      cmd.status = "sent";
      await store.setJSON("command", cmd);
      return json({ feed: true, id: cmd.id, seconds: cmd.seconds });
    }
    if (!(fresh && cmd.status === "sent")) {
      const scheduled = await runSchedule(store);
      if (scheduled) return json(scheduled);
    }
    return json({ feed: false });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Bad request" }, 400);
    }
    const cmd = await store.get("command", { type: "json" });
    if (cmd && cmd.id === body.id) {
      cmd.status = "done";
      await store.setJSON("command", cmd);
    }
    const history = (await store.get("history", { type: "json" })) || [];
    const entry = history.find((h) => h.id === body.id);
    if (entry) {
      entry.status = "done";
      await store.setJSON("history", history);
    }
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/device" };
