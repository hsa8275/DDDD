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

type VoicesAPIItem = {
  voice_id: unknown;
  name?: unknown;
  category?: unknown;
};

type VoicesAPIResponse = {
  voices?: unknown;
};

function presetSettings(preset: TonePreset): ElevenVoiceSettings {
  if (preset === "neutral") {
    return {
      stability: 0.88,
      similarity_boost: 0.6,
      style: 0.05,
      use_speaker_boost: true,
      speed: 1.0,
    };
  }
  return {
    stability: 0.38,
    similarity_boost: 0.88,
    style: 0.55,
    use_speaker_boost: true,
    speed: 0.96,
  };
}

function toElevenVoice(v: VoicesAPIItem): ElevenVoice {
  return {
    voice_id: String(v.voice_id),
    name: String(v.name ?? "Unknown"),
    category: v.category != null ? String(v.category) : undefined,
  };
}

export async function listVoices(): Promise<ElevenVoice[]> {
  const r: Response = await fetch("/api/eleven/voices");
  if (!r.ok) throw new Error(await safeText(r));

  const data: VoicesAPIResponse = (await r.json()) as VoicesAPIResponse;

  const rawVoices: unknown = data.voices;
  const arr: VoicesAPIItem[] = Array.isArray(rawVoices) ? (rawVoices as VoicesAPIItem[]) : [];
  return arr.map((v: VoicesAPIItem) => toElevenVoice(v));
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
    ...(params.voiceSettings ?? {}),
    ...(typeof params.speed === "number" ? { speed: params.speed } : {}),
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
  return (await r.json()) as { previews: VoiceDesignPreview[]; text: string };
}

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
  const data: Record<string, unknown> = (await r.json()) as Record<string, unknown>;

  return {
    voice_id: String(data.voice_id),
    name: String((data.name as unknown) ?? params.voiceName),
    category: data.category != null ? String(data.category) : undefined,
  };
}

async function safeText(r: Response): Promise<string> {
  const t: string = await r.text().catch((): string => "");
  return t || `${r.status} ${r.statusText}`;
}
