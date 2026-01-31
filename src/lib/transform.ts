// src/lib/transform.ts
export type TransformResponse = {
  original_message: string;
  transformed_message: string;
};

export async function transformCustomerMessage(params: {
  message: string;
  signal?: AbortSignal;
}): Promise<TransformResponse> {
  const r: Response = await fetch("/api/ai/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: params.signal,
    body: JSON.stringify({ message: params.message }),
  });

  if (!r.ok) throw new Error(await safeText(r));

  const data: unknown = await r.json();
  const obj: any = data as any;

  return {
    original_message: String(obj?.original_message ?? params.message),
    transformed_message: String(obj?.transformed_message ?? ""),
  };
}

async function safeText(r: Response): Promise<string> {
  const t: string = await r.text().catch(() => "");
  return t || `${r.status} ${r.statusText}`;
}
