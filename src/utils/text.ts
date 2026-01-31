export function hasHangul(input: string) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(input);
}

export function clampText(input: string, maxLen = 500) {
  const t = (input ?? "").trim();
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}
