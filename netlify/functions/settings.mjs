import { withFeeder, getStore } from "../lib/store.mjs";
import { getUser, isAdmin, json } from "../lib/auth.mjs";
import { tzName } from "../lib/time.mjs";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const validSeconds = (n) => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 30;

export default withFeeder(async (req) => {
  const me = getUser(req);
  if (!me) return json({ error: "Please log in again" }, 401);
  const store = getStore("feeder");

  if (req.method === "GET") {
    const s = (await store.get("settings", { type: "json" })) || {};
    return json({ dailyLimit: s.dailyLimit ?? 5, schedule: s.schedule || [], allowRegistration: s.allowRegistration !== false, cameraMode: s.cameraMode || "after-feed", tz: tzName() });
  }

  if (req.method === "PUT") {
    if (!isAdmin(me)) return json({ error: "Admins only" }, 403);
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Bad request" }, 400);
    }
    const dailyLimit = Number(body.dailyLimit);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 50)
      return json({ error: "Daily limit must be a whole number from 1 to 50" }, 400);

    const schedule = Array.isArray(body.schedule) ? body.schedule : [];
    if (schedule.length > 8) return json({ error: "At most 8 scheduled feedings" }, 400);
    const seen = new Set();
    for (const e of schedule) {
      if (!TIME_RE.test(e.time || "")) return json({ error: "Each scheduled time needs a valid time" }, 400);
      if (!validSeconds(e.seconds)) return json({ error: "Scheduled duration must be a whole number from 1 to 30 seconds" }, 400);
      if (seen.has(e.time)) return json({ error: `Time ${e.time} is listed twice` }, 400);
      seen.add(e.time);
    }
    const clean = schedule
      .map((e) => ({ time: e.time, seconds: Number(e.seconds) }))
      .sort((a, b) => a.time.localeCompare(b.time));
    const previous = (await store.get("settings", { type: "json" })) || {};
    const cameraMode = body.cameraMode ?? previous.cameraMode ?? "after-feed";
    if (!["live", "after-feed", "manual"].includes(cameraMode)) return json({ error: "Invalid camera mode" }, 400);
    const allowRegistration = body.allowRegistration !== false;
    await store.setJSON("settings", { dailyLimit, schedule: clean, allowRegistration, cameraMode });
    return json({ dailyLimit, schedule: clean, allowRegistration, cameraMode, tz: tzName() });
  }

  return json({ error: "Method not allowed" }, 405);
});

export const config = { path: "/api/settings" };
