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
  res.end(body);
}

export default async function handler(req: NodeReq, res: NodeRes): Promise<void> {
  const method: string = String(req.method ?? "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.end();
    return;
  }

  if (method !== "GET") {
    send(res, 405, "Method Not Allowed");
    return;
  }

  const upstream: Response = await fetch("http://34.64.208.249:80/ai/swear", { method: "GET" });

  const buf: ArrayBuffer = await upstream.arrayBuffer();
  const out: Uint8Array = new Uint8Array(buf);

  res.statusCode = upstream.status;
  res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json; charset=utf-8");
  res.end(out);
}
