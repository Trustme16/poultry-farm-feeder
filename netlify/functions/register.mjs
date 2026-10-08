import { getStore } from "@netlify/blobs";
import { hashPassword, signToken, isAdmin, envUsers, json } from "../lib/auth.mjs";

const NAME_RE = /^[A-Za-z0-9_]{2,20}$/;
const MAX_USERS = 100;
const has = (obj, name) => Object.keys(obj).some((u) => u.toLowerCase() === name.toLowerCase());

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!process.env.AUTH_SECRET)
    return json({ error: "Setup problem: AUTH_SECRET is not set in Netlify. Add it, then redeploy." }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  const store = getStore("feeder");
  const settings = await store.get("settings", { type: "json" });
  if (settings?.allowRegistration === false) return json({ error: "Registration is closed. Ask the admin." }, 403);

  if (!NAME_RE.test(username)) return json({ error: "Username must be 2-20 letters, numbers or _" }, 400);
  if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

  const stored = (await store.get("users", { type: "json" })) || {};
  if (has(envUsers(), username) || has(stored, username)) return json({ error: "That username is already taken" }, 409);
  if (Object.keys(stored).length >= MAX_USERS) return json({ error: "User limit reached" }, 403);

  stored[username] = hashPassword(password);
  await store.setJSON("users", stored);

  // Registering the username listed in the ADMINS variable makes that account an admin.
  return json({ token: signToken(username), user: username, admin: isAdmin(username) });
};

export const config = { path: "/api/register" };
