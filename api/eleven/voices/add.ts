// api/eleven/voices/add.ts
import type { IncomingMessage } from "http";
import type { IncomingHttpHeaders } from "http";

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
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.end();
    return;
  }

  if (method !== "POST") {
    send(res, 405, "Method Not Allowed");
    return;
  }

  const apiKey: string = process.env.ELEVENLABS_API_KEY ?? process.env.XI_API_KEY ?? "";
  if (!apiKey) {
    send(res, 500, "Missing ELEVENLABS_API_KEY");
    return;
  }

  const contentTypeHeader: unknown = req.headers["content-type"];
  const contentType: string = typeof contentTypeHeader === "string" ? contentTypeHeader : "";
  if (!contentType.includes("multipart/form-data")) {
    send(res, 400, "Content-Type must be multipart/form-data");
    return;
  }

  const upstream = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": contentType,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: req as unknown as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    duplex: "half" as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const buf: ArrayBuffer = await upstream.arrayBuffer();
  const out: Uint8Array = new Uint8Array(buf);

  res.statusCode = upstream.status;
  res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json; charset=utf-8");
  res.end(out);
}
