export type GetScribeTokenOptions = {
  modelId?: string;
  ttlSecs?: number;
  signal?: AbortSignal;
};

type GetScribeTokenResponse = {
  token?: unknown;
};

export async function getScribeToken(options?: GetScribeTokenOptions): Promise<string> {
  const modelId: string = options?.modelId ?? "scribe_v2_realtime";
  const ttlSecs: number = options?.ttlSecs ?? 300;

  const res: Response = await fetch("/api/eleven/get-scribe-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId, ttlSecs }),
    signal: options?.signal,
  });

  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const detail: string = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`getScribeToken failed: ${res.status} ${detail}`);
  }

  const tokenUnknown: unknown =
    data && typeof data === "object" ? (data as GetScribeTokenResponse).token : undefined;

  if (typeof tokenUnknown !== "string" || tokenUnknown.trim().length === 0) {
    throw new Error("getScribeToken: invalid token response");
  }

  return tokenUnknown;
}
