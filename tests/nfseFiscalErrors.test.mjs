import assert from "node:assert/strict";
import { test } from "node:test";
import { nfseFiscalError } from "../src/lib/nfseFiscalErrors.ts";
test("fiscal client distinguishes runtime CPU failures from a missing deployment and does not expose gateway internals", () => {
  assert.match(
    nfseFiscalError(
      { code: "WORKER_LIMIT", message: "private runtime detail" },
      546,
    ),
    /limite de processamento/,
  );
  assert.doesNotMatch(
    nfseFiscalError({ code: "WORKER_LIMIT" }, 546),
    /não foi ativado|não foi encontrado/,
  );
  assert.match(
    nfseFiscalError({ code: "BOOT_ERROR" }, 503),
    /não conseguiu iniciar/,
  );
  assert.match(nfseFiscalError({}, 404), /não foi encontrado/);
  assert.match(nfseFiscalError({ message: "private detail" }, 503), /HTTP 503/);
  assert.doesNotMatch(
    nfseFiscalError({ message: "private detail" }, 503),
    /private/,
  );
  assert.equal(
    nfseFiscalError({ error: "Confira os dados do cliente." }, 422),
    "Confira os dados do cliente.",
  );
  assert.match(nfseFiscalError({}, 401), /sessão/);
});
