// src/pages/VoiceDesignPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { VoicePicker } from "../components/VoicePicker";
import {
  createVoiceDesignPreviews,
  createVoiceFromDesign,
  tts,
  type ElevenVoice,
  type ElevenVoiceSettings,
  type VoiceDesignPreview,
} from "../lib/eleven";

type Status = "idle" | "loading" | "ok" | "error";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function base64ToObjectUrl(b64: string, mediaType: string) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mediaType || "audio/mpeg" });
  return URL.createObjectURL(blob);
}

function ensureMinChars(input: string, min: number) {
  const base = input ?? "";
  if (base.length >= min) return base;

  const padChunk =
    " 추가로 불편하신 점을 자세히 말씀해 주시면 더 정확히 확인해 빠르게 도와드리겠습니다. 담당 부서에 즉시 전달해 진행 상황도 함께 안내드릴게요.";
  let out = base.trim().length ? base : "안녕하세요. 문의 주셔서 감사합니다.";
  while (out.length < min) out += padChunk;
  return out;
}

type PreviewItem = {
  generated_voice_id: string;
  media_type: string;
  duration_secs?: number;
  language?: string;
  url: string;
};

const MIN_PREVIEW_TEXT_LEN = 100;
const MIN_DESC_LEN = 10;

export function VoiceDesignPage(props: {
  voices: ElevenVoice[];
  voiceId: string;
  onVoiceChange: (id: string) => void;
  onReloadVoices: () => Promise<ElevenVoice[]>;
  playbackRate: number;
  setVoiceLabStatus: (s: Status) => void;
  setVoiceLabError: (m: string) => void;
}) {
  const { voices, voiceId, onVoiceChange, onReloadVoices, playbackRate, setVoiceLabStatus, setVoiceLabError } = props;

  // ===== Voice Tuning (existing voices) =====
  const [tuneText, setTuneText] = useState("안녕하세요. 톤과 발화 스타일을 튜닝 중입니다.");
  const [tuneAudio, setTuneAudio] = useState("");
  const tuneAudioRef = useRef<HTMLAudioElement | null>(null);

  const [tuneStatus, setTuneStatus] = useState<Status>("idle");
  const [tuneError, setTuneError] = useState("");

  const [tuneSettings, setTuneSettings] = useState<ElevenVoiceSettings>({
    stability: 0.6,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
    speed: 1.0,
  });

  const selected = useMemo(() => voices.find((v) => v.voice_id === voiceId), [voices, voiceId]);

  useEffect(() => {
    if (!tuneAudioRef.current) return;
    tuneAudioRef.current.playbackRate = playbackRate;
  }, [playbackRate, tuneAudio]);

  useEffect(() => {
    return () => {
      if (tuneAudio) URL.revokeObjectURL(tuneAudio);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function genTuningPreview() {
    const text = tuneText.trim();
    if (!voiceId || !text) return;

    setTuneStatus("loading");
    setTuneError("");
    setVoiceLabStatus("loading");
    setVoiceLabError("");

    try {
      if (tuneAudio) URL.revokeObjectURL(tuneAudio);

      const { url } = await tts({
        text,
        voiceId,
        preset: "neutral",
        voiceSettings: {
          stability: clamp(tuneSettings.stability, 0, 1),
          similarity_boost: clamp(tuneSettings.similarity_boost, 0, 1),
          style: clamp(tuneSettings.style ?? 0, 0, 1),
          use_speaker_boost: !!tuneSettings.use_speaker_boost,
          speed: clamp(tuneSettings.speed ?? 1, 0.7, 1.2),
        },
      });

      setTuneAudio(url);
      setTuneStatus("ok");
      setVoiceLabStatus("ok");

      window.setTimeout(() => {
        if (tuneAudioRef.current) tuneAudioRef.current.playbackRate = playbackRate;
        tuneAudioRef.current?.play().catch(() => {});
      }, 80);
    } catch (e) {
      setTuneStatus("error");
      setTuneError(String(e));
      setVoiceLabStatus("error");
      setVoiceLabError(String(e));
    }
  }

  // ===== Voice Design (prompt -> previews -> create) =====
  const [desc, setDesc] = useState("부드럽고 차분한 톤, 또렷한 발음, 과장되지 않은 감정 표현");

  const [previewText, setPreviewText] = useState(
    "안녕하세요. 문의 주셔서 감사합니다. 지금 상황을 빠르게 확인하고, 가능한 해결 방법을 정리해 단계별로 안내드리겠습니다. 불편을 드려 진심으로 죄송합니다. 추가로 필요한 정보가 있으면 바로 요청드릴게요."
  );

  const [autoGenText, setAutoGenText] = useState(false);

  const [quality, setQuality] = useState(0.9);
  const [loudness, setLoudness] = useState(0.5);
  const [guidanceScale, setGuidanceScale] = useState(5);
  const [seed, setSeed] = useState<string>("");

  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [pickedId, setPickedId] = useState<string>("");

  const [designStatus, setDesignStatus] = useState<Status>("idle");
  const [designError, setDesignError] = useState("");

  const [newVoiceName, setNewVoiceName] = useState("My ToneShift Voice");
  const [newVoiceDesc, setNewVoiceDesc] = useState("ToneShift에서 생성한 보이스");

  const descLenTrim = (desc ?? "").trim().length;
  const previewLenTrim = (previewText ?? "").trim().length;

  const isDescTooShort = descLenTrim > 0 && descLenTrim < MIN_DESC_LEN;
  const isPreviewTooShort = !autoGenText && previewLenTrim > 0 && previewLenTrim < MIN_PREVIEW_TEXT_LEN;

  function clearPreviews() {
    setPreviews((prev: PreviewItem[]) => {
      prev.forEach((x: PreviewItem) => URL.revokeObjectURL(x.url));
      return [];
    });
    setPickedId("");
  }

  useEffect(() => {
    return () => {
      clearPreviews();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generatePreviews() {
    const voiceDescription = desc.trim();
    const t = previewText.trim();

    if (voiceDescription.length < MIN_DESC_LEN) {
      const msg = `voice_description은 최소 ${MIN_DESC_LEN}자 필요합니다. (현재 ${voiceDescription.length}자)`;
      setDesignStatus("error");
      setDesignError(msg);
      setVoiceLabStatus("error");
      setVoiceLabError(msg);
      return;
    }

    if (!autoGenText) {
      if (!t) {
        setDesignStatus("error");
        setDesignError("preview text가 비어있어요.");
        setVoiceLabStatus("error");
        setVoiceLabError("preview text가 비어있어요.");
        return;
      }
      if (t.length < MIN_PREVIEW_TEXT_LEN) {
        const msg = `preview text는 최소 ${MIN_PREVIEW_TEXT_LEN}자 필요합니다. (현재 ${t.length}자)`;
        setDesignStatus("error");
        setDesignError(msg);
        setVoiceLabStatus("error");
        setVoiceLabError(msg);
        return;
      }
    }

    setDesignStatus("loading");
    setDesignError("");
    setVoiceLabStatus("loading");
    setVoiceLabError("");

    try {
      clearPreviews();

      const out = await createVoiceDesignPreviews({
        voiceDescription,
        text: autoGenText ? undefined : t,
        autoGenerateText: autoGenText,
        quality,
        loudness,
        guidanceScale,
        seed: seed.trim() ? Number(seed) : undefined,
        outputFormat: "mp3_44100_192",
      });

      // ✅ 여기서 p 타입 명시
      const items: PreviewItem[] = (out.previews ?? []).map((p: VoiceDesignPreview): PreviewItem => {
        const url = base64ToObjectUrl(p.audio_base_64, p.media_type);
        return {
          generated_voice_id: p.generated_voice_id,
          media_type: p.media_type,
          duration_secs: p.duration_secs,
          language: p.language,
          url,
        };
      });

      setPreviews(items);
      setPickedId(items[0]?.generated_voice_id ?? "");
      setDesignStatus("ok");
      setVoiceLabStatus("ok");

      if (out.text && autoGenText) setPreviewText(out.text);
    } catch (e) {
      setDesignStatus("error");
      setDesignError(String(e));
      setVoiceLabStatus("error");
      setVoiceLabError(String(e));
    }
  }

  async function createVoice() {
    const picked = pickedId.trim();
    if (!picked) return;

    const name = newVoiceName.trim();
    const description = newVoiceDesc.trim();

    if (!name) {
      setDesignStatus("error");
      setDesignError("voice name이 필요해요.");
      setVoiceLabStatus("error");
      setVoiceLabError("voice name이 필요해요.");
      return;
    }
    if (!description) {
      setDesignStatus("error");
      setDesignError("voice description이 필요해요.");
      setVoiceLabStatus("error");
      setVoiceLabError("voice description이 필요해요.");
      return;
    }

    setDesignStatus("loading");
    setDesignError("");
    setVoiceLabStatus("loading");
    setVoiceLabError("");

    try {
      const created = await createVoiceFromDesign({
        voiceName: name,
        voiceDescription: description,
        generatedVoiceId: picked,
      });

      await onReloadVoices();
      onVoiceChange(created.voice_id);

      setDesignStatus("ok");
      setVoiceLabStatus("ok");
    } catch (e) {
      setDesignStatus("error");
      setDesignError(String(e));
      setVoiceLabStatus("error");
      setVoiceLabError(String(e));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Voice Tuning */}
      <section className="ts-card p-5">
        <div className="ts-h">
          <div>
            <div className="ts-hTitle">🎛️ Voice Tuning</div>
            <div className="ts-hSub">선택한 Voice settings를 조절하고 바로 미리듣기</div>
          </div>
          <span className="ts-pill">{selected ? `selected: ${selected.name}` : "no voice"}</span>
        </div>

        <div className="mt-4">
          <div style={{ width: 420, maxWidth: "100%" }}>
            <VoicePicker voices={voices} value={voiceId} onChange={onVoiceChange} placeholder="Voice 선택" />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <RangeRow label="stability" value={tuneSettings.stability} min={0} max={1} step={0.01} onChange={(v) => setTuneSettings((prev) => ({ ...prev, stability: v }))} />
          <RangeRow
            label="similarity_boost"
            value={tuneSettings.similarity_boost}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setTuneSettings((prev) => ({ ...prev, similarity_boost: v }))}
          />
          <RangeRow label="style" value={tuneSettings.style ?? 0} min={0} max={1} step={0.01} onChange={(v) => setTuneSettings((prev) => ({ ...prev, style: v }))} />
          <RangeRow label="speed" value={tuneSettings.speed ?? 1} min={0.7} max={1.2} step={0.01} onChange={(v) => setTuneSettings((prev) => ({ ...prev, speed: v }))} />
        </div>

        <div className="mt-3">
          <label className="ts-switch">
            <input
              type="checkbox"
              checked={!!tuneSettings.use_speaker_boost}
              onChange={(e) => setTuneSettings((prev) => ({ ...prev, use_speaker_boost: e.target.checked }))}
            />
            <span className="ts-switchTrack">
              <span className="ts-switchThumb" />
            </span>
            <span className="ts-switchText">use_speaker_boost</span>
          </label>
        </div>

        <div className="mt-4">
          <textarea className="ts-input ts-textarea" value={tuneText} onChange={(e) => setTuneText(e.target.value)} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="ts-btn ts-btn-accent" onClick={genTuningPreview} disabled={tuneStatus === "loading"}>
            {tuneStatus === "loading" ? <span className="ts-spinner" /> : "🔊"} 미리듣기 생성
          </button>
          <button
            className="ts-btn ts-btn-ghost"
            onClick={() =>
              setTuneSettings({
                stability: 0.6,
                similarity_boost: 0.75,
                style: 0.0,
                use_speaker_boost: true,
                speed: 1.0,
              })
            }
          >
            ↩️ Reset
          </button>
          <span className="ts-pill">playbackRate: {playbackRate.toFixed(2)}</span>
        </div>

        {tuneStatus === "error" && tuneError ? (
          <div className="mt-3 ts-pill" style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}>
            {tuneError}
          </div>
        ) : null}

        <div className="mt-4">
          {tuneAudio ? (
            <div className="ts-audioBox">
              <div className="ts-audioTop">
                <div className="ts-audioTitle">Preview Output</div>
                <span className="ts-pill">Pitch(재생) 적용</span>
              </div>
              <audio ref={tuneAudioRef} controls src={tuneAudio} className="w-full" />
            </div>
          ) : (
            <div className="ts-pill">아직 미리듣기 오디오가 없어요.</div>
          )}
        </div>
      </section>

      {/* Voice Design */}
      <section className="ts-card p-5">
        <div className="ts-h">
          <div>
            <div className="ts-hTitle">🧪 Voice Design</div>
            <div className="ts-hSub">프롬프트로 프리뷰 생성 → 선택 프리뷰를 내 Voice로 저장</div>
          </div>
          <span className="ts-pill">
            desc ≥ {MIN_DESC_LEN}자 / text ≥ {MIN_PREVIEW_TEXT_LEN}자
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="ts-pill inline-flex items-center gap-2">🧠 voice_description</div>
              <span
                className="ts-pill"
                style={isDescTooShort ? { borderColor: "rgba(255,77,109,.45)", color: "rgba(255,122,144,.95)" } : undefined}
                title="desc.trim().length"
              >
                desc length: {descLenTrim}/{MIN_DESC_LEN}
              </span>
            </div>

            <textarea className="ts-input ts-textarea" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="ts-switch">
              <input type="checkbox" checked={autoGenText} onChange={(e) => setAutoGenText(e.target.checked)} />
              <span className="ts-switchTrack">
                <span className="ts-switchThumb" />
              </span>
              <span className="ts-switchText">auto_generate_text</span>
            </label>

            <span
              className="ts-pill"
              style={isPreviewTooShort ? { borderColor: "rgba(255,77,109,.45)", color: "rgba(255,122,144,.95)" } : undefined}
              title="previewText.trim().length"
            >
              text length: {previewLenTrim}/{MIN_PREVIEW_TEXT_LEN}
              {autoGenText ? " (auto)" : ""}
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="ts-pill inline-flex items-center gap-2">📝 text (preview)</div>
              <button
                type="button"
                className="ts-btn ts-btn-ghost"
                disabled={autoGenText || previewLenTrim >= MIN_PREVIEW_TEXT_LEN}
                onClick={() => setPreviewText((prev) => ensureMinChars((prev ?? "").trim(), MIN_PREVIEW_TEXT_LEN))}
                title="현재 텍스트 뒤에 자연스럽게 문장을 덧붙여 최소 100자를 맞춥니다."
              >
                ✍️ 100자 자동채우기
              </button>
            </div>

            <textarea
              className="ts-input ts-textarea"
              value={previewText}
              disabled={autoGenText}
              onChange={(e) => setPreviewText(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <RangeRow label="quality (-1~1)" value={quality} min={-1} max={1} step={0.01} onChange={setQuality} />
            <RangeRow label="loudness (-1~1)" value={loudness} min={-1} max={1} step={0.01} onChange={setLoudness} />
            <RangeRow label="guidance_scale (0~100)" value={guidanceScale} min={0} max={100} step={1} onChange={setGuidanceScale} />

            <div className="ts-rangeWrap">
              <div className="ts-rangeTop">
                <div className="ts-rangeLabel">seed (optional)</div>
                <span className="ts-pill ts-rangeValue">{seed ? seed : "-"}</span>
              </div>
              <input className="ts-input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="예: 1234" />
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              className="ts-btn ts-btn-accent"
              onClick={generatePreviews}
              disabled={designStatus === "loading" || isDescTooShort || (!autoGenText && isPreviewTooShort)}
            >
              {designStatus === "loading" ? <span className="ts-spinner" /> : "✨"} 프리뷰 생성
            </button>
            <button className="ts-btn ts-btn-ghost" onClick={clearPreviews}>
              🧹 Clear
            </button>

            {isDescTooShort ? (
              <span className="ts-pill" style={{ borderColor: "rgba(255,77,109,.45)", color: "rgba(255,122,144,.95)" }}>
                desc {MIN_DESC_LEN}자 이상 필요
              </span>
            ) : null}

            {!autoGenText && isPreviewTooShort ? (
              <span className="ts-pill" style={{ borderColor: "rgba(255,77,109,.45)", color: "rgba(255,122,144,.95)" }}>
                text {MIN_PREVIEW_TEXT_LEN}자 이상 필요
              </span>
            ) : null}
          </div>

          {designStatus === "error" && designError ? (
            <div className="ts-pill" style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}>
              {designError}
            </div>
          ) : null}

          <div className="mt-2">
            {previews.length ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {previews.map((p: PreviewItem) => {
                  const picked = p.generated_voice_id === pickedId;
                  return (
                    <button
                      key={p.generated_voice_id}
                      type="button"
                      className={`ts-previewCard ${picked ? "ts-previewCardActive" : ""}`}
                      onClick={() => setPickedId(p.generated_voice_id)}
                    >
                      <div className="ts-previewMeta">
                        <div className="ts-previewId">{p.generated_voice_id.slice(0, 8)}…</div>
                        <div className="ts-previewSmall">{p.language ?? "-"}</div>
                      </div>
                      <audio controls src={p.url} className="w-full" />
                      <div className="ts-previewMeta">
                        <span className="ts-pill">{picked ? "selected" : "pick"}</span>
                        <span className="ts-pill">{(p.duration_secs ?? 0).toFixed(1)}s</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="ts-pill">아직 프리뷰가 없어요.</div>
            )}
          </div>

          <div className="ts-divider" />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="ts-pill inline-flex items-center gap-2">🏷️ voice_name</div>
              <input className="ts-input" value={newVoiceName} onChange={(e) => setNewVoiceName(e.target.value)} />
            </div>
            <div>
              <div className="ts-pill inline-flex items-center gap-2">🧾 voice_description</div>
              <input className="ts-input" value={newVoiceDesc} onChange={(e) => setNewVoiceDesc(e.target.value)} />
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button className="ts-btn ts-btn-accent" onClick={createVoice} disabled={!pickedId || designStatus === "loading"}>
              {designStatus === "loading" ? <span className="ts-spinner" /> : "📦"} 선택 프리뷰로 Voice 저장
            </button>
            <span className="ts-pill">picked: {pickedId ? `${pickedId.slice(0, 12)}…` : "-"}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function RangeRow(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const { label, value, min, max, step, onChange } = props;

  return (
    <div className="ts-rangeWrap">
      <div className="ts-rangeTop">
        <div className="ts-rangeLabel">{label}</div>
        <span className="ts-pill ts-rangeValue">{Number.isFinite(value) ? value.toFixed(2) : "-"}</span>
      </div>
      <input className="ts-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
