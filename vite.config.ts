// vite.config.ts
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import type { IncomingMessage, ServerResponse } from "http";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let data: string = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString("utf-8")));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readString(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v: unknown = obj[key];
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function readBoolean(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v: unknown = obj[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}

function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v: unknown = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n: number = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseJsonOrEmpty(body: string): Record<string, unknown> {
  const trimmed: string = body.trim();
  if (!trimmed) return {};
  const parsed: unknown = JSON.parse(trimmed) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function elevenLabsDevMiddleware(apiKey: string | undefined): Plugin {
  return {
    name: "elevenlabs-dev-middleware",
    configureServer(server: ViteDevServer) {
      // GET /api/eleven/voices  ->  https://api.elevenlabs.io/v1/voices
      server.middlewares.use("/api/eleven/voices", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const r: Response = await fetch("https://api.elevenlabs.io/v1/voices", {
            headers: { "xi-api-key": apiKey },
          });

          const text: string = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(text);
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });

      // POST /api/eleven/tts -> https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=...
      server.middlewares.use("/api/eleven/tts", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });
          if ((req.method ?? "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body: string = await readBody(req);
          const parsed: Record<string, unknown> = parseJsonOrEmpty(body);

          const text: string = readString(parsed, "text", "").trim();
          const voiceId: string = readString(parsed, "voiceId", "").trim();

          const modelId: string = readString(parsed, "modelId", "eleven_turbo_v2_5");
          const outputFormat: string = readString(parsed, "outputFormat", "mp3_44100_128");
          const voiceSettings: unknown = parsed.voiceSettings ?? undefined;

          if (!text) return json(res, 400, { error: "text is required" });
          if (!voiceId) return json(res, 400, { error: "voiceId is required" });

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
            return json(res, r.status, { error: "ElevenLabs TTS failed", details: errText });
          }

          const ab: ArrayBuffer = await r.arrayBuffer();
          res.statusCode = 200;
          res.setHeader("Content-Type", r.headers.get("content-type") || "audio/mpeg");
          res.end(Buffer.from(ab));
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });

      // POST /api/eleven/voice-design/previews -> /v1/text-to-voice/create-previews?output_format=...
      server.middlewares.use("/api/eleven/voice-design/previews", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });
          if ((req.method ?? "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body: string = await readBody(req);
          const parsed: Record<string, unknown> = parseJsonOrEmpty(body);

          const voiceDescription: string = readString(parsed, "voiceDescription", "").trim();
          const textRaw: string = readString(parsed, "text", "");
          const text: string | undefined = textRaw ? textRaw : undefined;
          const autoGenerateText: boolean = readBoolean(parsed, "autoGenerateText", false);

          const outputFormat: string = readString(parsed, "outputFormat", "mp3_44100_192");
          const loudness: number | undefined = readNumber(parsed, "loudness");
          const quality: number | undefined = readNumber(parsed, "quality");
          const seed: number | undefined = readNumber(parsed, "seed");
          const guidanceScale: number | undefined = readNumber(parsed, "guidanceScale");

          if (!voiceDescription) return json(res, 400, { error: "voiceDescription is required" });

          const url: string =
            `https://api.elevenlabs.io/v1/text-to-voice/create-previews` +
            `?output_format=${encodeURIComponent(outputFormat)}`;

          const payload: Record<string, unknown> = {
            voice_description: voiceDescription,
            ...(autoGenerateText ? { auto_generate_text: true } : { text }),
          };
          if (typeof loudness === "number") payload.loudness = loudness;
          if (typeof quality === "number") payload.quality = quality;
          if (typeof seed === "number") payload.seed = seed;
          if (typeof guidanceScale === "number") payload.guidance_scale = guidanceScale;

          const r: Response = await fetch(url, {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          const txt: string = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(txt);
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });

      // POST /api/eleven/voice-design/create -> /v1/text-to-voice
      server.middlewares.use("/api/eleven/voice-design/create", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });
          if ((req.method ?? "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body: string = await readBody(req);
          const parsed: Record<string, unknown> = parseJsonOrEmpty(body);

          const voiceName: string = readString(parsed, "voiceName", "").trim();
          const voiceDescription: string = readString(parsed, "voiceDescription", "").trim();
          const generatedVoiceId: string = readString(parsed, "generatedVoiceId", "").trim();

          if (!voiceName) return json(res, 400, { error: "voiceName is required" });
          if (!voiceDescription) return json(res, 400, { error: "voiceDescription is required" });
          if (!generatedVoiceId) return json(res, 400, { error: "generatedVoiceId is required" });

          const payload: Record<string, unknown> = {
            voice_name: voiceName,
            voice_description: voiceDescription,
            generated_voice_id: generatedVoiceId,
          };

          if (parsed.labels !== undefined) payload.labels = parsed.labels;
          if (parsed.playedNotSelectedVoiceIds !== undefined) payload.played_not_selected_voice_ids = parsed.playedNotSelectedVoiceIds;

          const r: Response = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          const txt: string = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(txt);
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });

      // POST /api/ai/transform -> http://34.64.208.249:80/ai/transform
      server.middlewares.use("/api/ai/transform", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if ((req.method ?? "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body: string = await readBody(req);
          const parsed: Record<string, unknown> = parseJsonOrEmpty(body);

          const message: string = readString(parsed, "message", "").trim();
          if (!message) return json(res, 400, { error: "message is required" });

          const r: Response = await fetch("http://34.64.208.249:80/ai/transform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          });

          const txt: string = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(txt);
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });

      // ✅ NEW: GET /api/ai/swear -> http://34.64.208.249:80/ai/swear
      server.middlewares.use("/api/ai/swear", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const r: Response = await fetch("http://34.64.208.249:80/ai/swear", { method: "GET" });

          const txt: string = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(txt);
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env: Record<string, string> = loadEnv(mode, process.cwd(), "") as Record<string, string>;
  const apiKey: string | undefined = env.ELEVENLABS_API_KEY;

  return {
    plugins: [react(), tailwindcss(), elevenLabsDevMiddleware(apiKey)],
  };
});
