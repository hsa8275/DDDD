// api/ai/swear.ts
import type { IncomingMessage, IncomingHttpHeaders } from "http";

type NodeReq = IncomingMessage & {
  method?: string;
  headers: IncomingHttpHeaders;
};

type NodeRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (data?: string) => void;
};

type ErrorCause = {
  code?: string;
  errno?: number;
  syscall?: string;
  address?: string;
  port?: number;
};

function getOrigin(req: NodeReq): string {
  const raw: string | string[] | undefined = req.headers.origin;
  if (typeof raw === "string" && raw.trim()) return raw;
  return "*";
}

function setCors(req: NodeReq, res: NodeRes): void {
  const origin: string = getOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res: NodeRes, status: number, obj: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function asCause(e: unknown): ErrorCause {
  if (typeof e !== "object" || e === null) return {};
  const anyE = e as { cause?: unknown };
  const c = anyE.cause;
  if (typeof c !== "object" || c === null) return {};

  const cc = c as Partial<ErrorCause>;
  return {
    code: typeof cc.code === "string" ? cc.code : undefined,
    errno: typeof cc.errno === "number" ? cc.errno : undefined,
    syscall: typeof cc.syscall === "string" ? cc.syscall : undefined,
    address: typeof cc.address === "string" ? cc.address : undefined,
    port: typeof cc.port === "number" ? cc.port : undefined,
  };
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ac: AbortController = new AbortController();
  const id: ReturnType<typeof setTimeout> = setTimeout((): void => ac.abort(), ms);
  return {
    signal: ac.signal,
    cancel: (): void => clearTimeout(id),
  };
}

export default async function handler(req: NodeReq, res: NodeRes): Promise<void> {
  const method: string = String(req.method ?? "GET").toUpperCase();

  setCors(req, res);

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end("");
    return;
  }

  if (method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const { signal, cancel } = timeoutSignal(8000);

  try {
    const upstream: Response = await fetch("http://34.64.208.249:80/ai/swear", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });

    const text: string = await upstream.text();

    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    const cause: ErrorCause = asCause(e);
    sendJson(res, 502, {
      ok: false,
      error: "bad_gateway",
      message: msg,
      cause,
      hint:
        "업스트림(34.64.208.249:80)이 Vercel에서 접근 불가일 가능성이 큼: 방화벽/바인딩/서버다운 확인",
    });
  } finally {
    cancel();
  }
}
