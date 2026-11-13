// Local bootstrap: private values go only to the child process environment.
// No certificate/key is sent to the browser or written to the repository.
import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
try {
  try {
    const r = await fetch("http://127.0.0.1:8789/health", {
      signal: AbortSignal.timeout(1000),
    });
    const s = await r.json();
    if (
      r.ok &&
      s.environment === 2 &&
      s.productionEnabled === false &&
      s.authConfigured === true
    ) {
      console.log("Serviço local de homologação já está ativo.");
      process.exit(0);
    }
  } catch {}
  const config = Object.fromEntries(
    fs
      .readFileSync(".local/nfse-certificate-secrets.env", "utf8")
      .split(/\r?\n/)
      .filter(
        (line) => line.trim() && !line.startsWith("#") && line.includes("="),
      )
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
  const result = execFileSync(
      process.execPath,
      [
        "node_modules/supabase/dist/supabase.js",
        "projects",
        "api-keys",
        "--project-ref",
        "tzpoveyjetfobzeeybqu",
        "--reveal",
        "--output",
        "json",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    ),
    keys = JSON.parse(result);
  const service =
    keys.find((k) => k.type === "secret")?.api_key ||
    keys.find((k) => k.name === "service_role")?.api_key;
  if (!service) throw new Error();
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "server/nfse/index.ts"],
    {
      env: {
        ...process.env,
        ...config,
        SUPABASE_URL: "https://tzpoveyjetfobzeeybqu.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: service,
        NFSE_NODE_HOST: "127.0.0.1",
        NFSE_NODE_PORT: "8789",
        PORT: "8789",
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code || 0));
} catch {
  console.error(
    "Não foi possível iniciar a homologação local. Confira a configuração privada em .local e o acesso do Supabase CLI. Nenhuma credencial deve ser enviada pelo chat.",
  );
  process.exitCode = 1;
}
