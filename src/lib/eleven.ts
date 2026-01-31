// src/lib/eleven.ts
export type ElevenVoice = {
  voice_id: string;
  name: string;
  category?: string;
};

export type TonePreset = "neutral" | "warm";

export type ElevenVoiceSettings = {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
};

export type VoiceDesignPreview = {
  audio_base_64: string;
  generated_voice_id: string;
  media_type: string;
  duration_secs?: number;
  language?: string;
};

export type AddVoiceResult = {
  voice_id: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readString(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function presetSettings(preset: TonePreset): ElevenVoiceSettings {
  if (preset === "neutral") {
    return {
      stability: 0.88,
      similarity_boost: 0.6,
      style: 0.05,
      use_speaker_boost: true,
      speed: 1.0,
    } satisfies ElevenVoiceSettings;
  }
  return {
    stability: 0.38,
    similarity_boost: 0.88,
    style: 0.55,
    use_speaker_boost: true,
    speed: 0.96,
  } satisfies ElevenVoiceSettings;
}

export async function listVoices(): Promise<ElevenVoice[]> {
  const r: Response = await fetch("/api/eleven/voices", { method: "GET" });
  if (!r.ok) throw new Error(await safeText(r));

  const data: unknown = await r.json().catch((): unknown => null);
  const rawVoices: unknown[] =
    isRecord(data) && Array.isArray(data.voices) ? (data.voices as unknown[]) : [];

  const voices: ElevenVoice[] = rawVoices.flatMap((v: unknown): ElevenVoice[] => {
    if (!isRecord(v)) return [];
    const voice_id: string = readString(v.voice_id, "");
    if (!voice_id) return [];

    const name: string = readString(v.name, "Unknown");
    const category: string | undefined =
      typeof v.category === "string" ? v.category : v.category != null ? String(v.category) : undefined;

    return [{ voice_id, name, category }];
  });

  return voices;
}

export async function tts(params: {
  text: string;
  voiceId: string;
  preset: TonePreset;
  speed?: number;
  voiceSettings?: Partial<ElevenVoiceSettings>;
}): Promise<{ url: string }> {
  const base: ElevenVoiceSettings = presetSettings(params.preset);

  const voiceSettings: ElevenVoiceSettings = {
    ...base,
    ...(params.voiceSettings ?? undefined),
    ...(typeof params.speed === "number" ? { speed: params.speed } : undefined),
  };

  const r: Response = await fetch("/api/eleven/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      voiceId: params.voiceId,
      modelId: "eleven_turbo_v2_5",
      outputFormat: "mp3_44100_128",
      voiceSettings,
    }),
  });

  if (!r.ok) throw new Error(await safeText(r));

  const blob: Blob = await r.blob();
  const url: string = URL.createObjectURL(blob);
  return { url };
}

/** ✅ Voice Design: 프롬프트 → 3개 프리뷰 생성 */
export async function createVoiceDesignPreviews(params: {
  voiceDescription: string;
  text?: string;
  autoGenerateText?: boolean;
  outputFormat?: string;
  loudness?: number;
  quality?: number;
  seed?: number;
  guidanceScale?: number;
}): Promise<{ previews: VoiceDesignPreview[]; text: string }> {
  const r: Response = await fetch("/api/eleven/voice-design/previews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(await safeText(r));

  const data: unknown = await r.json().catch((): unknown => null);
  if (!isRecord(data)) throw new Error("Invalid response (voice design previews)");

  const text: string = readString(data.text, "");
  const previewsRaw: unknown[] = Array.isArray(data.previews) ? (data.previews as unknown[]) : [];

  const previews: VoiceDesignPreview[] = previewsRaw.flatMap((p: unknown): VoiceDesignPreview[] => {
    if (!isRecord(p)) return [];
    const audio_base_64: string = readString(p.audio_base_64, "");
    const generated_voice_id: string = readString(p.generated_voice_id, "");
    const media_type: string = readString(p.media_type, "");
    if (!audio_base_64 || !generated_voice_id || !media_type) return [];

    const duration_secs: number | undefined =
      typeof p.duration_secs === "number" ? p.duration_secs : undefined;
    const language: string | undefined = typeof p.language === "string" ? p.language : undefined;

    return [{ audio_base_64, generated_voice_id, media_type, duration_secs, language }];
  });

  return { previews, text };
}

/** ✅ Voice Design: 선택된 generated_voice_id를 내 Voice로 저장 */
export async function createVoiceFromDesign(params: {
  voiceName: string;
  voiceDescription: string;
  generatedVoiceId: string;
  labels?: Record<string, string>;
  playedNotSelectedVoiceIds?: string[];
}): Promise<ElevenVoice> {
  const r: Response = await fetch("/api/eleven/voice-design/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(await safeText(r));

  const data: unknown = await r.json().catch((): unknown => null);
  if (!isRecord(data)) throw new Error("Invalid response (voice design create)");

  return {
    voice_id: readString(data.voice_id, ""),
    name: readString(data.name, params.voiceName),
    category: typeof data.category === "string" ? data.category : undefined,
  };
}

/** ✅ Voice Clone: 오디오 파일들로 내 목소리 추가(클로닝) */
export async function addVoice(params: {
  name: string;
  files: File[];
  description?: string;
  labels?: Record<string, string>;
}): Promise<AddVoiceResult> {
  const fd: FormData = new FormData();
  fd.append("name", params.name);

  for (const f of params.files) {
    fd.append("files", f, f.name);
  }

  if (typeof params.description === "string" && params.description.trim().length > 0) {
    fd.append("description", params.description.trim());
  }

  if (params.labels && Object.keys(params.labels).length > 0) {
    fd.append("labels", JSON.stringify(params.labels));
  }

  // ✅ ElevenLabs Add Voice 프록시로 보냄 (POST multipart/form-data) :contentReference[oaicite:1]{index=1}
  const r: Response = await fetch("/api/eleven/voices/add", {
    method: "POST",
    body: fd,
  });

  if (!r.ok) throw new Error(await safeText(r));

  const data: unknown = await r.json().catch((): unknown => null);
  if (!isRecord(data)) throw new Error("Invalid response (addVoice)");

  const voice_id: string = readString(data.voice_id, "");
  if (!voice_id) throw new Error("addVoice: missing voice_id");

  return { voice_id };
}

async function safeText(r: Response): Promise<string> {
  const t: string = await r.text().catch((): string => "");
  return t || `${r.status} ${r.statusText}`;
}
