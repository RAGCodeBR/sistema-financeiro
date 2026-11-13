import https from "node:https";
import { Readable } from "node:stream";
import { gzipSync, gunzipSync } from "node:zlib";
import { createNationalTransport } from "../../supabase/functions/_shared/nfse-fiscal/transport.ts";
export function nodeNationalTransport(
  requester: typeof https.request = https.request,
) {
  return createNationalTransport({
    createClient: (cert, key) => {
      const agent = new https.Agent({
        cert,
        key,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        keepAlive: false,
        maxCachedSessions: 0,
      });
      return { agent, close: () => agent.destroy() };
    },
    fetch: (url, options) =>
      new Promise((resolve, reject) => {
        const target = new URL(url);
        if (
          target.protocol !== "https:" ||
          ![
            "sefin.producaorestrita.nfse.gov.br",
            "adn.producaorestrita.nfse.gov.br",
          ].includes(target.hostname)
        ) {
          reject(new Error("HOST_DENIED"));
          return;
        }
        const request = requester(
          target,
          {
            method: options.method,
            headers: {
              ...options.headers,
              ...(typeof options.body === "string"
                ? {
                    "Content-Length": String(
                      Buffer.byteLength(options.body, "utf8"),
                    ),
                  }
                : {}),
            },
            agent: options.client.agent,
            signal: options.signal,
          },
          (response) => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(response.headers))
              if (value !== undefined)
                headers.set(
                  name,
                  Array.isArray(value) ? value.join(",") : String(value),
                );
            resolve(
              new Response(
                [204, 205, 304].includes(response.statusCode || 200)
                  ? null
                  : (Readable.toWeb(response) as ReadableStream),
                { status: response.statusCode || 502, headers },
              ),
            );
          },
        );
        request.on("error", reject);
        if (options.body) request.write(options.body);
        request.end();
      }),
    gzip: (text) => gzipSync(Buffer.from(text, "utf8")).toString("base64"),
    gunzip: (text) =>
      gunzipSync(Buffer.from(text, "base64"), {
        maxOutputLength: 2 * 1024 * 1024,
      }).toString("utf8"),
  });
}
