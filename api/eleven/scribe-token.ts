// api/eleven/scribe-token.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type OkBody = { token: string };
type ErrBody = { error: string; detail?: string; upstreamStatus?: number };

function setCors(res: VercelResponse): void {
  // 같은 도메인에서만 쓸 거면 사실 필수는 아니지만, dev/preview에서 편하게 두는 게 좋음
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" } satisfies ErrBody);
    return;
  }

  const apiKey: string | undefined = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res
      .status(500)
      .json({ error: "Missing ELEVENLABS_API_KEY in environment" } satisfies ErrBody);
    return;
  }

  try {
    const upstream = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
    });

    const text = await upstream.text().catch((): string => "");
    if (!upstream.ok) {
      res.status(502).json({
        error: "Upstream token request failed",
        upstreamStatus: upstream.status,
        detail: text || upstream.statusText,
      } satisfies ErrBody);
      return;
    }

    const dataUnknown: unknown = text ? JSON.parse(text) : null;
    const token: string | undefined =
      typeof (dataUnknown as { token?: unknown } | null)?.token === "string"
        ? (dataUnknown as { token: string }).token
        : undefined;

    if (!token) {
      res.status(502).json({
        error: "Upstream returned no token",
        detail: text || "empty body",
      } satisfies ErrBody);
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ token } satisfies OkBody);
  } catch (e: unknown) {
    res.status(502).json({ error: "fetch failed", detail: String(e) } satisfies ErrBody);
  }
}
