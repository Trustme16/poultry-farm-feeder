import { checkLogin, signToken, isAdmin, json } from "../lib/auth.mjs";

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
  const user = await checkLogin(body.username, body.password);
  if (!user) return json({ error: "Wrong username or password" }, 401);
  return json({ token: signToken(user), user, admin: isAdmin(user) });
};

export const config = { path: "/api/login" };
