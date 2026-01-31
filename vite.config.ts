// vite.config.ts
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

function readBody(req: any) {
  return new Promise<string>((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: any) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ✅ multipart 업로드(IVC)는 req 스트림 그대로 upstream으로 전달해야 함
async function proxyStreamToElevenLabs(req: any, res: any, apiKey: string, url: string) {
  const headers: Record<string, string> = {
    "xi-api-key": apiKey,
  };

  const ct = req.headers["content-type"];
  if (ct) headers["content-type"] = String(ct);

  const cl = req.headers["content-length"];
  if (cl) headers["content-length"] = String(cl);

  const r = await fetch(url, {
    method: "POST",
    headers,
    // Node fetch에 stream body 전달 시 필요
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: req as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    duplex: "half" as any,
  } as any);

  const txt = await r.text();
  res.statusCode = r.status;
  res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
  res.end(txt);
}

function elevenLabsDevMiddleware(apiKey: string | undefined): Plugin {
  return {
    name: "elevenlabs-dev-middleware",
    configureServer(server) {
      // ✅ POST /api/eleven/voices/add -> https://api.elevenlabs.io/v1/voices/add (Instant Voice Cloning)
      server.middlewares.use("/api/eleven/voices/add", async (req, res) => {
        try {
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing ELEVENLABS_API_KEY in .env.local" }));
            return;
          }

          const m = (req.method || "POST").toUpperCase();
          if (m === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (m !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          await proxyStreamToElevenLabs(req, res, apiKey, "https://api.elevenlabs.io/v1/voices/add");
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      // GET /api/eleven/voices  ->  https://api.elevenlabs.io/v1/voices
      server.middlewares.use("/api/eleven/voices", async (req, res) => {
        try {
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing ELEVENLABS_API_KEY in .env.local" }));
            return;
          }
          if ((req.method || "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const r = await fetch("https://api.elevenlabs.io/v1/voices", {
            headers: { "xi-api-key": apiKey },
          });

          const text = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
          res.end(text);
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      // POST /api/eleven/tts  ->  https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=...
      server.middlewares.use("/api/eleven/tts", async (req, res) => {
        try {
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing ELEVENLABS_API_KEY in .env.local" }));
            return;
          }
          if ((req.method || "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body = await readBody(req);
          const parsed = JSON.parse(body || "{}");
          const text: string = String(parsed.text ?? "").trim();
          const voiceId: string = String(parsed.voiceId ?? "").trim();

          const modelId: string = String(parsed.modelId ?? "eleven_turbo_v2_5");
          const outputFormat: string = String(parsed.outputFormat ?? "mp3_44100_128");
          const voiceSettings = parsed.voiceSettings ?? undefined;

          if (!text) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "text is required" }));
            return;
          }
          if (!voiceId) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "voiceId is required" }));
            return;
          }

          const url =
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
            `?output_format=${encodeURIComponent(outputFormat)}`;

          const r = await fetch(url, {
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
            const errText = await r.text().catch(() => "");
            res.statusCode = r.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "ElevenLabs TTS failed", details: errText }));
            return;
          }

          const ab = await r.arrayBuffer();
          res.statusCode = 200;
          res.setHeader("Content-Type", r.headers.get("content-type") || "audio/mpeg");
          res.end(Buffer.from(ab));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      // ✅ POST /api/eleven/voice-design/previews -> /v1/text-to-voice/create-previews?output_format=...
      server.middlewares.use("/api/eleven/voice-design/previews", async (req, res) => {
        try {
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing ELEVENLABS_API_KEY in .env.local" }));
            return;
          }
          if ((req.method || "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body = await readBody(req);
          const parsed = JSON.parse(body || "{}");

          const voiceDescription: string = String(parsed.voiceDescription ?? "").trim();
          const text: string | undefined = parsed.text ? String(parsed.text) : undefined;
          const autoGenerateText: boolean = !!parsed.autoGenerateText;

          const outputFormat: string = String(parsed.outputFormat ?? "mp3_44100_192");
          const loudness: number | undefined = typeof parsed.loudness === "number" ? parsed.loudness : undefined;
          const quality: number | undefined = typeof parsed.quality === "number" ? parsed.quality : undefined;
          const seed: number | undefined = typeof parsed.seed === "number" ? parsed.seed : undefined;
          const guidanceScale: number | undefined =
            typeof parsed.guidanceScale === "number" ? parsed.guidanceScale : undefined;

          if (!voiceDescription) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "voiceDescription is required" }));
            return;
          }

          const url =
            `https://api.elevenlabs.io/v1/text-to-voice/create-previews` +
            `?output_format=${encodeURIComponent(outputFormat)}`;

          const r = await fetch(url, {
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

          const txt = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
          res.end(txt);
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      // ✅ POST /api/eleven/voice-design/create -> /v1/text-to-voice
      server.middlewares.use("/api/eleven/voice-design/create", async (req, res) => {
        try {
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing ELEVENLABS_API_KEY in .env.local" }));
            return;
          }
          if ((req.method || "POST").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const body = await readBody(req);
          const parsed = JSON.parse(body || "{}");

          const voiceName: string = String(parsed.voiceName ?? "").trim();
          const voiceDescription: string = String(parsed.voiceDescription ?? "").trim();
          const generatedVoiceId: string = String(parsed.generatedVoiceId ?? "").trim();

          if (!voiceName) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "voiceName is required" }));
            return;
          }
          if (!voiceDescription) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "voiceDescription is required" }));
            return;
          }
          if (!generatedVoiceId) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "generatedVoiceId is required" }));
            return;
          }

          const r = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              voice_name: voiceName,
              voice_description: voiceDescription,
              generated_voice_id: generatedVoiceId,
              ...(parsed.labels ? { labels: parsed.labels } : null),
              ...(parsed.playedNotSelectedVoiceIds
                ? { played_not_selected_voice_ids: parsed.playedNotSelectedVoiceIds }
                : null),
            }),
          });

          const txt = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
          res.end(txt);
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.ELEVENLABS_API_KEY;

  return {
    plugins: [react(), tailwindcss(), elevenLabsDevMiddleware(apiKey)],
  };
});
