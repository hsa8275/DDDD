export const config = { runtime: "edge" };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const method: string = (req.method || "GET").toUpperCase();
  if (method !== "GET") return json({ error: "Method Not Allowed" }, 405);

  const apiKey: string | undefined = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json({ error: "Missing ELEVENLABS_API_KEY" }, 500);

  try {
    const r: Response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });

    const txt: string = await r.text().catch((): string => "");
    return new Response(txt, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json" },
    });
  } catch (e: unknown) {
    return json({ error: String(e) }, 500);
  }
}
