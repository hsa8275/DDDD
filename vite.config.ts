// vite.config.ts
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import type { IncomingMessage, ServerResponse } from "http";

type Next = (err?: unknown) => void;

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

function elevenLabsDevMiddleware(apiKey: string | undefined): Plugin {
  return {
    name: "elevenlabs-dev-middleware",
    configureServer(server) {
      // ✅ 1) /api/eleven/voices/add 를 /api/eleven/voices 보다 먼저 등록 (prefix 충돌 방지)
      server.middlewares.use("/api/eleven/voices/add", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });

          const method: string = String(req.method ?? "GET").toUpperCase();

          if (method === "OPTIONS") {
            res.statusCode = 204;
            res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "content-type");
            res.end();
            return;
          }

          if (method !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const ctHeader: unknown = req.headers["content-type"];
          const contentType: string = typeof ctHeader === "string" ? ctHeader : "";
          if (!contentType.includes("multipart/form-data")) {
            res.statusCode = 400;
            res.end("Content-Type must be multipart/form-data");
            return;
          }

          const upstream: Response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "content-type": contentType,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            body: req as unknown as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            duplex: "half" as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);

          const ab: ArrayBuffer = await upstream.arrayBuffer();
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(Buffer.from(ab));
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });

      // ✅ 2) /api/eleven/voices 는 서브패스면 next()로 넘기기 (예: /add)
      server.middlewares.use("/api/eleven/voices", async (req: IncomingMessage, res: ServerResponse, next: Next) => {
        try {
          const restPath: string = typeof req.url === "string" ? req.url : "";
          if (restPath && restPath !== "/" && restPath !== "") {
            next();
            return;
          }

          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });

          const method: string = String(req.method ?? "GET").toUpperCase();
          if (method !== "GET") {
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

      // POST /api/eleven/tts
      server.middlewares.use("/api/eleven/tts", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });
          if (String(req.method ?? "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body: string = await readBody(req);
          const parsed: unknown = JSON.parse(body || "{}");
          const rec: Record<string, unknown> = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

          const text: string = String(rec.text ?? "").trim();
          const voiceId: string = String(rec.voiceId ?? "").trim();
          const modelId: string = String(rec.modelId ?? "eleven_turbo_v2_5");
          const outputFormat: string = String(rec.outputFormat ?? "mp3_44100_128");
          const voiceSettings: unknown = rec.voiceSettings ?? undefined;

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
            const errText: string = await r.text().catch(() => "");
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

      // POST /api/eleven/voice-design/previews
      server.middlewares.use("/api/eleven/voice-design/previews", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });
          if (String(req.method ?? "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body: string = await readBody(req);
          const parsed: unknown = JSON.parse(body || "{}");
          const rec: Record<string, unknown> = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

          const voiceDescription: string = String(rec.voiceDescription ?? "").trim();
          const text: string | undefined = rec.text ? String(rec.text) : undefined;
          const autoGenerateText: boolean = Boolean(rec.autoGenerateText);

          const outputFormat: string = String(rec.outputFormat ?? "mp3_44100_192");
          const loudness: number | undefined = typeof rec.loudness === "number" ? rec.loudness : undefined;
          const quality: number | undefined = typeof rec.quality === "number" ? rec.quality : undefined;
          const seed: number | undefined = typeof rec.seed === "number" ? rec.seed : undefined;
          const guidanceScale: number | undefined = typeof rec.guidanceScale === "number" ? rec.guidanceScale : undefined;

          if (!voiceDescription) return json(res, 400, { error: "voiceDescription is required" });

          const url: string =
            `https://api.elevenlabs.io/v1/text-to-voice/create-previews` +
            `?output_format=${encodeURIComponent(outputFormat)}`;

          const r: Response = await fetch(url, {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              voice_description: voiceDescription,
              ...(autoGenerateText ? { auto_generate_text: true } : { text }),
              ...(typeof loudness === "number" ? { loudness } : null),
              ...(typeof quality === "number" ? { quality } : null),
              ...(typeof seed === "number" ? { seed } : null),
              ...(typeof guidanceScale === "number" ? { guidance_scale: guidanceScale } : null),
            }),
          });

          const txt: string = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(txt);
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });

      // POST /api/eleven/voice-design/create
      server.middlewares.use("/api/eleven/voice-design/create", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!apiKey) return json(res, 500, { error: "Missing ELEVENLABS_API_KEY in .env.local" });
          if (String(req.method ?? "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body: string = await readBody(req);
          const parsed: unknown = JSON.parse(body || "{}");
          const rec: Record<string, unknown> = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

          const voiceName: string = String(rec.voiceName ?? "").trim();
          const voiceDescription: string = String(rec.voiceDescription ?? "").trim();
          const generatedVoiceId: string = String(rec.generatedVoiceId ?? "").trim();

          if (!voiceName) return json(res, 400, { error: "voiceName is required" });
          if (!voiceDescription) return json(res, 400, { error: "voiceDescription is required" });
          if (!generatedVoiceId) return json(res, 400, { error: "generatedVoiceId is required" });

          const r: Response = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              voice_name: voiceName,
              voice_description: voiceDescription,
              generated_voice_id: generatedVoiceId,
              ...(rec.labels ? { labels: rec.labels } : null),
              ...(rec.playedNotSelectedVoiceIds ? { played_not_selected_voice_ids: rec.playedNotSelectedVoiceIds } : null),
            }),
          });

          const txt: string = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(txt);
        } catch (e: unknown) {
          return json(res, 500, { error: String(e) });
        }
      });

      // POST /api/ai/transform
      server.middlewares.use("/api/ai/transform", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (String(req.method ?? "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body: string = await readBody(req);
          const parsed: unknown = JSON.parse(body || "{}");
          const rec: Record<string, unknown> = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

          const message: string = String(rec.message ?? "").trim();
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
    },
  };
}

export default defineConfig(({ mode }) => {
  const env: Record<string, string> = loadEnv(mode, process.cwd(), "");
  const apiKey: string | undefined = env.ELEVENLABS_API_KEY || env.XI_API_KEY;

  return {
    plugins: [react(), tailwindcss(), elevenLabsDevMiddleware(apiKey)],
  };
});
