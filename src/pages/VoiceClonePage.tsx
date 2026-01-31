// src/pages/VoiceClonePage.tsx
import { useEffect, useMemo, useState } from "react";
import type { ElevenVoice } from "../lib/eleven";

type Status = "idle" | "loading" | "ok" | "error";

type PickedFile = {
  id: string;
  file: File;
  url: string;
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function prettyBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)}${u[i]}`;
}

async function createInstantClonedVoice(args: { name: string; description?: string; files: File[] }) {
  const fd = new FormData();
  fd.append("name", args.name);
  if (args.description?.trim()) fd.append("description", args.description.trim());
  args.files.forEach((f) => fd.append("files", f, f.name));

  const r = await fetch("/api/eleven/voices/add", {
    method: "POST",
    body: fd,
  });

  const text = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(text || `IVC failed (${r.status})`);
  }

  // 보통 JSON 응답
  try {
    return JSON.parse(text) as { voice_id?: string; [k: string]: any };
  } catch {
    return { raw: text } as any;
  }
}

export function VoiceClonePage(props: {
  voices: ElevenVoice[];
  voiceId: string;
  onVoiceChange: (id: string) => void;
  onReloadVoices: () => Promise<ElevenVoice[]>;
  setVoiceLabStatus: (s: Status) => void;
  setVoiceLabError: (m: string) => void;
}) {
  const { voices, voiceId, onVoiceChange, onReloadVoices, setVoiceLabStatus, setVoiceLabError } = props;

  const selected = useMemo(() => voices.find((v) => v.voice_id === voiceId), [voices, voiceId]);

  const [name, setName] = useState("My Cloned Voice");
  const [desc, setDesc] = useState("내 목소리 샘플로 클로닝한 보이스");

  const [files, setFiles] = useState<PickedFile[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    return () => {
      files.forEach((x) => URL.revokeObjectURL(x.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(list: FileList | null) {
    if (!list || !list.length) return;
    const next: PickedFile[] = [];
    for (const f of Array.from(list)) {
      const url = URL.createObjectURL(f);
      next.push({ id: uid(), file: f, url });
    }
    setFiles((p) => [...p, ...next]);
  }

  function removeFile(id: string) {
    setFiles((p) => {
      const hit = p.find((x) => x.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return p.filter((x) => x.id !== id);
    });
  }

  function clearAll() {
    setFiles((p) => {
      p.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
  }

  async function submit() {
    const n = name.trim();
    if (!n) return;

    const sampleFiles = files.map((x) => x.file);
    if (!sampleFiles.length) {
      setStatus("error");
      setError("오디오 파일을 1개 이상 추가해 주세요.");
      setVoiceLabStatus("error");
      setVoiceLabError("오디오 파일을 1개 이상 추가해 주세요.");
      return;
    }

    setStatus("loading");
    setError("");
    setResult(null);
    setVoiceLabStatus("loading");
    setVoiceLabError("");

    try {
      const out = await createInstantClonedVoice({
        name: n,
        description: desc,
        files: sampleFiles,
      });

      setResult(out);
      setStatus("ok");
      setVoiceLabStatus("ok");

      // voice_id가 돌아오면 자동 선택 + 리스트 갱신
      if (out && typeof out.voice_id === "string" && out.voice_id.trim()) {
        await onReloadVoices();
        onVoiceChange(out.voice_id);
      } else {
        await onReloadVoices();
      }
    } catch (e: any) {
      setStatus("error");
      setError(String(e?.message ?? e));
      setVoiceLabStatus("error");
      setVoiceLabError(String(e?.message ?? e));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="ts-card p-5">
        <div className="ts-h">
          <div>
            <div className="ts-hTitle">🧬 내 목소리 클로닝 (IVC)</div>
            <div className="ts-hSub">오디오 샘플 업로드 → Voice 생성 → 바로 선택</div>
          </div>
          <span className="ts-pill">{selected ? `selected: ${selected.name}` : "no voice"}</span>
        </div>

        <div className="mt-4 grid gap-3">
          <div>
            <div className="ts-pill inline-flex items-center gap-2">🏷️ voice name</div>
            <input className="ts-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: SeongAn Voice" />
          </div>

          <div>
            <div className="ts-pill inline-flex items-center gap-2">🧾 description (optional)</div>
            <input className="ts-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="예: 차분하고 또렷한 발음" />
          </div>

          <div className="ts-divider" />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="ts-pill inline-flex items-center gap-2">🎙️ 샘플 파일</div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="ts-btn ts-btn-ghost" style={{ cursor: "pointer" }}>
                ➕ 파일 추가
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>
              <button className="ts-btn ts-btn-ghost" onClick={clearAll} disabled={!files.length}>
                🧹 전체 삭제
              </button>
            </div>
          </div>

          {files.length ? (
            <div className="grid gap-3">
              {files.map((x) => (
                <div key={x.id} className="ts-card" style={{ padding: 14 }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{x.file.name}</div>
                    <div className="flex items-center gap-2">
                      <span className="ts-pill">{prettyBytes(x.file.size)}</span>
                      <button className="ts-btn ts-btn-ghost" onClick={() => removeFile(x.id)}>
                        ✖ 제거
                      </button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <audio controls src={x.url} className="w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ts-pill">아직 선택된 파일이 없어요. (mp3/wav/m4a 등 가능)</div>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button className="ts-btn ts-btn-accent" onClick={submit} disabled={status === "loading" || !name.trim() || !files.length}>
              {status === "loading" ? <span className="ts-spinner" /> : "🧬"} 클로닝 생성
            </button>
            <span className="ts-pill">{files.length} files</span>
          </div>

          {status === "error" && error ? (
            <div className="ts-pill" style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}>
              {error}
            </div>
          ) : null}

          {status === "ok" && result ? (
            <div className="ts-card" style={{ padding: 14 }}>
              <div className="text-sm font-semibold">✅ Result</div>
              <pre className="mt-2 text-xs whitespace-pre-wrap" style={{ color: "var(--muted)" }}>
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </section>

      <section className="ts-card p-5">
        <div className="ts-h">
          <div>
            <div className="ts-hTitle">🗂️ 사용 팁</div>
            <div className="ts-hSub">실제 운영에서는 “동의 받은 음성만” 사용</div>
          </div>
          <span className="ts-pill">dev proxy: /api/eleven/voices/add</span>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="ts-pill">
            • 노이즈 적은 환경에서 30초 이상 샘플 여러 개가 가장 안정적이에요.
          </div>
          <div className="ts-pill">
            • 생성 후 상단 Voice Picker에서 바로 선택됩니다.
          </div>
          <div className="ts-pill">
            • 운영 배포(Vercel 등)에서는 dev middleware가 없으니 별도 백엔드(서버/엣지) 프록시가 필요해요.
          </div>
        </div>
      </section>
    </div>
  );
}
