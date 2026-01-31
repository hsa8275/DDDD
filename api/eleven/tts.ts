export const config = { runtime: "edge" };

type TTSBody = {
  text?: unknown;
  voiceId?: unknown;
  modelId?: unknown;
  outputFormat?: unknown;
  voiceSettings?: unknown;
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
    const parsed: TTSBody = (await req.json().catch((): TTSBody => ({}))) as TTSBody;

    const text: string = String(parsed.text ?? "").trim();
    const voiceId: string = String(parsed.voiceId ?? "").trim();

    const modelId: string = String(parsed.modelId ?? "eleven_turbo_v2_5");
    const outputFormat: string = String(parsed.outputFormat ?? "mp3_44100_128");
    const voiceSettings: unknown = parsed.voiceSettings ?? undefined;

    if (!text) return json({ error: "text is required" }, 400);
    if (!voiceId) return json({ error: "voiceId is required" }, 400);

    const url: string =
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
      `?output_format=${encodeURIComponent(outputFormat)}`;

    const r: Response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: voiceSettings,
      }),
    });

    if (!r.ok) {
      const errText: string = await r.text().catch((): string => "");
      return json({ error: "ElevenLabs TTS failed", details: errText }, r.status);
    }

    const ab: ArrayBuffer = await r.arrayBuffer();
    return new Response(ab, {
      status: 200,
      headers: { "Content-Type": r.headers.get("content-type") || "audio/mpeg" },
    });
  } catch (e: unknown) {
    return json({ error: String(e) }, 500);
  }
}
