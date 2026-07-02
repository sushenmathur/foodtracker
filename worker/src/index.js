// Cloudflare Worker API for Sushen's Macro Tracking.
//
// Single-user auth (email + password + TOTP MFA) and per-day meal-log sync
// backed by MongoDB Atlas. Runs server-side so the Mongo credentials never
// reach the browser. See worker/README.md for deploy + secret setup.
//
// Requires: compatibility_flags = ["nodejs_compat"] (for the mongodb driver).
import { MongoClient } from "mongodb";
import {
  hashPassword,
  verifyPassword,
  verifyTotp,
  randomBase32,
  otpauthURL,
  signJWT,
  verifyJWT,
} from "./crypto.js";

const DB_NAME = "foodtracker";

// Reused across requests within an isolate.
let clientPromise;
let indexesReady = false;
async function getDb(env) {
  if (!clientPromise) clientPromise = new MongoClient(env.MONGODB_URI).connect();
  const client = await clientPromise;
  const db = client.db(DB_NAME);
  if (!indexesReady) {
    indexesReady = true;
    try {
      await db.collection("users").createIndex({ email: 1 }, { unique: true });
      await db.collection("days").createIndex({ user: 1, date: 1 }, { unique: true });
    } catch {}
  }
  return db;
}

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Register-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(env) },
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Returns the authenticated user's email, or null.
async function authUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || payload.stage) return null; // "stage" tokens are MFA tickets, not full sessions
  return payload.sub || null;
}

const isEmail = (s) => typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });

    try {
      const db = await getDb(env);
      const users = db.collection("users");
      const days = db.collection("days");

      // ---- Health ----
      if (path === "/" || path === "/health") {
        const count = await users.countDocuments({});
        return json(env, { ok: true, registered: count > 0 });
      }

      // ---- Register the single user (once) ----
      if (path === "/auth/register" && request.method === "POST") {
        if ((await users.countDocuments({})) > 0) return json(env, { error: "Registration is closed." }, 403);
        if (env.REGISTER_TOKEN && request.headers.get("X-Register-Token") !== env.REGISTER_TOKEN) {
          return json(env, { error: "Invalid registration token." }, 403);
        }
        const { email, password } = await readBody(request);
        if (!isEmail(email)) return json(env, { error: "Valid email required." }, 400);
        if (typeof password !== "string" || password.length < 8) {
          return json(env, { error: "Password must be at least 8 characters." }, 400);
        }
        const secret = randomBase32(32);
        await users.insertOne({
          email: email.toLowerCase(),
          passwordHash: await hashPassword(password),
          totpSecret: secret,
          mfaEnabled: false,
          createdAt: new Date(),
        });
        return json(
          env,
          { otpauth_url: otpauthURL({ secret, account: email }), secret },
          201
        );
      }

      // ---- Activate MFA (confirm the authenticator code once) ----
      if (path === "/auth/activate" && request.method === "POST") {
        const { email, password, code } = await readBody(request);
        const user = await users.findOne({ email: (email || "").toLowerCase() });
        if (!user || !(await verifyPassword(password || "", user.passwordHash))) {
          return json(env, { error: "Invalid credentials." }, 401);
        }
        if (!(await verifyTotp(user.totpSecret, code))) return json(env, { error: "Invalid code." }, 401);
        await users.updateOne({ _id: user._id }, { $set: { mfaEnabled: true } });
        return json(env, { token: await signJWT({ sub: user.email }, env.JWT_SECRET) });
      }

      // ---- Login step 1: password → MFA ticket ----
      if (path === "/auth/login" && request.method === "POST") {
        const { email, password } = await readBody(request);
        const user = await users.findOne({ email: (email || "").toLowerCase() });
        if (!user || !(await verifyPassword(password || "", user.passwordHash))) {
          return json(env, { error: "Invalid credentials." }, 401);
        }
        if (!user.mfaEnabled) {
          return json(env, { needsMfaSetup: true, otpauth_url: otpauthURL({ secret: user.totpSecret, account: user.email }) });
        }
        const ticket = await signJWT({ sub: user.email, stage: "mfa" }, env.JWT_SECRET, { expiresInSec: 300 });
        return json(env, { mfaRequired: true, ticket });
      }

      // ---- Login step 2: MFA ticket + code → session token ----
      if (path === "/auth/mfa" && request.method === "POST") {
        const { ticket, code } = await readBody(request);
        const payload = ticket ? await verifyJWT(ticket, env.JWT_SECRET) : null;
        if (!payload || payload.stage !== "mfa") return json(env, { error: "Session expired, log in again." }, 401);
        const user = await users.findOne({ email: payload.sub });
        if (!user || !(await verifyTotp(user.totpSecret, code))) return json(env, { error: "Invalid code." }, 401);
        return json(env, { token: await signJWT({ sub: user.email }, env.JWT_SECRET) });
      }

      // ---- Everything below requires a session ----
      const me = await authUser(request, env);
      if (!me) return json(env, { error: "Unauthorized." }, 401);

      // ---- App state (targets, foods, favourites, recents, profile) ----
      if (path === "/state" && request.method === "GET") {
        const doc = await db.collection("state").findOne({ user: me });
        return json(env, doc ? doc.data : {});
      }
      if (path === "/state" && request.method === "PUT") {
        const { data } = await readBody(request);
        await db.collection("state").updateOne({ user: me }, { $set: { data: data || {}, updatedAt: new Date() } }, { upsert: true });
        return json(env, { ok: true });
      }

      // ---- Per-day logs ----
      if (path === "/days" && request.method === "GET") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const q = { user: me };
        if (from || to) {
          q.date = {};
          if (from) q.date.$gte = from;
          if (to) q.date.$lte = to;
        }
        const list = await days.find(q).sort({ date: 1 }).limit(400).toArray();
        return json(env, list.map((d) => ({ date: d.date, data: d.data })));
      }

      const dayMatch = path.match(/^\/days\/(\d{4}-\d{2}-\d{2})$/);
      if (dayMatch) {
        const date = dayMatch[1];
        if (request.method === "GET") {
          const doc = await days.findOne({ user: me, date });
          return doc ? json(env, { date, data: doc.data }) : json(env, { error: "Not found." }, 404);
        }
        if (request.method === "PUT") {
          const { data } = await readBody(request);
          await days.updateOne({ user: me, date }, { $set: { data: data || {}, updatedAt: new Date() } }, { upsert: true });
          return json(env, { ok: true });
        }
      }

      return json(env, { error: "Not found." }, 404);
    } catch (err) {
      return json(env, { error: "Server error", detail: String(err && err.message) }, 500);
    }
  },
};
