import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { CommitStrategy, useScribe, type TranscriptSegment } from "@elevenlabs/react";

type Props = {
  disabled?: boolean;
  buttonClassName?: string;
  onRecordingChange?: (isRecording: boolean) => void;
  onLiveText?: (text: string) => void;
  onFinalText?: (text: string) => void;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

async function safeText(r: Response): Promise<string> {
  const t: string = await r.text().catch((): string => "");
  return t || `${r.status} ${r.statusText}`;
}

function joinSegments(segs: TranscriptSegment[]): string {
  const parts: string[] = [];
  for (const s of segs) {
    const t: string = String(s.text ?? "").trim();
    if (t) parts.push(t);
  }
  return parts.join(" ").trim();
}

async function fetchScribeToken(signal: AbortSignal): Promise<string> {
  const r: Response = await fetch("/api/eleven/scribe-token", { method: "POST", signal });
  if (!r.ok) throw new Error(await safeText(r));

  const data: unknown = await r.json().catch((): unknown => null);
  if (!isRecord(data)) throw new Error("Invalid token response");
  const token: string = readString(data.token).trim();
  if (!token) throw new Error("Missing token");
  return token;
}

export function ScribeMicTranscriber(props: Props): ReactElement {
  const { disabled, buttonClassName, onRecordingChange, onLiveText, onFinalText } = props;

  const [uiError, setUiError] = useState<string>("");

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    languageCode: "ko",
    onError: (err: Error | Event) => {
      setUiError(err instanceof Error ? err.message : "Scribe error");
    },
  });

  const committedText: string = useMemo<string>(() => joinSegments(scribe.committedTranscripts), [scribe.committedTranscripts]);
  const partialText: string = useMemo<string>(() => String(scribe.partialTranscript ?? "").trim(), [scribe.partialTranscript]);

  const liveText: string = useMemo<string>(() => {
    if (committedText && partialText) return `${committedText} ${partialText}`.trim();
    return (committedText || partialText).trim();
  }, [committedText, partialText]);

  const liveRef = useRef<string>("");
  useEffect(() => {
    liveRef.current = liveText;
    if (scribe.isTranscribing && onLiveText) onLiveText(liveText);
  }, [liveText, onLiveText, scribe.isTranscribing]);

  const isRecording: boolean = scribe.isTranscribing || scribe.status === "connected";

  async function start(): Promise<void> {
    if (disabled) return;
    setUiError("");

    try {
      // 사용자 제스처에서 권한 확보
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const ac: AbortController = new AbortController();
      const token: string = await fetchScribeToken(ac.signal);

      scribe.clearTranscripts();

      await scribe.connect({
        token,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (onRecordingChange) onRecordingChange(true);
    } catch (e: unknown) {
      setUiError(String(e));
      if (onRecordingChange) onRecordingChange(false);
    }
  }

  function stop(): void {
    const finalText: string = String(liveRef.current ?? "").trim();

    try {
      scribe.disconnect();
    } catch {
      // ignore
    }

    if (onRecordingChange) onRecordingChange(false);
    if (finalText && onFinalText) onFinalText(finalText);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClassName ?? "ts-btn"}
          onClick={() => void (isRecording ? Promise.resolve(stop()) : start())}
          disabled={!!disabled}
          aria-label={isRecording ? "음성 분석 종료" : "음성 분석 시작"}
          title={isRecording ? "음성 분석 종료" : "음성 분석 시작"}
        >
          <span aria-hidden="true">{isRecording ? "⏹️" : "🎙️"}</span>
          <span className="hidden sm:inline">{isRecording ? " 음성 종료" : " 음성 분석"}</span>
        </button>

        <span className="ts-pill" title={scribe.status}>
          <span aria-hidden="true">{isRecording ? "🟢" : "⚪"}</span>
          <span className="hidden sm:inline ml-2">{isRecording ? "listening" : "idle"}</span>
        </span>
      </div>

      <div className="ts-pill" style={{ opacity: 0.95 }}>
        <span aria-hidden="true">📝</span>
        <span className="ml-2" style={{ whiteSpace: "pre-wrap" }}>
          {liveText ? liveText : "음성 분석을 시작하세요..."}
        </span>
      </div>

      {(uiError || scribe.error) ? (
        <div className="ts-pill" style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}>
          {uiError || scribe.error}
        </div>
      ) : null}
    </div>
  );
}
