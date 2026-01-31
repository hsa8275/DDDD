import { useCallback, useEffect, useRef, useState } from "react";

export type SpeakPreset = "angry" | "neutral" | "warm";

type SpeakOptions = {
  lang?: string; // "ko-KR"
  preset: SpeakPreset;
};

function isKorean(text: string) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text);
}

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const lastUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    } finally {
      lastUtteranceRef.current = null;
      setIsSpeaking(false);
    }
  }, []);

  const speak = useCallback(
    (textRaw: string, opts: SpeakOptions) => {
      const text = (textRaw ?? "").trim();
      if (!text) return;

      stop();

      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang ?? (isKorean(text) ? "ko-KR" : "en-US");

      // 프리셋: “차이”가 확 나게
      if (opts.preset === "angry") {
        u.rate = 1.12;
        u.pitch = 1.22;
        u.volume = 1;
      } else if (opts.preset === "neutral") {
        u.rate = 0.98;
        u.pitch = 0.92;
        u.volume = 1;
      } else {
        // warm
        u.rate = 0.92;
        u.pitch = 0.90;
        u.volume = 1;
      }

      u.onstart = () => setIsSpeaking(true);
      u.onend = () => setIsSpeaking(false);
      u.onerror = () => setIsSpeaking(false);

      lastUtteranceRef.current = u;
      window.speechSynthesis.speak(u);
    },
    [stop]
  );

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { speak, stop, isSpeaking };
}
