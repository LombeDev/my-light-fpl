import { ensureLive, ensureSnapshot, ensureState, getEntry, json, type Bg, type Env, type Meta } from "../../lib/fpl";
import { challenge, login, me, myLeagues } from "../../lib/auth";
import { league } from "../../lib/leagues";
import { livescore } from "../../lib/live";
import { managers } from "../../lib/managers";
import { around, sampleSummary } from "../../lib/stats";

const raw = (body: string, cacheControl: string): Response =>
  new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": cacheControl } });

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const bg: Bg = { waitUntil: (p) => ctx.waitUntil(p) };
  const path = ((params.route as string[] | undefined) ?? []).join("/");

  try {
    if (request.method === "GET") {
      if (path === "snapshot") {
        await ensureState(env, bg);
        await ensureSnapshot(env, bg);
        const body = await env.FPL_KV.get("snapshot");
        return body ? raw(body, "public, max-age=60") : json({ error: "Not available yet." }, 503);
      }

      if (path === "version") {
        await ensureState(env, bg);
        await ensureSnapshot(env, bg);
        const body = await env.FPL_KV.get("version");
        return body ? raw(body, "public, max-age=15") : json({ error: "Not available yet." }, 503);
      }

      if (path === "live") {
        const meta: Meta | null = await ensureState(env, bg);
        if (meta?.live && meta.gw !== null) await ensureLive(env, bg, meta.gw);
        const body = await env.FPL_KV.get("live");
        return body ? raw(body, "no-store") : json({ hash: null, deltas: [] });
      }

      if (path === "me") return await me(request, env);
      if (path === "me/leagues") return await myLeagues(request, env);
      if (path === "managers") return await managers(request, env);
      if (path === "livescore") return await livescore(request, env);
      if (path === "sample") return await sampleSummary(env, bg);

      const am = /^around\/(\d{1,9})$/.exec(path);
      if (am) return await around(am[1], env);

      const pm = /^picks\/(\d{1,9})\/(\d{1,2})$/.exec(path);
      if (pm) {
        const res = await fetch(`https://fantasy.premierleague.com/api/entry/${pm[1]}/event/${pm[2]}/picks/`, {
          headers: { "User-Agent": "fpl-site/1.0", Accept: "application/json" },
          cf: { cacheTtl: 120, cacheEverything: true },
        });
        if (!res.ok) return json({ error: "Not available yet." }, res.status === 404 ? 404 : 502);
        return raw(await res.text(), "public, max-age=60");
      }

      const lm = /^league\/(\d{1,9})$/.exec(path);
      if (lm) {
        const page = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("page")) || 1));
        return await league(lm[1], page);
      }

      const em = /^entry\/(\d{1,9})$/.exec(path);
      if (em) {
        const entry = await getEntry(em[1]);
        return entry
          ? raw(JSON.stringify({ entry }), "public, max-age=300")
          : json({ error: "Manager not found." }, 404);
      }
    }

    if (request.method === "POST") {
      if (path === "auth/challenge") return await challenge(request, env);
      if (path === "auth/verify") return await login(request, env);
    }

    return json({ error: "Not found." }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Server error." }, 500);
  }
};
