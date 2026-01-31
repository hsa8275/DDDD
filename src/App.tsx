// // src/App.tsx
// import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
// import { fetchLatestCustomerUtterance, type CustomerUtterance } from "./lib/customer";
// import { listVoices, tts, type ElevenVoice, type TonePreset } from "./lib/eleven";
// import { VoicePicker } from "./components/VoicePicker";
// import { VoiceDesignPage } from "./pages/VoiceDesignPage";
// import { VoiceClonePage } from "./pages/VoiceClonePage";
// import { transformCustomerMessage } from "./lib/transform";

// type Status = "idle" | "loading" | "ok" | "error";
// type View = "console" | "voiceDesign" | "voiceClone";

// const LS_PROFILE_KEY = "tonesift.listenProfile.v1";

// function clamp(n: number, min: number, max: number): number {
//   return Math.min(max, Math.max(min, n));
// }

// // eleven.ts presetSettings와 기본 speed 맞추기
// const PRESET_BASE_SPEED: Record<TonePreset, number> = {
//   neutral: 1.0,
//   warm: 0.96,
// };

// function dotClass(status: Status): string {
//   if (status === "loading") return "ts-dot ts-dotLoad";
//   if (status === "error") return "ts-dot ts-dotErr";
//   if (status === "ok") return "ts-dot ts-dotOk";
//   return "ts-dot";
// }

// function mergeStatus(...ss: Status[]): Status {
//   if (ss.some((s: Status) => s === "loading")) return "loading";
//   if (ss.some((s: Status) => s === "error")) return "error";
//   if (ss.some((s: Status) => s === "ok")) return "ok";
//   return "idle";
// }

// export default function App(): ReactElement {
//   const [view, setView] = useState<View>("console");

//   const [voices, setVoices] = useState<ElevenVoice[]>([]);
//   const [voiceId, setVoiceId] = useState<string>("");

//   const [customer, setCustomer] = useState<CustomerUtterance>({
//     text: "미친년아니야?! 야! 배송 빨리해라!",
//     ts: undefined,
//     id: undefined,
//   });

//   const [agentText, setAgentText] = useState<string>("기다리게 해서 정말 죄송합니다. 바로 확인하겠습니다.");

//   const [neutralAudio, setNeutralAudio] = useState<string>("");
//   const [warmAudio, setWarmAudio] = useState<string>("");

//   // ✅ AI 순화 결과(표시 + TTS 입력)
//   const [neutralTransformedText, setNeutralTransformedText] = useState<string>("");

//   // ✅ 상태를 카드별로 분리 + 상단 상태는 합성
//   const [neutralStatus, setNeutralStatus] = useState<Status>("idle");
//   const [warmStatus, setWarmStatus] = useState<Status>("idle");
//   const [voiceLabStatus, setVoiceLabStatus] = useState<Status>("idle");

//   const [neutralError, setNeutralError] = useState<string>("");
//   const [warmError, setWarmError] = useState<string>("");
//   const [voiceLabError, setVoiceLabError] = useState<string>("");

//   const status = useMemo<Status>(() => mergeStatus(neutralStatus, warmStatus, voiceLabStatus), [
//     neutralStatus,
//     warmStatus,
//     voiceLabStatus,
//   ]);

//   const errorMsg = useMemo<string>(() => {
//     return neutralError || warmError || voiceLabError || "";
//   }, [neutralError, warmError, voiceLabError]);

//   const [pulling, setPulling] = useState<boolean>(false);
//   const [autoPull, setAutoPull] = useState<boolean>(false);
//   const [autoNeutral, setAutoNeutral] = useState<boolean>(false);

//   const isAutoRunning: boolean = autoPull && autoNeutral;

//   // 상담원 청취 프로필
//   const [listenPace, setListenPace] = useState<number>(1.0);
//   const [listenPitch, setListenPitch] = useState<number>(1.0);

//   const neutralAudioRef = useRef<HTMLAudioElement | null>(null);
//   const warmAudioRef = useRef<HTMLAudioElement | null>(null);

//   const debounceRef = useRef<number | null>(null);

//   // ✅ 중복 방지 키 (text만으로는 부족해서 id/ts도 섞음)
//   const lastNeutralKeyRef = useRef<string>("");

//   // ✅ 요청 무효화(Stop/새 요청 시 기존 요청 결과 반영 금지)
//   const neutralReqIdRef = useRef<number>(0);
//   const warmReqIdRef = useRef<number>(0);

//   function customerKey(c: CustomerUtterance, overrideText?: string): string {
//     const text: string = String(overrideText ?? c.text ?? "").trim();
//     const idPart: string = c.id ? String(c.id) : "";
//     const tsPart: string = c.ts ? String(c.ts) : "";
//     return `${idPart}::${tsPart}::${text}`;
//   }

//   async function reloadVoices(): Promise<ElevenVoice[]> {
//     const v: ElevenVoice[] = await listVoices();
//     setVoices(v);
//     if (!voiceId && v[0]?.voice_id) setVoiceId(v[0].voice_id);
//     return v;
//   }

//   // localStorage 로드
//   useEffect((): void => {
//     try {
//       const raw: string | null = localStorage.getItem(LS_PROFILE_KEY);
//       if (!raw) return;
//       const data = JSON.parse(raw) as { pace?: number; pitch?: number };
//       if (typeof data.pace === "number") setListenPace(clamp(data.pace, 0.85, 1.15));
//       if (typeof data.pitch === "number") setListenPitch(clamp(data.pitch, 0.85, 1.15));
//     } catch {
//       // ignore
//     }
//   }, []);

//   // localStorage 저장
//   useEffect((): void => {
//     try {
//       localStorage.setItem(LS_PROFILE_KEY, JSON.stringify({ pace: listenPace, pitch: listenPitch }));
//     } catch {
//       // ignore
//     }
//   }, [listenPace, listenPitch]);

//   // 재생 단계 pitch 반영
//   useEffect((): void => {
//     const p: number = clamp(listenPitch, 0.85, 1.15);
//     if (neutralAudioRef.current) neutralAudioRef.current.playbackRate = p;
//     if (warmAudioRef.current) warmAudioRef.current.playbackRate = p;
//   }, [listenPitch, neutralAudio, warmAudio]);

//   useEffect((): (() => void) => {
//     return (): void => {
//       if (neutralAudio) URL.revokeObjectURL(neutralAudio);
//       if (warmAudio) URL.revokeObjectURL(warmAudio);
//       if (debounceRef.current) window.clearTimeout(debounceRef.current);
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   useEffect((): void => {
//     (async (): Promise<void> => {
//       try {
//         await reloadVoices();
//       } catch (e: unknown) {
//         setVoiceLabStatus("error");
//         setVoiceLabError(String(e));
//       }
//     })();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // 고객 텍스트가 바뀌면 순화 결과는 초기화(헷갈림 방지)
//   useEffect((): void => {
//     setNeutralTransformedText("");
//   }, [customer.text, customer.id, customer.ts]);

//   useEffect((): (() => void) | void => {
//     if (!autoPull) return;

//     const ac: AbortController = new AbortController();

//     const tick = async (): Promise<void> => {
//       try {
//         const data: CustomerUtterance = await fetchLatestCustomerUtterance(ac.signal);
//         setCustomer(data);
//       } catch {
//         // ignore
//       }
//     };

//     void tick();
//     const t: number = window.setInterval((): void => void tick(), 3000);
//     return (): void => {
//       window.clearInterval(t);
//       ac.abort();
//     };
//   }, [autoPull]);

//   async function pullCustomerText(): Promise<CustomerUtterance | null> {
//     setPulling(true);
//     setNeutralError("");
//     try {
//       const data: CustomerUtterance = await fetchLatestCustomerUtterance();
//       setCustomer(data);
//       return data;
//     } catch (e: unknown) {
//       setNeutralError(String(e));
//       setNeutralStatus("error");
//       return null;
//     } finally {
//       setPulling(false);
//     }
//   }

//   // pace/pitch 분리 보정
//   function ttsSpeedFor(preset: TonePreset): number {
//     const base: number = PRESET_BASE_SPEED[preset] ?? 1.0;
//     const pace: number = clamp(listenPace, 0.85, 1.15);
//     const pitch: number = clamp(listenPitch, 0.85, 1.15);
//     const speed: number = base * (pace / pitch);
//     return clamp(speed, 0.7, 1.2);
//   }

//   async function generateNeutral(source: "manual" | "auto", overrideText?: string, overrideKey?: string): Promise<void> {
//     const raw: string = String(overrideText ?? customer.text ?? "").trim();
//     if (!voiceId || !raw) return;

//     if (source === "auto" && neutralStatus === "loading") return;

//     const reqId: number = ++neutralReqIdRef.current;
//     setNeutralStatus("loading");
//     setNeutralError("");

//     try {
//       if (neutralAudio) URL.revokeObjectURL(neutralAudio);

//       const transformed: { original_message: string; transformed_message: string } = await transformCustomerMessage({
//         message: raw,
//       });

//       if (reqId !== neutralReqIdRef.current) return;

//       const clean: string = String(transformed.transformed_message ?? "").trim();
//       if (!clean) throw new Error("AI transform returned empty transformed_message");

//       setNeutralTransformedText(clean);

//       const { url } = await tts({
//         text: clean,
//         voiceId,
//         preset: "neutral",
//         speed: ttsSpeedFor("neutral"),
//       });

//       if (reqId !== neutralReqIdRef.current) {
//         URL.revokeObjectURL(url);
//         return;
//       }

//       setNeutralAudio(url);
//       setNeutralStatus("ok");

//       const key: string = overrideKey ?? customerKey(customer, raw);
//       lastNeutralKeyRef.current = key;

//       const p: number = clamp(listenPitch, 0.85, 1.15);
//       window.setTimeout((): void => {
//         if (neutralAudioRef.current) neutralAudioRef.current.playbackRate = p;
//         neutralAudioRef.current?.play().catch((): void => {});
//       }, 80);
//     } catch (e: unknown) {
//       if (reqId !== neutralReqIdRef.current) return;
//       setNeutralStatus("error");
//       setNeutralError(String(e));
//     }
//   }

//   async function generateWarm(): Promise<void> {
//     const text: string = String(agentText ?? "").trim();
//     if (!voiceId || !text) return;

//     const reqId: number = ++warmReqIdRef.current;
//     setWarmStatus("loading");
//     setWarmError("");

//     try {
//       if (warmAudio) URL.revokeObjectURL(warmAudio);

//       const { url } = await tts({
//         text,
//         voiceId,
//         preset: "warm",
//         speed: ttsSpeedFor("warm"),
//       });

//       if (reqId !== warmReqIdRef.current) {
//         URL.revokeObjectURL(url);
//         return;
//       }

//       setWarmAudio(url);
//       setWarmStatus("ok");

//       const p: number = clamp(listenPitch, 0.85, 1.15);
//       window.setTimeout((): void => {
//         if (warmAudioRef.current) warmAudioRef.current.playbackRate = p;
//         warmAudioRef.current?.play().catch((): void => {});
//       }, 80);
//     } catch (e: unknown) {
//       if (reqId !== warmReqIdRef.current) return;
//       setWarmStatus("error");
//       setWarmError(String(e));
//     }
//   }

//   async function startAutoOneTouch(): Promise<void> {
//     setAutoPull(true);
//     setAutoNeutral(true);

//     setNeutralError("");
//     setNeutralTransformedText("");

//     const data: CustomerUtterance | null = await pullCustomerText();
//     const text: string = String(data?.text ?? customer.text ?? "").trim();
//     const key: string = data ? customerKey(data, text) : customerKey(customer, text);

//     lastNeutralKeyRef.current = key;

//     if (text.length > 0) {
//       await generateNeutral("manual", text, key);
//     }
//   }

//   function stopAuto(): void {
//     setAutoPull(false);
//     setAutoNeutral(false);

//     if (debounceRef.current) {
//       window.clearTimeout(debounceRef.current);
//       debounceRef.current = null;
//     }

//     neutralReqIdRef.current += 1;

//     try {
//       if (neutralAudioRef.current) {
//         neutralAudioRef.current.pause();
//         neutralAudioRef.current.currentTime = 0;
//       }
//     } catch {
//       // ignore
//     }

//     setNeutralStatus("idle");
//     setNeutralError("");
//     setNeutralTransformedText("");

//     if (neutralAudio) {
//       URL.revokeObjectURL(neutralAudio);
//       setNeutralAudio("");
//     }
//   }

//   useEffect((): (() => void) | void => {
//     if (!autoNeutral) return;

//     const text: string = String(customer.text ?? "").trim();
//     if (!voiceId || !text || text.length < 2) return;

//     const key: string = customerKey(customer);
//     if (key === lastNeutralKeyRef.current) return;

//     if (debounceRef.current) window.clearTimeout(debounceRef.current);

//     debounceRef.current = window.setTimeout((): void => {
//       void generateNeutral("auto", text, key);
//     }, 650);

//     return (): void => {
//       if (debounceRef.current) window.clearTimeout(debounceRef.current);
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [customer.text, customer.id, customer.ts, voiceId, autoNeutral]);

//   return (
//     <div className="min-h-screen">
//       <header className="mx-auto w-full max-w-6xl px-5 pt-6">
//         <div className="ts-cardHero px-5 py-4">
//           <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
//             <div className="flex items-center gap-3">
//               <div
//                 className="h-11 w-11 rounded-2xl"
//                 style={{
//                   background:
//                     "radial-gradient(16px 16px at 30% 30%, rgba(255,122,144,.95), rgba(255,77,109,.22)), linear-gradient(180deg, rgba(255,77,109,.18), rgba(255,255,255,.03))",
//                   border: "1px solid rgba(255,77,109,.35)",
//                   boxShadow: "0 0 0 3px rgba(255,77,109,.10)",
//                 }}
//               />
//               <div>
//                 <div className="flex flex-wrap items-center gap-2">
//                   <div className="text-lg font-semibold tracking-tight">ToneShift</div>
//                   <span className="ts-pill ts-pillStrong">상담원용 콘솔</span>
//                   <span className="ts-pill">
//                     <span className={dotClass(status)} />{" "}
//                     <span className="ml-2">{status === "loading" ? "generating" : status}</span>
//                   </span>
//                   {isAutoRunning ? <span className="ts-pill">🟢 AUTO</span> : <span className="ts-pill">⚪️ manual</span>}
//                 </div>

//                 <div className="mt-2 ts-tabs">
//                   <button
//                     type="button"
//                     className={`ts-tab ${view === "console" ? "ts-tabActive" : ""}`}
//                     onClick={() => setView("console")}
//                   >
//                     🧩 Console
//                   </button>
//                   <button
//                     type="button"
//                     className={`ts-tab ${view === "voiceDesign" ? "ts-tabActive" : ""}`}
//                     onClick={() => setView("voiceDesign")}
//                   >
//                     🎛️ 목소리만들기
//                   </button>
//                   <button
//                     type="button"
//                     className={`ts-tab ${view === "voiceClone" ? "ts-tabActive" : ""}`}
//                     onClick={() => setView("voiceClone")}
//                   >
//                     🧬 내목소리 클로닝
//                   </button>
//                 </div>

//                 <div className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
//                   고객의 말은 그대로, 톤만 바꾼다 <span className="ts-kbd ml-2">MVP</span>
//                 </div>
//               </div>
//             </div>

//             <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
//               <div style={{ width: 380, maxWidth: "100%" }}>
//                 <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} placeholder="Voice 선택" />
//               </div>

//               <div className="flex items-center gap-2">
//                 <button
//                   type="button"
//                   className="ts-btn ts-btn-accent"
//                   onClick={() => void startAutoOneTouch()}
//                   disabled={isAutoRunning || voiceLabStatus === "loading"}
//                   title="원터치: 최신 고객 텍스트 수집 → 순화 → 말하기 + 이후 자동 반복"
//                 >
//                   ▶️ 시작
//                 </button>
//                 <button
//                   type="button"
//                   className="ts-btn ts-btn-ghost"
//                   onClick={stopAuto}
//                   disabled={!isAutoRunning && neutralStatus !== "loading"}
//                   title="자동 수집/자동 말하기 중지"
//                 >
//                   ⏹ 종료
//                 </button>
//               </div>

//               <button
//                 className="ts-btn ts-btn-ghost"
//                 onClick={() => {
//                   setListenPace(1.0);
//                   setListenPitch(1.0);
//                 }}
//                 title="청취 프로필 초기화"
//               >
//                 ↩️ Reset
//               </button>
//             </div>
//           </div>

//           <div className="ts-divider" />

//           <div className="grid gap-3 md:grid-cols-3">
//             <div className="md:col-span-1">
//               <div className="ts-pill inline-flex items-center gap-2">🎧 청취 프로필</div>
//               <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
//                 Pace=체감 속도, Pitch=체감 높낮이 (저장됨)
//               </div>
//               <div className="mt-3 flex flex-wrap gap-2">
//                 <span className="ts-pill">
//                   TTS speed: {ttsSpeedFor("neutral").toFixed(2)} / {ttsSpeedFor("warm").toFixed(2)}
//                 </span>
//                 <span className="ts-pill">playbackRate: {clamp(listenPitch, 0.85, 1.15).toFixed(2)}</span>
//               </div>
//             </div>

//             <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
//               <RangeRow label="Pace (말 빠르기)" value={listenPace} min={0.85} max={1.15} step={0.01} onChange={setListenPace} />
//               <RangeRow label="Pitch (높낮이)" value={listenPitch} min={0.85} max={1.15} step={0.01} onChange={setListenPitch} />
//             </div>
//           </div>

//           {status === "error" && errorMsg ? (
//             <div
//               className="mt-4 rounded-2xl border px-4 py-3 text-sm"
//               style={{
//                 borderColor: "rgba(255,77,109,.35)",
//                 background: "rgba(255,77,109,.08)",
//                 color: "rgba(244,245,248,.9)",
//               }}
//             >
//               <div className="font-semibold" style={{ color: "var(--accent2)" }}>
//                 오류
//               </div>
//               <div className="mt-1" style={{ color: "var(--muted)" }}>
//                 {errorMsg}
//               </div>
//             </div>
//           ) : null}
//         </div>
//       </header>

//       <main className="mx-auto w-full max-w-6xl px-5 pb-12 pt-6">
//         {view === "voiceDesign" ? (
//           <VoiceDesignPage
//             voices={voices}
//             voiceId={voiceId}
//             onVoiceChange={setVoiceId}
//             onReloadVoices={reloadVoices}
//             playbackRate={clamp(listenPitch, 0.85, 1.15)}
//             setVoiceLabStatus={setVoiceLabStatus}
//             setVoiceLabError={setVoiceLabError}
//           />
//         ) : view === "voiceClone" ? (
//           <VoiceClonePage
//             voices={voices}
//             voiceId={voiceId}
//             onVoiceChange={setVoiceId}
//             onReloadVoices={reloadVoices}
//             setVoiceLabStatus={setVoiceLabStatus}
//             setVoiceLabError={setVoiceLabError}
//           />
//         ) : (
//           <div className="grid gap-5 lg:grid-cols-2">
//             <section className="ts-card p-5">
//               <div className="ts-h">
//                 <div>
//                   <div className="ts-hTitle">😡 고객 텍스트 → 🤝 AI 순화 → 🧊 중화 음성</div>
//                   <div className="ts-hSub">START를 누르면 자동 수집+자동 말하기</div>
//                 </div>
//                 <span className="ts-pill">Preset: Neutral</span>
//               </div>

//               <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
//                 <div className="flex flex-wrap items-center gap-3">
//                   <button className="ts-btn" onClick={() => void pullCustomerText()} disabled={pulling}>
//                     {pulling ? <span className="ts-spinner" /> : "⬇️"} 더미 불러오기
//                   </button>

//                   <Switch checked={autoPull} onChange={setAutoPull} label="3초 자동 갱신" />
//                   <Switch checked={autoNeutral} onChange={setAutoNeutral} label="텍스트 변경 시 자동 음성" />
//                 </div>

//                 <div className="flex flex-wrap items-center gap-2">
//                   {customer.id ? <span className="ts-pill">id: {customer.id}</span> : null}
//                   {customer.ts ? <span className="ts-pill">ts: {customer.ts}</span> : null}
//                 </div>
//               </div>

//               <div className="mt-4">
//                 <textarea
//                   className="ts-input ts-textarea"
//                   value={customer.text}
//                   onChange={(e) => setCustomer((prev: CustomerUtterance) => ({ ...prev, text: e.target.value }))}
//                 />
//               </div>

//               {neutralTransformedText ? (
//                 <div className="mt-3">
//                   <div className="ts-pill inline-flex items-center gap-2">🤝 transformed_message</div>
//                   <div className="mt-2">
//                     <textarea className="ts-input ts-textarea" value={neutralTransformedText} readOnly />
//                   </div>
//                 </div>
//               ) : null}

//               <div className="mt-4 flex flex-wrap items-center gap-2">
//                 <button
//                   className="ts-btn ts-btn-accent"
//                   onClick={() => void generateNeutral("manual")}
//                   disabled={neutralStatus === "loading"}
//                 >
//                   {neutralStatus === "loading" ? <span className="ts-spinner" /> : "🧊"} 중화 음성 생성(순화 포함)
//                 </button>
//               </div>

//               <div className="mt-3">
//                 {neutralStatus === "error" && neutralError ? (
//                   <div
//                     className="ts-pill"
//                     style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}
//                   >
//                     {neutralError}
//                   </div>
//                 ) : null}
//               </div>

//               <div className="mt-4">
//                 {neutralAudio ? (
//                   <div className="ts-audioBox">
//                     <div className="ts-audioTop">
//                       <div className="ts-audioTitle">Output: Neutral</div>
//                       <span className="ts-pill">Pitch 적용됨</span>
//                     </div>
//                     <audio ref={neutralAudioRef} controls src={neutralAudio} className="w-full" />
//                   </div>
//                 ) : (
//                   <div className="ts-pill">아직 생성된 음성이 없어요.</div>
//                 )}
//               </div>
//             </section>

//             <section className="ts-card p-5">
//               <div className="ts-h">
//                 <div>
//                   <div className="ts-hTitle">🧑‍💼 상담사 문장 → 🫂 공감 톤</div>
//                   <div className="ts-hSub">같은 문장, 더 따뜻하게</div>
//                 </div>
//                 <span className="ts-pill">Preset: Warm</span>
//               </div>

//               <div className="mt-4">
//                 <textarea className="ts-input ts-textarea" value={agentText} onChange={(e) => setAgentText(e.target.value)} />
//               </div>

//               <div className="mt-4 flex flex-wrap items-center gap-2">
//                 <button className="ts-btn ts-btn-accent" onClick={() => void generateWarm()} disabled={warmStatus === "loading"}>
//                   {warmStatus === "loading" ? <span className="ts-spinner" /> : "🫂"} 공감 음성 생성
//                 </button>
//               </div>

//               <div className="mt-3">
//                 {warmStatus === "error" && warmError ? (
//                   <div
//                     className="ts-pill"
//                     style={{ borderColor: "rgba(255,77,109,.35)", color: "rgba(255,122,144,.95)" }}
//                   >
//                     {warmError}
//                   </div>
//                 ) : null}
//               </div>

//               <div className="mt-4">
//                 {warmAudio ? (
//                   <div className="ts-audioBox">
//                     <div className="ts-audioTop">
//                       <div className="ts-audioTitle">Output: Warm</div>
//                       <span className="ts-pill">Pitch 적용됨</span>
//                     </div>
//                     <audio ref={warmAudioRef} controls src={warmAudio} className="w-full" />
//                   </div>
//                 ) : (
//                   <div className="ts-pill">아직 생성된 음성이 없어요.</div>
//                 )}
//               </div>
//             </section>
//           </div>
//         )}
//       </main>
//     </div>
//   );
// }

// function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }): ReactElement {
//   const { checked, onChange, label } = props;
//   return (
//     <label className="ts-switch">
//       <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
//       <span className="ts-switchTrack">
//         <span className="ts-switchThumb" />
//       </span>
//       <span className="ts-switchText">{label}</span>
//     </label>
//   );
// }

// function RangeRow(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }): ReactElement {
//   const { label, value, min, max, step, onChange } = props;

//   return (
//     <div className="ts-rangeWrap">
//       <div className="ts-rangeTop">
//         <div className="ts-rangeLabel">{label}</div>
//         <span className="ts-pill ts-rangeValue">{value.toFixed(2)}</span>
//       </div>
//       <input
//         className="ts-range"
//         type="range"
//         min={min}
//         max={max}
//         step={step}
//         value={value}
//         onChange={(e) => onChange(Number(e.target.value))}
//       />
//     </div>
//   );
// }

// src/App.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchLatestCustomerUtterance, type CustomerUtterance } from "./lib/customer";
import { listVoices, tts, type ElevenVoice, type TonePreset } from "./lib/eleven";
import { VoicePicker } from "./components/VoicePicker";
import { VoiceDesignPage } from "./pages/VoiceDesignPage";
import { VoiceClonePage } from "./pages/VoiceClonePage";
import { transformCustomerMessage } from "./lib/transform";

type Status = "idle" | "loading" | "ok" | "error";
type View = "console" | "voiceDesign" | "voiceClone";

const LS_PROFILE_KEY = "tonesift.listenProfile.v1";

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

export default function App() {
  const [view, setView] = useState<View>("console");

  const [voices, setVoices] = useState<ElevenVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");

  const [customer, setCustomer] = useState<CustomerUtterance>({
    text: "미친년아니야?! 야! 배송 빨리해라!",
    ts: undefined,
    id: undefined,
  });

  const [agentText, setAgentText] = useState<string>("기다리게 해서 정말 죄송합니다. 바로 확인하겠습니다.");

  const [neutralAudio, setNeutralAudio] = useState<string>("");
  const [warmAudio, setWarmAudio] = useState<string>("");

  const [neutralTransformedText, setNeutralTransformedText] = useState<string>("");

  const [neutralStatus, setNeutralStatus] = useState<Status>("idle");
  const [warmStatus, setWarmStatus] = useState<Status>("idle");
  const [voiceLabStatus, setVoiceLabStatus] = useState<Status>("idle");

  const [neutralError, setNeutralError] = useState<string>("");
  const [warmError, setWarmError] = useState<string>("");
  const [voiceLabError, setVoiceLabError] = useState<string>("");

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

  const [pulling, setPulling] = useState<boolean>(false);
  const [autoPull, setAutoPull] = useState<boolean>(false);
  const [autoNeutral, setAutoNeutral] = useState<boolean>(false);

  const isAutoRunning: boolean = autoPull && autoNeutral;

  const [listenPace, setListenPace] = useState<number>(1.0);
  const [listenPitch, setListenPitch] = useState<number>(1.0);

  const neutralAudioRef = useRef<HTMLAudioElement | null>(null);
  const warmAudioRef = useRef<HTMLAudioElement | null>(null);

  const debounceRef = useRef<number | null>(null);
  const lastNeutralKeyRef = useRef<string>("");

  const neutralReqIdRef = useRef<number>(0);
  const warmReqIdRef = useRef<number>(0);

  function customerKey(c: CustomerUtterance, overrideText?: string): string {
    const text: string = String(overrideText ?? c.text ?? "").trim();
    const idPart: string = c.id ? String(c.id) : "";
    const tsPart: string = c.ts ? String(c.ts) : "";
    return `${idPart}::${tsPart}::${text}`;
  }

  async function reloadVoices(): Promise<ElevenVoice[]> {
    const v: ElevenVoice[] = await listVoices();
    setVoices(v);
    if (!voiceId && v[0]?.voice_id) setVoiceId(v[0].voice_id);
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
    setNeutralTransformedText("");
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

  async function pullCustomerText(): Promise<CustomerUtterance | null> {
    setPulling(true);
    setNeutralError("");
    try {
      const data: CustomerUtterance = await fetchLatestCustomerUtterance();
      setCustomer(data);
      return data;
    } catch (e: unknown) {
      setNeutralError(String(e));
      setNeutralStatus("error");
      return null;
    } finally {
      setPulling(false);
    }
  }

  function ttsSpeedFor(preset: TonePreset): number {
    const base: number = PRESET_BASE_SPEED[preset] ?? 1.0;
    const pace: number = clamp(listenPace, 0.85, 1.15);
    const pitch: number = clamp(listenPitch, 0.85, 1.15);
    const speed: number = base * (pace / pitch);
    return clamp(speed, 0.7, 1.2);
  }

  async function generateNeutral(source: "manual" | "auto", overrideText?: string, overrideKey?: string): Promise<void> {
    const raw: string = String(overrideText ?? customer.text ?? "").trim();
    if (!voiceId || !raw) return;

    if (source === "auto" && neutralStatus === "loading") return;

    const reqId: number = ++neutralReqIdRef.current;
    setNeutralStatus("loading");
    setNeutralError("");

    try {
      if (neutralAudio) URL.revokeObjectURL(neutralAudio);

      const transformed = await transformCustomerMessage({ message: raw });
      if (reqId !== neutralReqIdRef.current) return;

      const clean: string = String(transformed.transformed_message ?? "").trim();
      if (!clean) throw new Error("AI transform returned empty transformed_message");

      setNeutralTransformedText(clean);

      const { url } = await tts({
        text: clean,
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

      const key: string = overrideKey ?? customerKey(customer, raw);
      lastNeutralKeyRef.current = key;

      const p: number = clamp(listenPitch, 0.85, 1.15);
      window.setTimeout(() => {
        if (neutralAudioRef.current) neutralAudioRef.current.playbackRate = p;
        neutralAudioRef.current?.play().catch(() => {});
      }, 80);
    } catch (e: unknown) {
      if (reqId !== neutralReqIdRef.current) return;
      setNeutralStatus("error");
      setNeutralError(String(e));
    }
  }

  async function generateWarm(): Promise<void> {
    const text: string = String(agentText ?? "").trim();
    if (!voiceId || !text) return;

    const reqId: number = ++warmReqIdRef.current;
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

      const p: number = clamp(listenPitch, 0.85, 1.15);
      window.setTimeout(() => {
        if (warmAudioRef.current) warmAudioRef.current.playbackRate = p;
        warmAudioRef.current?.play().catch(() => {});
      }, 80);
    } catch (e: unknown) {
      if (reqId !== warmReqIdRef.current) return;
      setWarmStatus("error");
      setWarmError(String(e));
    }
  }

  async function startAutoOneTouch(): Promise<void> {
    setAutoPull(true);
    setAutoNeutral(true);

    setNeutralError("");
    setNeutralTransformedText("");

    const data: CustomerUtterance | null = await pullCustomerText();
    const text: string = String(data?.text ?? customer.text ?? "").trim();
    const key: string = data ? customerKey(data, text) : customerKey(customer, text);

    lastNeutralKeyRef.current = key;

    if (text.length > 0) {
      await generateNeutral("manual", text, key);
    }
  }

  function stopAuto(): void {
    setAutoPull(false);
    setAutoNeutral(false);

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    neutralReqIdRef.current += 1;

    try {
      if (neutralAudioRef.current) {
        neutralAudioRef.current.pause();
        neutralAudioRef.current.currentTime = 0;
      }
    } catch {
      // ignore
    }

    setNeutralStatus("idle");
    setNeutralError("");
    setNeutralTransformedText("");

    if (neutralAudio) {
      URL.revokeObjectURL(neutralAudio);
      setNeutralAudio("");
    }
  }

  useEffect(() => {
    if (!autoNeutral) return;

    const text: string = String(customer.text ?? "").trim();
    if (!voiceId || !text || text.length < 2) return;

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
  }, [customer.text, customer.id, customer.ts, voiceId, autoNeutral]);

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
                  {isAutoRunning ? <span className="ts-pill">🟢 AUTO</span> : <span className="ts-pill">⚪️ manual</span>}
                </div>

                <div className="mt-2 ts-tabs">
                  <button type="button" className={`ts-tab ${view === "console" ? "ts-tabActive" : ""}`} onClick={() => setView("console")}>
                    🧩 Console
                  </button>
                  <button type="button" className={`ts-tab ${view === "voiceDesign" ? "ts-tabActive" : ""}`} onClick={() => setView("voiceDesign")}>
                    🎛️ 목소리만들기
                  </button>
                  <button type="button" className={`ts-tab ${view === "voiceClone" ? "ts-tabActive" : ""}`} onClick={() => setView("voiceClone")}>
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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="ts-btn ts-btn-accent"
                  onClick={() => void startAutoOneTouch()}
                  disabled={isAutoRunning || voiceLabStatus === "loading"}
                  title="원터치: 최신 고객 텍스트 수집 → 순화 → 말하기 + 이후 자동 반복"
                >
                  ▶️ 시작
                </button>
                <button
                  type="button"
                  className="ts-btn ts-btn-ghost"
                  onClick={stopAuto}
                  disabled={!isAutoRunning && neutralStatus !== "loading"}
                  title="자동 수집/자동 말하기 중지"
                >
                  ⏹ 종료
                </button>
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
                  <div className="ts-hTitle">😡 고객 텍스트 → 🤝 AI 순화 → 🧊 중화 음성</div>
                  <div className="ts-hSub">START를 누르면 자동 수집+자동 말하기</div>
                </div>
                <span className="ts-pill">Preset: Neutral</span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button className="ts-btn" onClick={() => void pullCustomerText()} disabled={pulling}>
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
                <textarea
                  className="ts-input ts-textarea"
                  value={customer.text}
                  onChange={(e) => setCustomer((prev: CustomerUtterance) => ({ ...prev, text: e.target.value }))}
                />
              </div>

              {neutralTransformedText ? (
                <div className="mt-3">
                  <div className="ts-pill inline-flex items-center gap-2">🤝 transformed_message</div>
                  <div className="mt-2">
                    <textarea className="ts-input ts-textarea" value={neutralTransformedText} readOnly />
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className="ts-btn ts-btn-accent" onClick={() => void generateNeutral("manual")} disabled={neutralStatus === "loading"}>
                  {neutralStatus === "loading" ? <span className="ts-spinner" /> : "🧊"} 중화 음성 생성(순화 포함)
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
                <button className="ts-btn ts-btn-accent" onClick={() => void generateWarm()} disabled={warmStatus === "loading"}>
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
