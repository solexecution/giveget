import type { Hono } from "hono";

export function csrfHeaders(base: string): Record<string, string> {
  return {
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
  };
}

export function cookieFrom(res: Response): string {
  const set = res.headers.getSetCookie?.() ?? [];
  const sid = set.find((c) => c.startsWith("gg_sid="));
  if (!sid) return "";
  return sid.split(";")[0]!;
}

export async function signup(
  app: Hono,
  base: string,
  nickname: string,
  cookie = ""
): Promise<{ res: Response; cookie: string }> {
  const res = await app.request(`${base}/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...csrfHeaders(base),
      ...(cookie ? { cookie } : {}),
    },
    body: `nickname=${encodeURIComponent(nickname)}`,
  });
  const next = cookieFrom(res) || cookie;
  return { res, cookie: next };
}

export async function loginWithPassword(
  app: Hono,
  base: string,
  nickname: string,
  password: string
): Promise<{ res: Response; cookie: string }> {
  const res = await app.request(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...csrfHeaders(base),
    },
    body: `nickname=${encodeURIComponent(nickname)}&password=${encodeURIComponent(password)}`,
  });
  return { res, cookie: cookieFrom(res) };
}
