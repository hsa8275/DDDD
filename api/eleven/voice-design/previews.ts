export const config = { runtime: "edge" };

type Body = {
  voiceDescription?: unknown;
  text?: unknown;
  autoGenerateText?: unknown;
  outputFormat?: unknown;
  loudness?: unknown;
  quality?: unknown;
  seed?: unknown;
  guidanceScale?: unknown;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const method: string = (req.method || "POST").toUpperCase();
  if (method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const apiKey: string | undefined = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json({ error: "Missing ELEVENLABS_API_KEY" }, 500);

  try {
    const parsed: Body = (await req.json().catch((): Body => ({}))) as Body;

    const voiceDescription: string = String(parsed.voiceDescription ?? "").trim();
    const text: string | undefined = parsed.text != null ? String(parsed.text) : undefined;
    const autoGenerateText: boolean = Boolean(parsed.autoGenerateText);

    const outputFormat: string = String(parsed.outputFormat ?? "mp3_44100_192");

    const loudness: number | undefined = typeof parsed.loudness === "number" ? parsed.loudness : undefined;
    const quality: number | undefined = typeof parsed.quality === "number" ? parsed.quality : undefined;
    const seed: number | undefined = typeof parsed.seed === "number" ? parsed.seed : undefined;
    const guidanceScale: number | undefined = typeof parsed.guidanceScale === "number" ? parsed.guidanceScale : undefined;

    if (!voiceDescription) return json({ error: "voiceDescription is required" }, 400);

    const url: string =
      `https://api.elevenlabs.io/v1/text-to-voice/create-previews` +
      `?output_format=${encodeURIComponent(outputFormat)}`;

    const bodyObj: Record<string, unknown> = {
      voice_description: voiceDescription,
      ...(autoGenerateText ? { auto_generate_text: true } : { text }),
      ...(typeof loudness === "number" ? { loudness } : {}),
      ...(typeof quality === "number" ? { quality } : {}),
      ...(typeof seed === "number" ? { seed } : {}),
      ...(typeof guidanceScale === "number" ? { guidance_scale: guidanceScale } : {}),
    };

    const r: Response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyObj),
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
