// src/App.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchLatestCustomerUtterance, type CustomerUtterance } from "./lib/customer";
import { listVoices, tts, type ElevenVoice, type TonePreset } from "./lib/eleven";
import { VoicePicker } from "./components/VoicePicker";
import { VoiceDesignPage } from "./pages/VoiceDesignPage";
import { VoiceClonePage } from "./pages/VoiceClonePage";

type Status = "idle" | "loading" | "ok" | "error";
type View = "console" | "voiceDesign" | "voiceClone";

const LS_PROFILE_KEY = "tonesift.listenProfile.v1";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

// eleven.ts presetSettings와 기본 speed 맞추기
const PRESET_BASE_SPEED: Record<TonePreset, number> = {
  neutral: 1.0,
  warm: 0.96,
};

function dotClass(status: Status) {
  if (status === "loading") return "ts-dot ts-dotLoad";
  if (status === "error") return "ts-dot ts-dotErr";
  if (status === "ok") return "ts-dot ts-dotOk";
  return "ts-dot";
}

function mergeStatus(...ss: Status[]): Status {
  if (ss.some((s) => s === "loading")) return "loading";
  if (ss.some((s) => s === "error")) return "error";
  if (ss.some((s) => s === "ok")) return "ok";
  return "idle";
}

export default function App() {
  const [view, setView] = useState<View>("console");

  const [voices, setVoices] = useState<ElevenVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");

  const [customer, setCustomer] = useState<CustomerUtterance>({
    text: "배송이 왜 이렇게 늦냐고요!! 지금 장난하시는 거예요?",
    ts: undefined,
    id: undefined,
  });

  const [agentText, setAgentText] = useState("기다리게 해서 정말 죄송합니다. 바로 확인하겠습니다.");

  const [neutralAudio, setNeutralAudio] = useState<string>("");
  const [warmAudio, setWarmAudio] = useState<string>("");

  // ✅ 상태를 카드별로 분리 + 상단 상태는 합성
  const [neutralStatus, setNeutralStatus] = useState<Status>("idle");
  const [warmStatus, setWarmStatus] = useState<Status>("idle");
  const [voiceLabStatus, setVoiceLabStatus] = useState<Status>("idle");

  const [neutralError, setNeutralError] = useState<string>("");
  const [warmError, setWarmError] = useState<string>("");
  const [voiceLabError, setVoiceLabError] = useState<string>("");

  const status = useMemo(
    () => mergeStatus(neutralStatus, warmStatus, voiceLabStatus),
    [neutralStatus, warmStatus, voiceLabStatus]
  );

  const errorMsg = useMemo(() => {
    return neutralError || warmError || voiceLabError || "";
  }, [neutralError, warmError, voiceLabError]);

  const [pulling, setPulling] = useState(false);
  const [autoPull, setAutoPull] = useState(false);
  const [autoNeutral, setAutoNeutral] = useState(false);

  // 상담원 청취 프로필
  const [listenPace, setListenPace] = useState(1.0);
  const [listenPitch, setListenPitch] = useState(1.0);

  const neutralAudioRef = useRef<HTMLAudioElement | null>(null);
  const warmAudioRef = useRef<HTMLAudioElement | null>(null);

  const debounceRef = useRef<number | null>(null);
  const lastNeutralTextRef = useRef<string>("");
  const neutralReqIdRef = useRef(0);
  const warmReqIdRef = useRef(0);

  async function reloadVoices() {
    const v = await listVoices();
    setVoices(v);
    if (!voiceId && v[0]?.voice_id) setVoiceId(v[0].voice_id);
    return v;
  }

  // localStorage 로드
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PROFILE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { pace?: number; pitch?: number };
      if (typeof data.pace === "number") setListenPace(clamp(data.pace, 0.85, 1.15));
      if (typeof data.pitch === "number") setListenPitch(clamp(data.pitch, 0.85, 1.15));
    } catch {
      // ignore
    }
  }, []);

  // localStorage 저장
  useEffect(() => {
    try {
      localStorage.setItem(LS_PROFILE_KEY, JSON.stringify({ pace: listenPace, pitch: listenPitch }));
    } catch {
      // ignore
    }
  }, [listenPace, listenPitch]);

  // 재생 단계 pitch 반영
  useEffect(() => {
    const p = clamp(listenPitch, 0.85, 1.15);
    if (neutralAudioRef.current) neutralAudioRef.current.playbackRate = p;
    if (warmAudioRef.current) warmAudioRef.current.playbackRate = p;
  }, [listenPitch, neutralAudio, warmAudio]);

  useEffect(() => {
    return () => {
      if (neutralAudio) URL.revokeObjectURL(neutralAudio);
      if (warmAudio) URL.revokeObjectURL(warmAudio);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await reloadVoices();
      } catch (e) {
        setVoiceLabStatus("error");
        setVoiceLabError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoPull) return;

    const ac = new AbortController();
    const tick = async () => {
      try {
        const data = await fetchLatestCustomerUtterance(ac.signal);
        setCustomer(data);
      } catch {
        // ignore
      }
    };

    tick();
    const t = window.setInterval(tick, 3000);
    return () => {
      window.clearInterval(t);
      ac.abort();
    };
  }, [autoPull]);

  async function pullCustomerText() {
    setPulling(true);
    setNeutralError("");
    try {
      const data = await fetchLatestCustomerUtterance();
      setCustomer(data);
    } catch (e) {
      setNeutralError(String(e));
      setNeutralStatus("error");
    } finally {
      setPulling(false);
    }
  }

  // pace/pitch 분리 보정
  function ttsSpeedFor(preset: TonePreset) {
    const base = PRESET_BASE_SPEED[preset] ?? 1.0;
    const pace = clamp(listenPace, 0.85, 1.15);
    const pitch = clamp(listenPitch, 0.85, 1.15);
    const speed = base * (pace / pitch);
    return clamp(speed, 0.7, 1.2);
  }

  async function generateNeutral(source: "manual" | "auto") {
    const text = (customer.text ?? "").trim();
    if (!voiceId || !text) return;

    if (source === "auto" && neutralStatus === "loading") return;

    const reqId = ++neutralReqIdRef.current;
    setNeutralStatus("loading");
    setNeutralError("");

    try {
      if (neutralAudio) URL.revokeObjectURL(neutralAudio);

      const { url } = await tts({
        text,
        voiceId,
        preset: "neutral",
        speed: ttsSpeedFor("neutral"),
      });

      if (reqId !== neutralReqIdRef.current) {
        URL.revokeObjectURL(url);
        return;
      }

      setNeutralAudio(url);
      setNeutralStatus("ok");
      lastNeutralTextRef.current = text;

      const p = clamp(listenPitch, 0.85, 1.15);
      window.setTimeout(() => {
        if (neutralAudioRef.current) neutralAudioRef.current.playbackRate = p;
        neutralAudioRef.current?.play().catch(() => {});
      }, 80);
    } catch (e) {
      if (reqId !== neutralReqIdRef.current) return;
      setNeutralStatus("error");
      setNeutralError(String(e));
    }
  }

  async function generateWarm() {
    const text = (agentText ?? "").trim();
    if (!voiceId || !text) return;

    const reqId = ++warmReqIdRef.current;
    setWarmStatus("loading");
    setWarmError("");

    try {
      if (warmAudio) URL.revokeObjectURL(warmAudio);

      const { url } = await tts({
        text,
        voiceId,
        preset: "warm",
        speed: ttsSpeedFor("warm"),
      });

      if (reqId !== warmReqIdRef.current) {
        URL.revokeObjectURL(url);
        return;
      }

      setWarmAudio(url);
      setWarmStatus("ok");

      const p = clamp(listenPitch, 0.85, 1.15);
      window.setTimeout(() => {
        if (warmAudioRef.current) warmAudioRef.current.playbackRate = p;
        warmAudioRef.current?.play().catch(() => {});
      }, 80);
    } catch (e) {
      if (reqId !== warmReqIdRef.current) return;
      setWarmStatus("error");
      setWarmError(String(e));
    }
  }

  useEffect(() => {
    if (!autoNeutral) return;

    const text = (customer.text ?? "").trim();
    if (!voiceId || !text || text.length < 2) return;

    if (text === lastNeutralTextRef.current) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      generateNeutral("auto");
    }, 650);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.text, voiceId, autoNeutral]);

  return (
    <div className="min-h-screen">
      <header className="mx-auto w-full max-w-6xl px-5 pt-6">
        <div className="ts-cardHero px-5 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div
                className="h-11 w-11 rounded-2xl"
                style={{
                  background:
                    "radial-gradient(16px 16px at 30% 30%, rgba(255,122,144,.95), rgba(255,77,109,.22)), linear-gradient(180deg, rgba(255,77,109,.18), rgba(255,255,255,.03))",
                  border: "1px solid rgba(255,77,109,.35)",
                  boxShadow: "0 0 0 3px rgba(255,77,109,.10)",
                }}
              />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-lg font-semibold tracking-tight">ToneShift</div>
                  <span className="ts-pill ts-pillStrong">상담원용 콘솔</span>
                  <span className="ts-pill">
                    <span className={dotClass(status)} /> <span className="ml-2">{status === "loading" ? "generating" : status}</span>
                  </span>
                </div>

                <div className="mt-2 ts-tabs">
                  <button
                    type="button"
                    className={`ts-tab ${view === "console" ? "ts-tabActive" : ""}`}
                    onClick={() => setView("console")}
                  >
                    🧩 Console
                  </button>
                  <button
                    type="button"
                    className={`ts-tab ${view === "voiceDesign" ? "ts-tabActive" : ""}`}
                    onClick={() => setView("voiceDesign")}
                  >
                    🎛️ 목소리만들기
                  </button>
                  <button
                    type="button"
                    className={`ts-tab ${view === "voiceClone" ? "ts-tabActive" : ""}`}
                    onClick={() => setView("voiceClone")}
                  >
                    🧬 내목소리 클로닝
                  </button>
                </div>

                <div className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  고객의 말은 그대로, 톤만 바꾼다 <span className="ts-kbd ml-2">MVP</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div style={{ width: 380, maxWidth: "100%" }}>
                <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} placeholder="Voice 선택" />
              </div>

              <button
                className="ts-btn ts-btn-ghost"
                onClick={() => {
                  setListenPace(1.0);
                  setListenPitch(1.0);
                }}
                title="청취 프로필 초기화"
              >
                ↩️ Reset
              </button>
            </div>
          </div>

          <div className="ts-divider" />

          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-1">
              <div className="ts-pill inline-flex items-center gap-2">🎧 청취 프로필</div>
              <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                Pace=체감 속도, Pitch=체감 높낮이 (저장됨)
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="ts-pill">
                  TTS speed: {ttsSpeedFor("neutral").toFixed(2)} / {ttsSpeedFor("warm").toFixed(2)}
                </span>
                <span className="ts-pill">playbackRate: {clamp(listenPitch, 0.85, 1.15).toFixed(2)}</span>
              </div>
            </div>

            <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
              <RangeRow label="Pace (말 빠르기)" value={listenPace} min={0.85} max={1.15} step={0.01} onChange={setListenPace} />
              <RangeRow label="Pitch (높낮이)" value={listenPitch} min={0.85} max={1.15} step={0.01} onChange={setListenPitch} />
            </div>
          </div>

          {status === "error" && errorMsg ? (
            <div
              className="mt-4 rounded-2xl border px-4 py-3 text-sm"
              style={{
                borderColor: "rgba(255,77,109,.35)",
                background: "rgba(255,77,109,.08)",
                color: "rgba(244,245,248,.9)",
              }}
            >
              <div className="font-semibold" style={{ color: "var(--accent2)" }}>
                오류
              </div>
              <div className="mt-1" style={{ color: "var(--muted)" }}>
                {errorMsg}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-12 pt-6">
        {view === "voiceDesign" ? (
          <VoiceDesignPage
            voices={voices}
            voiceId={voiceId}
            onVoiceChange={setVoiceId}
            onReloadVoices={reloadVoices}
            playbackRate={clamp(listenPitch, 0.85, 1.15)}
            setVoiceLabStatus={setVoiceLabStatus}
            setVoiceLabError={setVoiceLabError}
          />
        ) : view === "voiceClone" ? (
          <VoiceClonePage
            voices={voices}
            voiceId={voiceId}
            onVoiceChange={setVoiceId}
            onReloadVoices={reloadVoices}
            setVoiceLabStatus={setVoiceLabStatus}
            setVoiceLabError={setVoiceLabError}
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="ts-card p-5">
              <div className="ts-h">
                <div>
                  <div className="ts-hTitle">😡 고객 텍스트 → 🧊 중화 톤</div>
                  <div className="ts-hSub">텍스트가 바뀌면 자동 갱신 (0.65s)</div>
                </div>
                <span className="ts-pill">Preset: Neutral</span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button className="ts-btn" onClick={pullCustomerText} disabled={pulling}>
                    {pulling ? <span className="ts-spinner" /> : "⬇️"} 더미 불러오기
                  </button>

                  <Switch checked={autoPull} onChange={setAutoPull} label="3초 자동 갱신" />
                  <Switch checked={autoNeutral} onChange={setAutoNeutral} label="텍스트 변경 시 자동 음성" />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {customer.id ? <span className="ts-pill">id: {customer.id}</span> : null}
                  {customer.ts ? <span className="ts-pill">ts: {customer.ts}</span> : null}
                </div>
              </div>

              <div className="mt-4">
                <textarea className="ts-input ts-textarea" value={customer.text} onChange={(e) => setCustomer((p) => ({ ...p, text: e.target.value }))} />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className="ts-btn ts-btn-accent" onClick={() => generateNeutral("manual")} disabled={neutralStatus === "loading"}>
                  {neutralStatus === "loading" ? <span className="ts-spinner" /> : "🧊"} 중화 음성 생성
                </button>
              </div>

              <div className="mt-3">
                {neutralStatus === "error" && neutralError ? (
                  <div className="ts-pill" style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}>
                    {neutralError}
                  </div>
                ) : null}
              </div>

              <div className="mt-4">
                {neutralAudio ? (
                  <div className="ts-audioBox">
                    <div className="ts-audioTop">
                      <div className="ts-audioTitle">Output: Neutral</div>
                      <span className="ts-pill">Pitch 적용됨</span>
                    </div>
                    <audio ref={neutralAudioRef} controls src={neutralAudio} className="w-full" />
                  </div>
                ) : (
                  <div className="ts-pill">아직 생성된 음성이 없어요.</div>
                )}
              </div>
            </section>

            <section className="ts-card p-5">
              <div className="ts-h">
                <div>
                  <div className="ts-hTitle">🧑‍💼 상담사 문장 → 🫂 공감 톤</div>
                  <div className="ts-hSub">같은 문장, 더 따뜻하게</div>
                </div>
                <span className="ts-pill">Preset: Warm</span>
              </div>

              <div className="mt-4">
                <textarea className="ts-input ts-textarea" value={agentText} onChange={(e) => setAgentText(e.target.value)} />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className="ts-btn ts-btn-accent" onClick={generateWarm} disabled={warmStatus === "loading"}>
                  {warmStatus === "loading" ? <span className="ts-spinner" /> : "🫂"} 공감 음성 생성
                </button>
              </div>

              <div className="mt-3">
                {warmStatus === "error" && warmError ? (
                  <div className="ts-pill" style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}>
                    {warmError}
                  </div>
                ) : null}
              </div>

              <div className="mt-4">
                {warmAudio ? (
                  <div className="ts-audioBox">
                    <div className="ts-audioTop">
                      <div className="ts-audioTitle">Output: Warm</div>
                      <span className="ts-pill">Pitch 적용됨</span>
                    </div>
                    <audio ref={warmAudioRef} controls src={warmAudio} className="w-full" />
                  </div>
                ) : (
                  <div className="ts-pill">아직 생성된 음성이 없어요.</div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { checked, onChange, label } = props;
  return (
    <label className="ts-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ts-switchTrack">
        <span className="ts-switchThumb" />
      </span>
      <span className="ts-switchText">{label}</span>
    </label>
  );
}

function RangeRow(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const { label, value, min, max, step, onChange } = props;

  return (
    <div className="ts-rangeWrap">
      <div className="ts-rangeTop">
        <div className="ts-rangeLabel">{label}</div>
        <span className="ts-pill ts-rangeValue">{value.toFixed(2)}</span>
      </div>
      <input className="ts-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
