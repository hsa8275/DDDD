// src/App.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchLatestCustomerUtterance, type CustomerUtterance } from "./lib/customer";
import { listVoices, tts, type ElevenVoice, type TonePreset } from "./lib/eleven";
import { VoicePicker } from "./components/VoicePicker";
import { VoiceDesignPage } from "./pages/VoiceDesignPage";
import { VoiceClonePage } from "./pages/VoiceClonePage";
import { ScribeMicTranscriber } from "./components/ScribeMicTranscriber";

type Status = "idle" | "loading" | "ok" | "error";
type View = "console" | "voiceDesign" | "voiceClone" | "product";

const LS_PROFILE_KEY: string = "tonesift.listenProfile.v1";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const PRESET_BASE_SPEED: Record<TonePreset, number> = {
  neutral: 1.0,
  warm: 0.96,
};

function dotClass(status: Status): string {
  if (status === "loading") return "ts-dot ts-dotLoad";
  if (status === "error") return "ts-dot ts-dotErr";
  if (status === "ok") return "ts-dot ts-dotOk";
  return "ts-dot";
}

function mergeStatus(...ss: Status[]): Status {
  if (ss.some((s: Status) => s === "loading")) return "loading";
  if (ss.some((s: Status) => s === "error")) return "error";
  if (ss.some((s: Status) => s === "ok")) return "ok";
  return "idle";
}

type LoopState = {
  isRunning: boolean;
  loopId: number;
  abort?: AbortController;
};

type TransformParsed = {
  transformed_message: string;
  original_message?: string;
  emotion?: string;
  confidenceRaw?: string;
  confidenceValue?: number; // 0~100
};

type EmotionCanon = "공포" | "놀람" | "분노" | "슬픔" | "중립" | "행복" | "혐오";

type EmotionTheme = {
  canon: EmotionCanon;
  emoji: string;
  label: string;
  cardStyle: React.CSSProperties;
  pillStyle: React.CSSProperties;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function safeText(r: Response): Promise<string> {
  const t: string = await r.text().catch((): string => "");
  return t || `${r.status} ${r.statusText}`;
}

function readString(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function parseConfidence(raw: unknown): { raw?: string; value?: number } {
  if (typeof raw === "number") {
    const v: number = raw <= 1 ? raw * 100 : raw;
    const vv: number = clamp(v, 0, 100);
    return { raw: `${vv.toFixed(1)}%`, value: vv };
  }

  const s: string = typeof raw === "string" ? raw.trim() : "";
  if (!s) return {};

  const numStr: string = s.endsWith("%") ? s.slice(0, -1).trim() : s;
  const n: number = Number(numStr);
  if (!Number.isFinite(n)) return { raw: s };

  const vv: number = clamp(n, 0, 100);
  return { raw: s.endsWith("%") ? s : `${vv.toFixed(1)}%`, value: vv };
}

function parseTransformResponse(u: unknown): TransformParsed {
  const root: unknown =
    isRecord(u) && isRecord(u.data) ? u.data : isRecord(u) && isRecord(u.result) ? u.result : u;

  if (!isRecord(root)) return { transformed_message: "" };

  const transformed_message: string =
    readString(root.transformed_message, "").trim() ||
    readString(root.transformedMessage, "").trim() ||
    readString(root.transformed, "").trim();

  const original_message: string | undefined =
    readString(root.original_message, "").trim() ||
    readString(root.originalMessage, "").trim() ||
    undefined;

  const emotion: string | undefined =
    typeof root.emotion === "string"
      ? root.emotion.trim()
      : typeof root.sentiment === "string"
      ? root.sentiment.trim()
      : undefined;

  const conf = parseConfidence(
    (root as Record<string, unknown>).confidence ?? (root as Record<string, unknown>).confidence_score
  );

  return {
    transformed_message,
    original_message,
    emotion,
    confidenceRaw: conf.raw,
    confidenceValue: typeof conf.value === "number" ? conf.value : undefined,
  };
}

async function getRandomSwear(signal: AbortSignal): Promise<string> {
  const r: Response = await fetch("/api/ai/swear", { method: "GET", signal });
  if (!r.ok) throw new Error(await safeText(r));

  const data: unknown = await r.json().catch((): unknown => null);
  if (!isRecord(data)) throw new Error("Invalid swear response");

  const swear: unknown = data.swear;
  if (typeof swear !== "string" || !swear.trim()) throw new Error("Missing swear");
  return swear.trim();
}

async function transformWithMeta(message: string, signal: AbortSignal): Promise<TransformParsed> {
  const r: Response = await fetch("/api/ai/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, original_message: message }),
    signal,
  });

  if (!r.ok) throw new Error(await safeText(r));

  const data: unknown = await r.json().catch((): unknown => null);
  const parsed: TransformParsed = parseTransformResponse(data);

  if (!parsed.transformed_message || !parsed.transformed_message.trim()) {
    throw new Error("AI transform returned empty transformed_message");
  }

  return parsed;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const id: ReturnType<typeof setTimeout> = setTimeout(() => resolve(), ms);
    const onAbort = (): void => {
      clearTimeout(id);
      reject(new Error("aborted"));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function stopAudio(a: HTMLAudioElement): void {
  try {
    a.pause();
  } catch {
    // ignore
  }
  try {
    a.currentTime = 0;
  } catch {
    // ignore
  }
  try {
    a.removeAttribute("src");
    a.load();
  } catch {
    // ignore
  }
}

async function playOnce(a: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onEnded = (): void => cleanup(() => resolve());
    const onError = (): void => cleanup(() => reject(new Error("audio error")));
    const onAbort = (): void => {
      stopAudio(a);
      cleanup(() => resolve());
    };

    const cleanup = (cb: () => void): void => {
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      cb();
    };

    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });

    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);

    void a.play().catch((e: unknown) => cleanup(() => reject(new Error(String(e)))));
  });
}

function stopLoop(loop: LoopState): void {
  loop.isRunning = false;
  loop.loopId += 1;
  if (loop.abort) loop.abort.abort();
}

function normalizeEmotion(e: string): EmotionCanon {
  const s: string = String(e ?? "").trim();
  if (!s) return "중립";

  const low: string = s.toLowerCase();

  if (s.includes("공포") || low.includes("fear") || low.includes("scared") || low.includes("terror")) return "공포";
  if (s.includes("놀람") || low.includes("surprise") || low.includes("shocked") || low.includes("startled")) return "놀람";
  if (s.includes("분노") || low.includes("anger") || low.includes("angry") || low.includes("rage")) return "분노";
  if (s.includes("슬픔") || low.includes("sad") || low.includes("sadness") || low.includes("down")) return "슬픔";
  if (s.includes("행복") || low.includes("happy") || low.includes("joy") || low.includes("delight")) return "행복";
  if (s.includes("혐오") || low.includes("disgust") || low.includes("gross") || low.includes("ew")) return "혐오";
  if (s.includes("중립") || low.includes("neutral")) return "중립";

  return "중립";
}

function emotionTheme(emotionRaw: string): EmotionTheme {
  const canon: EmotionCanon = normalizeEmotion(emotionRaw);

  const baseCard: React.CSSProperties = {
    borderRadius: "var(--radius)",
    border: "1px solid rgba(255,255,255,.12)",
    boxShadow: "0 18px 60px rgba(0,0,0,.55)",
    backdropFilter: "blur(14px)",
  };

  const basePill: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(0,0,0,.18)",
    color: "rgba(244,245,248,.88)",
  };

  const themes: Record<EmotionCanon, EmotionTheme> = {
    공포: {
      canon,
      emoji: "😱",
      label: "공포",
      cardStyle: {
        ...baseCard,
        border: "1px solid rgba(168, 122, 255, .42)",
        background:
          "radial-gradient(900px 520px at 15% 0%, rgba(168,122,255,.22), transparent 60%), radial-gradient(700px 500px at 90% 30%, rgba(122,180,255,.14), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
        boxShadow: "0 18px 60px rgba(0,0,0,.55), 0 0 0 4px rgba(168,122,255,.10)",
      },
      pillStyle: {
        ...basePill,
        border: "1px solid rgba(168, 122, 255, .40)",
        background: "rgba(168,122,255,.10)",
      },
    },
    놀람: {
      canon,
      emoji: "😮",
      label: "놀람",
      cardStyle: {
        ...baseCard,
        border: "1px solid rgba(255, 214, 102, .44)",
        background:
          "radial-gradient(900px 520px at 20% 0%, rgba(255,214,102,.22), transparent 62%), radial-gradient(700px 500px at 90% 30%, rgba(255,170,102,.14), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
        boxShadow: "0 18px 60px rgba(0,0,0,.55), 0 0 0 4px rgba(255,214,102,.10)",
      },
      pillStyle: {
        ...basePill,
        border: "1px solid rgba(255, 214, 102, .44)",
        background: "rgba(255,214,102,.10)",
      },
    },
    분노: {
      canon,
      emoji: "😡",
      label: "분노",
      cardStyle: {
        ...baseCard,
        border: "1px solid rgba(255, 77, 109, .48)",
        background:
          "radial-gradient(900px 520px at 18% 0%, rgba(255,77,109,.22), transparent 62%), radial-gradient(700px 500px at 90% 30%, rgba(255,122,144,.12), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
        boxShadow: "0 18px 60px rgba(0,0,0,.55), 0 0 0 4px rgba(255,77,109,.10)",
      },
      pillStyle: {
        ...basePill,
        border: "1px solid rgba(255, 77, 109, .42)",
        background: "rgba(255,77,109,.10)",
      },
    },
    슬픔: {
      canon,
      emoji: "😢",
      label: "슬픔",
      cardStyle: {
        ...baseCard,
        border: "1px solid rgba(102, 170, 255, .44)",
        background:
          "radial-gradient(900px 520px at 18% 0%, rgba(102,170,255,.20), transparent 62%), radial-gradient(700px 500px at 90% 30%, rgba(102,255,224,.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
        boxShadow: "0 18px 60px rgba(0,0,0,.55), 0 0 0 4px rgba(102,170,255,.10)",
      },
      pillStyle: {
        ...basePill,
        border: "1px solid rgba(102, 170, 255, .44)",
        background: "rgba(102,170,255,.10)",
      },
    },
    중립: {
      canon,
      emoji: "😐",
      label: "중립",
      cardStyle: {
        ...baseCard,
        border: "1px solid rgba(200, 200, 210, .26)",
        background:
          "radial-gradient(900px 520px at 20% 0%, rgba(210,210,230,.10), transparent 62%), radial-gradient(700px 500px at 90% 30%, rgba(140,255,198,.08), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
        boxShadow: "0 18px 60px rgba(0,0,0,.55), 0 0 0 4px rgba(210,210,230,.06)",
      },
      pillStyle: {
        ...basePill,
        border: "1px solid rgba(200, 200, 210, .26)",
        background: "rgba(210,210,230,.06)",
      },
    },
    행복: {
      canon,
      emoji: "😄",
      label: "행복",
      cardStyle: {
        ...baseCard,
        border: "1px solid rgba(140, 255, 198, .44)",
        background:
          "radial-gradient(900px 520px at 18% 0%, rgba(140,255,198,.18), transparent 62%), radial-gradient(700px 500px at 90% 30%, rgba(102,255,224,.12), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
        boxShadow: "0 18px 60px rgba(0,0,0,.55), 0 0 0 4px rgba(140,255,198,.10)",
      },
      pillStyle: {
        ...basePill,
        border: "1px solid rgba(140, 255, 198, .44)",
        background: "rgba(140,255,198,.10)",
      },
    },
    혐오: {
      canon,
      emoji: "🤢",
      label: "혐오",
      cardStyle: {
        ...baseCard,
        border: "1px solid rgba(185, 255, 102, .40)",
        background:
          "radial-gradient(900px 520px at 18% 0%, rgba(185,255,102,.18), transparent 62%), radial-gradient(700px 500px at 90% 30%, rgba(102,255,154,.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
        boxShadow: "0 18px 60px rgba(0,0,0,.55), 0 0 0 4px rgba(185,255,102,.08)",
      },
      pillStyle: {
        ...basePill,
        border: "1px solid rgba(185, 255, 102, .40)",
        background: "rgba(185,255,102,.10)",
      },
    },
  };

  return themes[canon];
}

function IconText(props: { icon: string; text: string; hideTextOnMobile?: boolean }) {
  const { icon, text, hideTextOnMobile } = props;
  return (
    <>
      <span aria-hidden="true">{icon}</span>
      <span className={hideTextOnMobile ? "hidden sm:inline" : ""}>{text}</span>
    </>
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

export default function App() {
  const [view, setView] = useState<View>("console");

  const [voices, setVoices] = useState<ElevenVoice[]>([]);
  const [neutralVoiceId, setNeutralVoiceId] = useState<string>("");
  const [warmVoiceId, setWarmVoiceId] = useState<string>("");

  const [customer, setCustomer] = useState<CustomerUtterance>({
    text: "미친년아니야?! 야! 배송 빨리해라!",
    ts: undefined,
    id: undefined,
  });

  const [agentText, setAgentText] = useState<string>("기다리게 해서 정말 죄송합니다. 바로 확인하겠습니다.");

  const [neutralAudio, setNeutralAudio] = useState<string>("");
  const [warmAudio, setWarmAudio] = useState<string>("");

  const [neutralTransformedText, setNeutralTransformedText] = useState<string>("");

  const [neutralEmotion, setNeutralEmotion] = useState<string>("");
  const [neutralConfidenceRaw, setNeutralConfidenceRaw] = useState<string>("");
  const [neutralConfidenceValue, setNeutralConfidenceValue] = useState<number | null>(null);

  const [neutralStatus, setNeutralStatus] = useState<Status>("idle");
  const [warmStatus, setWarmStatus] = useState<Status>("idle");
  const [voiceLabStatus, setVoiceLabStatus] = useState<Status>("idle");

  const [neutralError, setNeutralError] = useState<string>("");
  const [warmError, setWarmError] = useState<string>("");
  const [voiceLabError, setVoiceLabError] = useState<string>("");

  const [sttRecording, setSttRecording] = useState<boolean>(false);
  const micTsRef = useRef<string>("");

  const status = useMemo<Status>(() => mergeStatus(neutralStatus, warmStatus, voiceLabStatus), [
    neutralStatus,
    warmStatus,
    voiceLabStatus,
  ]);

  const errorMsg = useMemo<string>(() => neutralError || warmError || voiceLabError || "", [
    neutralError,
    warmError,
    voiceLabError,
  ]);

  const [autoPull, setAutoPull] = useState<boolean>(false);
  const [autoNeutral, setAutoNeutral] = useState<boolean>(false);

  const isAutoRunning: boolean = autoPull && autoNeutral;

  const [listenPace, setListenPace] = useState<number>(1.0);
  const [listenPitch, setListenPitch] = useState<number>(1.0);

  const neutralPlayerRef = useRef<HTMLAudioElement>(new Audio());
  const warmPlayerRef = useRef<HTMLAudioElement>(new Audio());

  const debounceRef = useRef<number | null>(null);
  const lastNeutralKeyRef = useRef<string>("");

  const neutralReqIdRef = useRef<number>(0);
  const warmReqIdRef = useRef<number>(0);

  const swearLoopRef = useRef<LoopState>({ isRunning: false, loopId: 0, abort: undefined });

  const productTheme: EmotionTheme = useMemo<EmotionTheme>(() => emotionTheme(neutralEmotion), [neutralEmotion]);

  function customerKey(c: CustomerUtterance, overrideText?: string): string {
    const text: string = String(overrideText ?? c.text ?? "").trim();
    const idPart: string = c.id ? String(c.id) : "";
    const tsPart: string = c.ts ? String(c.ts) : "";
    return `${idPart}::${tsPart}::${text}`;
  }

  async function reloadVoices(): Promise<ElevenVoice[]> {
    const v: ElevenVoice[] = await listVoices();
    setVoices(v);

    const first: string = v[0]?.voice_id ? String(v[0].voice_id) : "";
    setNeutralVoiceId((prev: string) => (prev ? prev : first));
    setWarmVoiceId((prev: string) => (prev ? prev : first));

    return v;
  }

  useEffect(() => {
    try {
      const raw: string | null = localStorage.getItem(LS_PROFILE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { pace?: number; pitch?: number };
      if (typeof data.pace === "number") setListenPace(clamp(data.pace, 0.85, 1.15));
      if (typeof data.pitch === "number") setListenPitch(clamp(data.pitch, 0.85, 1.15));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_PROFILE_KEY, JSON.stringify({ pace: listenPace, pitch: listenPitch }));
    } catch {
      // ignore
    }
  }, [listenPace, listenPitch]);

  useEffect(() => {
    const p: number = clamp(listenPitch, 0.85, 1.15);
    neutralPlayerRef.current.playbackRate = p;
    warmPlayerRef.current.playbackRate = p;
  }, [listenPitch]);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        await reloadVoices();
      } catch (e: unknown) {
        setVoiceLabStatus("error");
        setVoiceLabError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (neutralAudio) URL.revokeObjectURL(neutralAudio);
      if (warmAudio) URL.revokeObjectURL(warmAudio);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);

      stopLoop(swearLoopRef.current);
      stopAudio(neutralPlayerRef.current);
      stopAudio(warmPlayerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetNeutralMeta(): void {
    setNeutralTransformedText("");
    setNeutralEmotion("");
    setNeutralConfidenceRaw("");
    setNeutralConfidenceValue(null);
  }

  useEffect(() => {
    resetNeutralMeta();
  }, [customer.text, customer.id, customer.ts]);

  useEffect(() => {
    if (!autoPull) return;

    const ac: AbortController = new AbortController();

    const tick = async (): Promise<void> => {
      try {
        const data: CustomerUtterance = await fetchLatestCustomerUtterance(ac.signal);
        setCustomer(data);
      } catch {
        // ignore
      }
    };

    void tick();
    const t: number = window.setInterval(() => void tick(), 3000);
    return () => {
      window.clearInterval(t);
      ac.abort();
    };
  }, [autoPull]);

  function ttsSpeedFor(preset: TonePreset): number {
    const base: number = PRESET_BASE_SPEED[preset] ?? 1.0;
    const pace: number = clamp(listenPace, 0.85, 1.15);
    const pitch: number = clamp(listenPitch, 0.85, 1.15);
    const speed: number = base * (pace / pitch);
    return clamp(speed, 0.7, 1.2);
  }

  async function generateNeutral(
    source: "manual" | "auto",
    overrideText?: string,
    overrideKey?: string
  ): Promise<void> {
    const raw: string = String(overrideText ?? customer.text ?? "").trim();
    if (!neutralVoiceId || !raw) return;

    if (source === "auto" && neutralStatus === "loading") return;

    const reqId: number = ++neutralReqIdRef.current;
    setNeutralStatus("loading");
    setNeutralError("");
    resetNeutralMeta();

    try {
      stopAudio(neutralPlayerRef.current);

      if (neutralAudio) {
        URL.revokeObjectURL(neutralAudio);
        setNeutralAudio("");
      }

      const ac: AbortController = new AbortController();
      const parsed: TransformParsed = await transformWithMeta(raw, ac.signal);
      if (reqId !== neutralReqIdRef.current) return;

      const clean: string = parsed.transformed_message.trim();

      setNeutralTransformedText(clean);
      setNeutralEmotion(parsed.emotion ?? "");
      setNeutralConfidenceRaw(parsed.confidenceRaw ?? "");
      setNeutralConfidenceValue(typeof parsed.confidenceValue === "number" ? parsed.confidenceValue : null);

      const { url } = await tts({
        text: clean,
        voiceId: neutralVoiceId,
        preset: "neutral",
        speed: ttsSpeedFor("neutral"),
      });

      if (reqId !== neutralReqIdRef.current) {
        URL.revokeObjectURL(url);
        return;
      }

      setNeutralAudio(url);
      setNeutralStatus("ok");

      const key: string = overrideKey ?? customerKey(customer, raw);
      lastNeutralKeyRef.current = key;

      neutralPlayerRef.current.playbackRate = clamp(listenPitch, 0.85, 1.15);
      neutralPlayerRef.current.src = url;
      neutralPlayerRef.current.currentTime = 0;

      await neutralPlayerRef.current.play();
    } catch (e: unknown) {
      if (reqId !== neutralReqIdRef.current) return;
      setNeutralStatus("error");
      setNeutralError(String(e));
    }
  }

  async function generateWarm(): Promise<void> {
    const text: string = String(agentText ?? "").trim();
    if (!warmVoiceId || !text) return;

    const reqId: number = ++warmReqIdRef.current;
    setWarmStatus("loading");
    setWarmError("");

    try {
      stopAudio(warmPlayerRef.current);

      if (warmAudio) {
        URL.revokeObjectURL(warmAudio);
        setWarmAudio("");
      }

      const { url } = await tts({
        text,
        voiceId: warmVoiceId,
        preset: "warm",
        speed: ttsSpeedFor("warm"),
      });

      if (reqId !== warmReqIdRef.current) {
        URL.revokeObjectURL(url);
        return;
      }

      setWarmAudio(url);
      setWarmStatus("ok");

      warmPlayerRef.current.playbackRate = clamp(listenPitch, 0.85, 1.15);
      warmPlayerRef.current.src = url;
      warmPlayerRef.current.currentTime = 0;

      await warmPlayerRef.current.play();
    } catch (e: unknown) {
      if (reqId !== warmReqIdRef.current) return;
      setWarmStatus("error");
      setWarmError(String(e));
    }
  }

  async function runSwearLoop(): Promise<void> {
    if (!neutralVoiceId) return;

    const loop: LoopState = swearLoopRef.current;
    if (loop.isRunning) return;

    loop.isRunning = true;
    loop.loopId += 1;

    const myLoopId: number = loop.loopId;
    const abort: AbortController = new AbortController();
    loop.abort = abort;

    const signal: AbortSignal = abort.signal;

    setNeutralError("");
    resetNeutralMeta();
    lastNeutralKeyRef.current = "";

    stopAudio(neutralPlayerRef.current);
    if (neutralAudio) {
      URL.revokeObjectURL(neutralAudio);
      setNeutralAudio("");
    }

    try {
      while (loop.isRunning && myLoopId === loop.loopId) {
        const raw: string = await getRandomSwear(signal);

        setCustomer((prev: CustomerUtterance) => ({
          ...prev,
          text: raw,
          id: prev.id,
          ts: prev.ts,
        }));

        const key: string = `swear::${nowIso()}::${raw}`;
        if (key === lastNeutralKeyRef.current) {
          await sleep(120, signal);
          continue;
        }

        const reqId: number = ++neutralReqIdRef.current;
        setNeutralStatus("loading");
        setNeutralError("");
        resetNeutralMeta();

        stopAudio(neutralPlayerRef.current);
        if (neutralAudio) {
          URL.revokeObjectURL(neutralAudio);
          setNeutralAudio("");
        }

        const parsed: TransformParsed = await transformWithMeta(raw, signal);
        if (reqId !== neutralReqIdRef.current) {
          await sleep(50, signal);
          continue;
        }

        const clean: string = parsed.transformed_message.trim();

        setNeutralTransformedText(clean);
        setNeutralEmotion(parsed.emotion ?? "");
        setNeutralConfidenceRaw(parsed.confidenceRaw ?? "");
        setNeutralConfidenceValue(typeof parsed.confidenceValue === "number" ? parsed.confidenceValue : null);

        const { url } = await tts({
          text: clean,
          voiceId: neutralVoiceId,
          preset: "neutral",
          speed: ttsSpeedFor("neutral"),
        });

        if (reqId !== neutralReqIdRef.current) {
          URL.revokeObjectURL(url);
          await sleep(50, signal);
          continue;
        }

        setNeutralAudio(url);
        setNeutralStatus("ok");
        lastNeutralKeyRef.current = key;

        neutralPlayerRef.current.playbackRate = clamp(listenPitch, 0.85, 1.15);
        neutralPlayerRef.current.src = url;
        neutralPlayerRef.current.currentTime = 0;

        await playOnce(neutralPlayerRef.current, signal);
        await sleep(240, signal);
      }
    } catch (e: unknown) {
      const msg: string = String(e);
      if (!msg.includes("aborted")) {
        setNeutralStatus("error");
        setNeutralError(msg);
      }
    } finally {
      loop.isRunning = false;
    }
  }

  async function startOneTouch(): Promise<void> {
    setAutoPull(false);
    setAutoNeutral(false);

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    neutralReqIdRef.current += 1;
    stopAudio(neutralPlayerRef.current);

    await runSwearLoop();
  }

  function stopAll(): void {
    stopLoop(swearLoopRef.current);

    setAutoPull(false);
    setAutoNeutral(false);

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    neutralReqIdRef.current += 1;
    warmReqIdRef.current += 1;

    stopAudio(neutralPlayerRef.current);
    stopAudio(warmPlayerRef.current);

    setNeutralStatus("idle");
    setNeutralError("");
    resetNeutralMeta();

    setWarmStatus("idle");
    setWarmError("");

    if (neutralAudio) {
      URL.revokeObjectURL(neutralAudio);
      setNeutralAudio("");
    }
    if (warmAudio) {
      URL.revokeObjectURL(warmAudio);
      setWarmAudio("");
    }
  }

  useEffect(() => {
    if (!autoNeutral) return;
    if (sttRecording) return;

    const text: string = String(customer.text ?? "").trim();
    if (!neutralVoiceId || !text || text.length < 2) return;

    const key: string = customerKey(customer);
    if (key === lastNeutralKeyRef.current) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(() => {
      void generateNeutral("auto", text, key);
    }, 650);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.text, customer.id, customer.ts, neutralVoiceId, autoNeutral, sttRecording]);

  const confPct: number = typeof neutralConfidenceValue === "number" ? neutralConfidenceValue : 0;

  const canStart: boolean = !swearLoopRef.current.isRunning && voiceLabStatus !== "loading" && !!neutralVoiceId;
  const canStop: boolean =
    swearLoopRef.current.isRunning ||
    isAutoRunning ||
    neutralStatus === "loading" ||
    warmStatus === "loading";

  return (
    <div className="min-h-screen">
      <header className="mx-auto w-full max-w-6xl px-4 sm:px-5 pt-4 sm:pt-6">
        <div className="ts-cardHero px-4 sm:px-5 py-3 sm:py-4">
          <div className="flex flex-col gap-3 sm:gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-10 w-10 sm:h-11 sm:w-11 rounded-2xl flex-none"
                  style={{
                    background:
                      "radial-gradient(16px 16px at 30% 30%, rgba(255,122,144,.95), rgba(255,77,109,.22)), linear-gradient(180deg, rgba(255,77,109,.18), rgba(255,255,255,.03))",
                    border: "1px solid rgba(255,77,109,.35)",
                    boxShadow: "0 0 0 3px rgba(255,77,109,.10)",
                  }}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-base sm:text-lg font-semibold tracking-tight truncate">ToneShift</div>

                    <span className="ts-pill">
                      <span className={dotClass(status)} />
                      <span className="hidden sm:inline ml-2">{status === "loading" ? "generating" : status}</span>
                    </span>

                    {sttRecording ? (
                      <span className="ts-pill" title="STT listening">
                        <span aria-hidden="true">🎙️</span>
                        <span className="hidden sm:inline ml-2">listening</span>
                      </span>
                    ) : null}

                    <span className="ts-pill" title={neutralEmotion ? `감정: ${neutralEmotion}` : "감정: -"}>
                      <span aria-hidden="true">😶</span>
                      <span className="hidden sm:inline ml-2">{neutralEmotion ? `감정: ${neutralEmotion}` : "감정: -"}</span>
                    </span>
                    <span className="ts-pill" title={neutralConfidenceRaw ? `신뢰도: ${neutralConfidenceRaw}` : "신뢰도: -"}>
                      <span aria-hidden="true">🎯</span>
                      <span className="hidden sm:inline ml-2">{neutralConfidenceRaw ? `신뢰도: ${neutralConfidenceRaw}` : "신뢰도: -"}</span>
                    </span>
                  </div>

                  <div className="mt-2 ts-tabs">
                    <button
                      type="button"
                      className={`ts-tab ${view === "console" ? "ts-tabActive" : ""}`}
                      onClick={() => setView("console")}
                      aria-label="Console"
                      title="Console"
                    >
                      <IconText icon="🧩" text=" Console" hideTextOnMobile />
                    </button>
                    <button
                      type="button"
                      className={`ts-tab ${view === "voiceDesign" ? "ts-tabActive" : ""}`}
                      onClick={() => setView("voiceDesign")}
                      aria-label="목소리만들기"
                      title="목소리만들기"
                    >
                      <IconText icon="🎛️" text=" 목소리만들기" hideTextOnMobile />
                    </button>
                    <button
                      type="button"
                      className={`ts-tab ${view === "voiceClone" ? "ts-tabActive" : ""}`}
                      onClick={() => setView("voiceClone")}
                      aria-label="내목소리 클로닝"
                      title="내목소리 클로닝"
                    >
                      <IconText icon="🧬" text=" 내목소리" hideTextOnMobile />
                    </button>
                    <button
                      type="button"
                      className={`ts-tab ${view === "product" ? "ts-tabActive" : ""}`}
                      onClick={() => setView("product")}
                      aria-label="시제품"
                      title="시제품"
                    >
                      <IconText icon="🧪" text=" 시제품" hideTextOnMobile />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-none">
                <button
                  type="button"
                  className="ts-btn ts-btn-accent"
                  onClick={() => void startOneTouch()}
                  disabled={!canStart}
                  aria-label="시작"
                  title="시작"
                >
                  <IconText icon="▶️" text=" 시작" hideTextOnMobile />
                </button>
                <button
                  type="button"
                  className="ts-btn ts-btn-ghost"
                  onClick={stopAll}
                  disabled={!canStop}
                  aria-label="종료"
                  title="종료"
                >
                  <IconText icon="⏹" text=" 종료" hideTextOnMobile />
                </button>
                <button
                  type="button"
                  className="ts-btn ts-btn-ghost"
                  onClick={() => {
                    setListenPace(1.0);
                    setListenPitch(1.0);
                  }}
                  aria-label="Reset"
                  title="Reset"
                >
                  <IconText icon="↩️" text=" Reset" hideTextOnMobile />
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>
                  <span aria-hidden="true">🧊</span>
                  <span className="hidden sm:inline ml-1">Neutral voice (고객/중화)</span>
                </div>
                <VoicePicker
                  voices={voices}
                  value={neutralVoiceId}
                  onChange={setNeutralVoiceId}
                  placeholder="Neutral Voice"
                />
              </div>

              <div className="sm:col-span-1">
                <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>
                  <span aria-hidden="true">🫂</span>
                  <span className="hidden sm:inline ml-1">Warm voice (상담사/공감)</span>
                </div>
                <VoicePicker
                  voices={voices}
                  value={warmVoiceId}
                  onChange={setWarmVoiceId}
                  placeholder="Warm Voice"
                />
              </div>

              <div className="sm:col-span-1 flex items-end">
                <div className="w-full">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      <span aria-hidden="true">🎯</span>
                      <span className="hidden sm:inline ml-1">Confidence</span>
                    </span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      <span className="hidden sm:inline">{neutralConfidenceRaw || "-"}</span>
                      <span className="sm:hidden">
                        {typeof neutralConfidenceValue === "number" ? `${Math.round(confPct)}%` : "-"}
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      height: 10,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,.10)",
                      background: "rgba(255,255,255,.05)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${confPct}%`,
                        height: "100%",
                        background: "rgba(255,77,109,.55)",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="ts-divider" />
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-1">
                <div className="ts-pill inline-flex items-center gap-2">
                  <span aria-hidden="true">🎧</span>
                  <span className="hidden sm:inline">청취 프로필</span>
                </div>

                <div className="mt-2 text-xs hidden sm:block" style={{ color: "var(--muted)" }}>
                  Pace=체감 속도, Pitch=체감 높낮이 (저장됨)
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="ts-pill" title="TTS speed">
                    <span aria-hidden="true">⚡</span>
                    <span className="hidden sm:inline ml-2">
                      {ttsSpeedFor("neutral").toFixed(2)} / {ttsSpeedFor("warm").toFixed(2)}
                    </span>
                    <span className="sm:hidden ml-2">{ttsSpeedFor("neutral").toFixed(2)}</span>
                  </span>

                  <span className="ts-pill" title="playbackRate">
                    <span aria-hidden="true">🎚️</span>
                    <span className="hidden sm:inline ml-2">{clamp(listenPitch, 0.85, 1.15).toFixed(2)}</span>
                    <span className="sm:hidden ml-2">{clamp(listenPitch, 0.85, 1.15).toFixed(2)}</span>
                  </span>
                </div>
              </div>

              <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
                <RangeRow label="Pace" value={listenPace} min={0.85} max={1.15} step={0.01} onChange={setListenPace} />
                <RangeRow label="Pitch" value={listenPitch} min={0.85} max={1.15} step={0.01} onChange={setListenPitch} />
              </div>
            </div>

            {status === "error" && errorMsg ? <div className="ts-pill mt-3">{errorMsg}</div> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 sm:px-5 pb-10 sm:pb-12 pt-5 sm:pt-6">
        {view === "voiceDesign" ? (
          <VoiceDesignPage
            voices={voices}
            voiceId={neutralVoiceId}
            onVoiceChange={setNeutralVoiceId}
            onReloadVoices={reloadVoices}
            playbackRate={clamp(listenPitch, 0.85, 1.15)}
            setVoiceLabStatus={setVoiceLabStatus}
            setVoiceLabError={setVoiceLabError}
          />
        ) : view === "voiceClone" ? (
          <VoiceClonePage
            voices={voices}
            voiceId={neutralVoiceId}
            onVoiceChange={setNeutralVoiceId}
            onReloadVoices={reloadVoices}
            setVoiceLabStatus={setVoiceLabStatus}
            setVoiceLabError={setVoiceLabError}
          />
        ) : view === "product" ? (
          <div className="mx-auto w-full max-w-3xl">
            <section className="ts-card p-4 sm:p-5" style={productTheme.cardStyle}>
              <div className="ts-h">
                <div>
                  <div className="ts-hTitle">
                    <span aria-hidden="true">🧪</span> <span className="hidden sm:inline">시제품</span>
                  </div>
                  <div className="ts-hSub hidden sm:block">STT → transform → Neutral TTS</div>
                </div>
                <span className="ts-pill" title="status" style={productTheme.pillStyle}>
                  <span className={dotClass(status)} /> <span className="hidden sm:inline ml-2">{status}</span>
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="ts-pill" style={productTheme.pillStyle} title={productTheme.label}>
                    <span aria-hidden="true">{productTheme.emoji}</span>
                    <span className="hidden sm:inline ml-2">{productTheme.label}</span>
                  </span>

                  <span
                    className="ts-pill"
                    style={productTheme.pillStyle}
                    title={neutralConfidenceRaw ? `신뢰도: ${neutralConfidenceRaw}` : "신뢰도: -"}
                  >
                    <span aria-hidden="true">🎯</span>
                    <span className="hidden sm:inline ml-2">{neutralConfidenceRaw ? neutralConfidenceRaw : "-"}</span>
                  </span>
                </div>

                <ScribeMicTranscriber
                  disabled={!neutralVoiceId}
                  buttonClassName="ts-btn ts-btn-accent"
                  onRecordingChange={(isRec: boolean) => {
                    setSttRecording(isRec);

                    if (isRec) {
                      stopLoop(swearLoopRef.current);
                      setAutoPull(false);
                      setAutoNeutral(false);

                      neutralReqIdRef.current += 1;
                      warmReqIdRef.current += 1;
                      stopAudio(neutralPlayerRef.current);
                      stopAudio(warmPlayerRef.current);

                      micTsRef.current = nowIso();
                      setCustomer({ text: "", id: "mic", ts: micTsRef.current });
                      resetNeutralMeta();
                      setNeutralError("");
                    }
                  }}
                  onLiveText={(text: string) => {
                    setCustomer((prev: CustomerUtterance) => ({
                      ...prev,
                      text,
                      id: "mic",
                      ts: micTsRef.current || prev.ts,
                    }));
                  }}
                  onFinalText={(text: string) => {
                    const finalText: string = String(text ?? "").trim();
                    if (!finalText) return;

                    const ts: string = micTsRef.current || nowIso();
                    const key: string = `mic::${ts}::${finalText}`;

                    setCustomer({ text: finalText, id: "mic", ts });
                    void generateNeutral("manual", finalText, key);
                  }}
                />

                {neutralTransformedText ? (
                  <div className="text-sm" style={{ color: "rgba(244,245,248,.92)" }}>
                    {neutralTransformedText}
                  </div>
                ) : (
                  <div className="text-sm" style={{ color: "rgba(244,245,248,.70)" }}>
                    <span aria-hidden="true">🫧</span> <span className="hidden sm:inline">순화 문장 표시</span>
                  </div>
                )}

                {neutralAudio ? <audio controls src={neutralAudio} className="w-full" /> : null}
              </div>
            </section>
          </div>
        ) : (
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
            <section className="ts-card p-4 sm:p-5">
              {/* 이하 콘솔 UI는 기존 그대로 */}
              <div className="ts-h">
                <div>
                  <div className="ts-hTitle">
                    <span aria-hidden="true">😡</span> <span className="hidden sm:inline">고객 → 순화 → 중화</span>
                  </div>
                  <div className="ts-hSub hidden sm:block">STT or 입력 → Neutral Voice</div>
                </div>
                <span className="ts-pill" title={neutralEmotion ? `감정: ${neutralEmotion}` : "감정: -"}>
                  <span aria-hidden="true">😶</span>
                  <span className="hidden sm:inline ml-2">{neutralEmotion ? neutralEmotion : "-"}</span>
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <ScribeMicTranscriber
                    disabled={!neutralVoiceId}
                    buttonClassName="ts-btn"
                    onRecordingChange={(isRec: boolean) => {
                      setSttRecording(isRec);

                      if (isRec) {
                        stopLoop(swearLoopRef.current);
                        setAutoPull(false);
                        setAutoNeutral(false);

                        neutralReqIdRef.current += 1;
                        warmReqIdRef.current += 1;
                        stopAudio(neutralPlayerRef.current);
                        stopAudio(warmPlayerRef.current);

                        micTsRef.current = nowIso();
                        setCustomer({ text: "", id: "mic", ts: micTsRef.current });
                        resetNeutralMeta();
                        setNeutralError("");
                      }
                    }}
                    onLiveText={(text: string) => {
                      setCustomer((prev: CustomerUtterance) => ({
                        ...prev,
                        text,
                        id: "mic",
                        ts: micTsRef.current || prev.ts,
                      }));
                    }}
                    onFinalText={(text: string) => {
                      const finalText: string = String(text ?? "").trim();
                      if (!finalText) return;

                      const ts: string = micTsRef.current || nowIso();
                      const key: string = `mic::${ts}::${finalText}`;

                      setCustomer({ text: finalText, id: "mic", ts });
                      void generateNeutral("manual", finalText, key);
                    }}
                  />

                  <Switch checked={autoPull} onChange={setAutoPull} label="3초 자동" />
                  <Switch checked={autoNeutral} onChange={setAutoNeutral} label="자동 음성" />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {customer.id ? <span className="ts-pill">id: {customer.id}</span> : null}
                  {customer.ts ? <span className="ts-pill">ts: {customer.ts}</span> : null}
                </div>
              </div>

              <div className="mt-4">
                <textarea
                  className="ts-input ts-textarea"
                  value={customer.text}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setCustomer((prev: CustomerUtterance) => ({ ...prev, text: e.target.value }))
                  }
                />
              </div>

              {neutralTransformedText ? (
                <div className="mt-3">
                  <div className="ts-pill inline-flex items-center gap-2" title="transformed_message">
                    <span aria-hidden="true">🫧</span>
                    <span className="hidden sm:inline">transformed_message</span>
                  </div>
                  <div className="mt-2">
                    <textarea className="ts-input ts-textarea" value={neutralTransformedText} readOnly />
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  className="ts-btn ts-btn-accent"
                  onClick={() => void generateNeutral("manual")}
                  disabled={neutralStatus === "loading" || !neutralVoiceId}
                  aria-label="중화 생성"
                  title="중화 생성"
                >
                  {neutralStatus === "loading" ? <span className="ts-spinner" /> : <span aria-hidden="true">🧊</span>}
                  <span className="hidden sm:inline"> 중화 생성</span>
                </button>
              </div>

              <div className="mt-3">
                {neutralStatus === "error" && neutralError ? (
                  <div
                    className="ts-pill"
                    style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}
                  >
                    {neutralError}
                  </div>
                ) : null}
              </div>

              <div className="mt-4">{neutralAudio ? <audio controls src={neutralAudio} className="w-full" /> : <div className="ts-pill">-</div>}</div>
            </section>

            <section className="ts-card p-4 sm:p-5">
              {/* Warm 섹션은 기존 그대로 */}
              <div className="ts-h">
                <div>
                  <div className="ts-hTitle">
                    <span aria-hidden="true">🧑‍💼</span> <span className="hidden sm:inline">상담사 → 공감 톤</span>
                  </div>
                  <div className="ts-hSub hidden sm:block">Warm Voice 사용</div>
                </div>
                <span className="ts-pill" title="Warm">
                  <span aria-hidden="true">🫂</span>
                  <span className="hidden sm:inline ml-2">Warm</span>
                </span>
              </div>

              <div className="mt-4">
                <textarea
                  className="ts-input ts-textarea"
                  value={agentText}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAgentText(e.target.value)}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  className="ts-btn ts-btn-accent"
                  onClick={() => void generateWarm()}
                  disabled={warmStatus === "loading" || !warmVoiceId}
                  aria-label="공감 생성"
                  title="공감 생성"
                >
                  {warmStatus === "loading" ? <span className="ts-spinner" /> : <span aria-hidden="true">🫂</span>}
                  <span className="hidden sm:inline"> 공감 생성</span>
                </button>
              </div>

              <div className="mt-3">
                {warmStatus === "error" && warmError ? (
                  <div className="ts-pill" style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}>
                    {warmError}
                  </div>
                ) : null}
              </div>

              <div className="mt-4">{warmAudio ? <audio controls src={warmAudio} className="w-full" /> : <div className="ts-pill">-</div>}</div>
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
    <label className="ts-switch" title={label} aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)} />
      <span className="ts-switchTrack">
        <span className="ts-switchThumb" />
      </span>
      <span className="ts-switchText hidden sm:inline">{label}</span>
      <span className="ts-switchText sm:hidden" aria-hidden="true">
        •
      </span>
    </label>
  );
}

function RangeRow(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const { label, value, min, max, step, onChange } = props;

  return (
    <div className="ts-rangeWrap">
      <div className="ts-rangeTop">
        <div className="ts-rangeLabel">
          <span aria-hidden="true">{label === "Pace" ? "⚡" : "🎚️"}</span>
          <span className="hidden sm:inline ml-2">{label}</span>
        </div>
        <span className="ts-pill ts-rangeValue">{value.toFixed(2)}</span>
      </div>
      <input
        className="ts-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
