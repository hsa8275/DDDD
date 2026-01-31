// src/pages/VoiceClonePage.tsx
import { useEffect, useMemo, useState } from "react";
import { addVoice, type ElevenVoice } from "../lib/eleven";

type Status = "idle" | "loading" | "ok" | "error";

type Props = {
  voices: ElevenVoice[];
  voiceId: string;
  onVoiceChange: (id: string) => void;
  onReloadVoices: () => Promise<ElevenVoice[]>;
  setVoiceLabStatus: (s: Status) => void;
  setVoiceLabError: (m: string) => void;
};

type Labels = Record<string, string>;

const FIXED_LABELS: Labels = { lang: "ko", type: "clone" };

function pad2(n: number): string {
  const v: number = Math.floor(Math.abs(n));
  return v < 10 ? `0${v}` : String(v);
}

// KST(UTC+9) 기준 "YYYY-MM-DD HH:mm"
function formatKstYmdHm(now: Date): string {
  const kst: Date = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y: number = kst.getUTCFullYear();
  const m: string = pad2(kst.getUTCMonth() + 1);
  const d: string = pad2(kst.getUTCDate());
  const hh: string = pad2(kst.getUTCHours());
  const mm: string = pad2(kst.getUTCMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function VoiceClonePage(props: Props) {
  const { voices, voiceId, onVoiceChange, onReloadVoices, setVoiceLabStatus, setVoiceLabError } = props;

  const [counselorName, setCounselorName] = useState<string>("상담사이름");
  const [name, setName] = useState<string>("My Voice");

  // 화면 표시용 현재시간 tick(30초마다 갱신)
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const [files, setFiles] = useState<File[]>([]);
  const [localStatus, setLocalStatus] = useState<Status>("idle");
  const [localError, setLocalError] = useState<string>("");
  const [createdVoiceId, setCreatedVoiceId] = useState<string>("");

  useEffect((): (() => void) => {
    const id: number = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const autoDescription: string = useMemo((): string => {
    const who: string = counselorName.trim().length ? counselorName.trim() : "상담사이름";
    const when: string = formatKstYmdHm(new Date(nowTick));
    return `내 목소리 클로닝 | ${when} | ${who}`;
  }, [counselorName, nowTick]);

  const canSubmit: boolean = useMemo((): boolean => {
    return name.trim().length >= 2 && files.length >= 1 && localStatus !== "loading";
  }, [name, files.length, localStatus]);

  const selectedVoiceName: string = useMemo((): string => {
    const v: ElevenVoice | undefined = voices.find((x: ElevenVoice) => x.voice_id === voiceId);
    return v ? v.name : "(미선택)";
  }, [voices, voiceId]);

  async function onSubmit(): Promise<void> {
    setLocalError("");
    setCreatedVoiceId("");

    setLocalStatus("loading");
    setVoiceLabStatus("loading");
    setVoiceLabError("");

    try {
      // ✅ 제출 시점의 "현재 시간"으로 한 번 더 확정
      const finalDescription: string = `내 목소리 클로닝 | ${formatKstYmdHm(new Date())} | ${
        counselorName.trim().length ? counselorName.trim() : "상담사이름"
      }`;

      const res = await addVoice({
        name: name.trim(),
        description: finalDescription.trim(),
        files,
        labels: FIXED_LABELS,
      });

      setCreatedVoiceId(res.voice_id);

      const updated: ElevenVoice[] = await onReloadVoices();
      const exists: boolean = updated.some((v: ElevenVoice) => v.voice_id === res.voice_id);
      if (exists) onVoiceChange(res.voice_id);

      setLocalStatus("ok");
      setVoiceLabStatus("ok");
    } catch (e: unknown) {
      const msg: string = String(e);
      setLocalStatus("error");
      setLocalError(msg);
      setVoiceLabStatus("error");
      setVoiceLabError(msg);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="ts-card p-5">
        <div className="ts-h">
          <div>
            <div className="ts-hTitle">🧬 내 목소리 클로닝</div>
            <div className="ts-hSub">오디오 파일 업로드 → VoiceLab에 새 Voice 추가</div>
          </div>
          <span className="ts-pill">POST /voices/add</span>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-2">
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              상담사 이름
            </div>
            <input
              className="ts-input"
              value={counselorName}
              onChange={(e) => setCounselorName(e.target.value)}
              placeholder="예: 박수진"
            />
          </label>

          <label className="grid gap-2">
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Voice 이름
            </div>
            <input className="ts-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: Seongan Voice" />
          </label>

          <label className="grid gap-2">
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              설명(옵션) (자동 입력)
            </div>
            <textarea className="ts-input ts-textarea" value={autoDescription} readOnly />
          </label>

          {/* labels JSON(옵션)은 고정 + 숨김 처리: FIXED_LABELS = {"lang":"ko","type":"clone"} */}

          <label className="grid gap-2">
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              오디오 파일(필수, 여러 개 가능)
            </div>
            <input
              className="ts-input"
              type="file"
              accept="audio/*"
              multiple
              onChange={(e) => {
                const list: FileList | null = e.target.files;
                const next: File[] = list ? Array.from(list) : [];
                setFiles(next);
              }}
            />
            {files.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <span className="ts-pill">{files.length} file(s)</span>
                {files.slice(0, 3).map((f: File) => (
                  <span key={`${f.name}-${f.size}`} className="ts-pill">
                    {f.name}
                  </span>
                ))}
                {files.length > 3 ? <span className="ts-pill">+{files.length - 3}</span> : null}
              </div>
            ) : (
              <span className="ts-pill">아직 파일이 없어요.</span>
            )}
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="ts-btn ts-btn-accent" onClick={() => void onSubmit()} disabled={!canSubmit}>
              {localStatus === "loading" ? <span className="ts-spinner" /> : "🧬"} 클로닝 생성
            </button>
            <span className="ts-pill">현재 선택 Voice: {selectedVoiceName}</span>
          </div>

          {createdVoiceId ? (
            <div className="mt-2">
              <div className="ts-pill inline-flex items-center gap-2">✅ 생성됨</div>
              <div className="mt-2">
                <input className="ts-input" value={createdVoiceId} readOnly />
              </div>
            </div>
          ) : null}

          {localStatus === "error" && localError ? (
            <div className="mt-2 ts-pill" style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}>
              {localError}
            </div>
          ) : null}
        </div>
      </section>

      <section className="ts-card p-5">
        <div className="ts-h">
          <div>
            <div className="ts-hTitle">🎛️ 체크</div>
            <div className="ts-hSub">클로닝 후 Voice 목록에 새 항목이 나타나는지 확인</div>
          </div>
          <span className="ts-pill">GET /voices</span>
        </div>

        <div className="mt-4 grid gap-2">
          <div className="ts-pill">보유 Voice 수: {voices.length}</div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            (목록 조회는 ElevenLabs GET /v1/voices 기반){" "}
          </div>
        </div>
      </section>
    </div>
  );
}
