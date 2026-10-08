import { getStore } from "@netlify/blobs";
import { getUser, isAdmin, json } from "../lib/auth.mjs";
import { tzName } from "../lib/time.mjs";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALLOWED = [1, 3, 5];

export default async (req) => {
  const me = getUser(req);
  if (!me) return json({ error: "Please log in again" }, 401);
  const store = getStore("feeder");

  if (req.method === "GET") {
    const s = (await store.get("settings", { type: "json" })) || {};
    return json({ dailyLimit: s.dailyLimit ?? 5, schedule: s.schedule || [], allowRegistration: s.allowRegistration !== false, tz: tzName() });
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
      if (!ALLOWED.includes(Number(e.seconds))) return json({ error: "Scheduled duration must be 1, 3 or 5 seconds" }, 400);
      if (seen.has(e.time)) return json({ error: `Time ${e.time} is listed twice` }, 400);
      seen.add(e.time);
    }
    const clean = schedule
      .map((e) => ({ time: e.time, seconds: Number(e.seconds) }))
      .sort((a, b) => a.time.localeCompare(b.time));
    const allowRegistration = body.allowRegistration !== false;
    await store.setJSON("settings", { dailyLimit, schedule: clean, allowRegistration });
    return json({ dailyLimit, schedule: clean, allowRegistration, tz: tzName() });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/settings" };
