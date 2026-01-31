// api/ai/transform.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type TransformReqBody = {
  message?: string;
  original_message?: string;
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function backendOrigin(): string {
  const raw: string = (process.env.AI_BACKEND_ORIGIN ?? "http://34.64.208.249").trim();
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function pickMessage(body: TransformReqBody): string {
  const m: string = String(body.message ?? "").trim();
  const o: string = String(body.original_message ?? "").trim();
  return (m || o).trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const body: TransformReqBody = (req.body ?? {}) as TransformReqBody;
  const message: string = pickMessage(body);

  if (!message) {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  const target: string = `${backendOrigin()}/ai/transform`;

  try {
    const upstream: Response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const text: string = await upstream.text();
    res.setHeader("Cache-Control", "no-store");

    try {
      const data: JsonValue = JSON.parse(text) as JsonValue;
      res.status(upstream.status).json(data);
      return;
    } catch {
      res.status(upstream.status).send(text);
      return;
    }
  } catch (e: unknown) {
    res.status(502).json({ error: "Bad Gateway", detail: String(e) });
  }
}
