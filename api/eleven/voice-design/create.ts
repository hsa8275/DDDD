export const config = { runtime: "edge" };

type Body = {
  voiceName?: unknown;
  voiceDescription?: unknown;
  generatedVoiceId?: unknown;
  labels?: unknown;
  playedNotSelectedVoiceIds?: unknown;
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

    const voiceName: string = String(parsed.voiceName ?? "").trim();
    const voiceDescription: string = String(parsed.voiceDescription ?? "").trim();
    const generatedVoiceId: string = String(parsed.generatedVoiceId ?? "").trim();

    if (!voiceName) return json({ error: "voiceName is required" }, 400);
    if (!voiceDescription) return json({ error: "voiceDescription is required" }, 400);
    if (!generatedVoiceId) return json({ error: "generatedVoiceId is required" }, 400);

    const labels: unknown = parsed.labels;
    const playedNotSelectedVoiceIds: unknown = parsed.playedNotSelectedVoiceIds;

    const bodyObj: Record<string, unknown> = {
      voice_name: voiceName,
      voice_description: voiceDescription,
      generated_voice_id: generatedVoiceId,
      ...(labels != null ? { labels } : {}),
      ...(playedNotSelectedVoiceIds != null ? { played_not_selected_voice_ids: playedNotSelectedVoiceIds } : {}),
    };

    const r: Response = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
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
