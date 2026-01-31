// api/ai/swear.ts
import type { IncomingMessage, IncomingHttpHeaders } from "http";

type NodeReq = IncomingMessage & {
  method?: string;
  headers: IncomingHttpHeaders;
};

type NodeRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (data?: string | Uint8Array) => void;
};

function send(res: NodeRes, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function backendOrigin(): string {
  const raw: string = String(process.env.AI_BACKEND_ORIGIN ?? "http://34.64.208.249:80").trim();
  const noSlash: string = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return noSlash;
}

export default async function handler(req: NodeReq, res: NodeRes): Promise<void> {
  const method: string = String(req.method ?? "GET").toUpperCase();

  // (선택) CORS: 같은 도메인에서만 쓰면 굳이 필요 없지만, 유지/보강
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method !== "GET") {
    send(res, 405, "Method Not Allowed");
    return;
  }

  const url: string = `${backendOrigin()}/ai/swear`;

  try {
    const upstream: Response = await fetch(url, { method: "GET" });

    const buf: ArrayBuffer = await upstream.arrayBuffer();
    const out: Uint8Array = new Uint8Array(buf);

    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json; charset=utf-8");
    res.end(out);
  } catch (e: unknown) {
    send(res, 502, `Bad Gateway: ${String(e)}`);
  }
}
