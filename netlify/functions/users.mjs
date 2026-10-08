import { getStore } from "@netlify/blobs";
import { getUser, isAdmin, envUsers, hashPassword, json } from "../lib/auth.mjs";

const NAME_RE = /^[A-Za-z0-9_]{2,20}$/;
const has = (obj, name) => Object.keys(obj).some((u) => u.toLowerCase() === name.toLowerCase());

export default async (req) => {
  const me = getUser(req);
  if (!me) return json({ error: "Please log in again" }, 401);
  if (!isAdmin(me)) return json({ error: "Admins only" }, 403);

  const store = getStore("feeder");
  const stored = (await store.get("users", { type: "json" })) || {};
  const env = envUsers();
  const list = () => [
    ...Object.keys(env).map((name) => ({ name, source: "netlify" })),
    ...Object.keys(stored).map((name) => ({ name, source: "site" })),
  ];

  if (req.method === "GET") return json({ users: list() });

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Bad request" }, 400);
    }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!NAME_RE.test(username)) return json({ error: "Username must be 2-20 letters, numbers or _" }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
    if (has(env, username) || has(stored, username)) return json({ error: "That username already exists" }, 409);
    stored[username] = hashPassword(password);
    await store.setJSON("users", stored);
    return json({ users: list() });
  }

  if (req.method === "DELETE") {
    const username = new URL(req.url).searchParams.get("username") || "";
    const key = Object.keys(stored).find((u) => u.toLowerCase() === username.toLowerCase());
    if (!key) return json({ error: "User not found (users set in Netlify can only be changed there)" }, 404);
    delete stored[key];
    await store.setJSON("users", stored);
    return json({ users: list() });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/users" };
