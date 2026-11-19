import { getEntry, json, type Env } from "./fpl";

const enc = new TextEncoder();
const dec = new TextDecoder();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type Claims = { exp: number; typ: string; id?: string; code?: string };

const b64u = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const unb64u = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret: string) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function sign(claims: Claims, secret: string): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64u(new Uint8Array(sig))}`;
}

async function verify(token: string, secret: string): Promise<Claims | null> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const claims = JSON.parse(dec.decode(unb64u(body))) as Claims;
    return Date.now() / 1000 < claims.exp ? claims : null;
  } catch {
    return null;
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);
const configured = (env: Env) => !!env.SECRET && env.SECRET.length >= 32;

export async function challenge(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json({ error: "Server misconfigured." }, 500);

  const body = (await request.json().catch(() => ({}))) as { entryId?: unknown };
  const id = String(body.entryId ?? "").trim();
  if (!/^\d{1,9}$/.test(id)) return json({ error: "Enter a numeric FPL team ID." }, 400);
  if (!(await getEntry(id))) return json({ error: "No FPL team found with that ID." }, 404);

  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = `FPL-${[...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("")}`;
  const token = await sign({ typ: "challenge", id, code, exp: nowSec() + 15 * 60 }, env.SECRET);
  return json({ code, token });
}

export async function login(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json({ error: "Server misconfigured." }, 500);

  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const ch = await verify(String(body.token ?? ""), env.SECRET);
  if (!ch || ch.typ !== "challenge" || !ch.id || !ch.code) {
    return json({ error: "This code has expired. Start again." }, 400);
  }

  const entry = await getEntry(ch.id);
  if (!entry) return json({ error: "FPL team not found." }, 404);

  if (!entry.name.toUpperCase().includes(ch.code)) {
    return json(
      { error: `Your team name does not contain ${ch.code} yet. FPL can take a moment to update, so try again shortly.` },
      403,
    );
  }

  const token = await sign({ typ: "session", id: ch.id, exp: nowSec() + 7 * 24 * 3600 }, env.SECRET);
  return json({ token, entryId: ch.id, name: entry.name });
}

export async function me(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json({ error: "Server misconfigured." }, 500);

  const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const s = await verify(bearer, env.SECRET);
  if (!s || s.typ !== "session" || !s.id) return json({ error: "Not signed in." }, 401);

  const entry = await getEntry(s.id);
  if (!entry) return json({ error: "FPL team unavailable." }, 502);
  return json({ entryId: s.id, entry });
}
