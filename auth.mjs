import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
export const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// ---- accounts ----------------------------------------------------------
// USERS env var (always works, cannot be deleted from the website):
//   {"nico":"password1","admin":"password2"}
// ADMINS env var: comma-separated usernames that get admin powers: nico,admin
// Extra users added from the website are stored (hashed) in Netlify Blobs.

export function envUsers() {
  try {
    return JSON.parse(process.env.USERS || "{}");
  } catch {
    return {};
  }
}

export function isAdmin(user) {
  return (process.env.ADMINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(user).toLowerCase());
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString("hex") };
}

const findName = (obj, name) => Object.keys(obj).find((u) => u.toLowerCase() === String(name).toLowerCase());

export async function checkLogin(username, password) {
  username = String(username || "").trim();
  password = String(password || "");
  if (!username || !password) return null;

  const env = envUsers();
  const envName = findName(env, username);
  if (envName) return safeEqual(env[envName], password) ? envName : null;

  const stored = (await getStore("feeder").get("users", { type: "json" })) || {};
  const name = findName(stored, username);
  if (!name) return null;
  const { salt, hash } = stored[name];
  const attempt = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(attempt, Buffer.from(hash, "hex")) ? name : null;
}

// ---- tokens ------------------------------------------------------------
export function signToken(user) {
  const payload = { u: user, exp: Date.now() + 1000 * 60 * 60 * 12 }; // 12 hours
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

// Returns the username if the Authorization header holds a valid token, else null
export function getUser(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [body, sig] = token.split(".");
  if (!body || !sig || !process.env.AUTH_SECRET) return null;
  const expected = crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload.exp > Date.now() ? payload.u : null;
  } catch {
    return null;
  }
}

export function isDevice(req) {
  const key = req.headers.get("x-device-key") || "";
  return Boolean(process.env.DEVICE_KEY) && safeEqual(key, process.env.DEVICE_KEY);
}
