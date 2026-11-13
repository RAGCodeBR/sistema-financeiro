import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFiscalAuthentication,
  validateFiscalServerAccess,
} from "../server/nfse/auth.ts";
import { createFiscalHandler } from "../supabase/functions/_shared/nfse-fiscal/handler.ts";
function client({
  authError = null,
  profileError = null,
  user = { id: "user-id" },
  profile = {
    id: "user-id",
    role: "master",
    allowed_units: [],
    hidden_screens: [],
  },
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from: () => ({
      select: () => ({
        limit: async () => ({ error: profileError }),
        eq: () => ({
          single: async () => ({ data: profile, error: profileError }),
        }),
      }),
    }),
  };
}
test("invalid server keys are infrastructure errors and never masquerade as expired user sessions", async () => {
  const keyError = { status: 401, message: "Invalid API key" };
  await assert.rejects(
    createFiscalAuthentication(client({ authError: keyError }))("user-jwt"),
    (error) => error.code === "SERVER_AUTH_CONFIG" && error.status === 503,
  );
  await assert.rejects(
    validateFiscalServerAccess(client({ profileError: keyError })),
    (error) => error.code === "SERVER_AUTH_CONFIG",
  );
});
test("expired user JWTs, unavailable authentication and missing profiles are distinguished", async () => {
  assert.equal(
    await createFiscalAuthentication(
      client({ authError: { status: 401, code: "bad_jwt" } }),
    )("expired"),
    null,
  );
  await assert.rejects(
    createFiscalAuthentication(
      client({ authError: { status: 503, name: "AuthRetryableFetchError" } }),
    )("jwt"),
    (error) => error.code === "AUTH_UNAVAILABLE",
  );
  await assert.rejects(
    createFiscalAuthentication(client({ profileError: { code: "PGRST116" } }))(
      "jwt",
    ),
    (error) => error.code === "FORBIDDEN",
  );
  await assert.rejects(
    createFiscalAuthentication(
      client({ profileError: { code: "FETCH_FAILED" } }),
    )("jwt"),
    (error) => error.code === "AUTH_UNAVAILABLE",
  );
});
test("a valid login returns permissions from the authoritative profile and supports startup validation", async () => {
  assert.deepEqual(await createFiscalAuthentication(client())("jwt"), {
    id: "user-id",
    role: "master",
    allowedUnits: [],
    hiddenScreens: [],
  });
  await validateFiscalServerAccess(client());
});
test("the fiscal HTTP response reports invalid server configuration as 503 rather than logging out the user", async () => {
  const handler = createFiscalHandler({
    origins: ["http://localhost:5173"],
    authenticate: createFiscalAuthentication(
      client({ authError: { status: 401, message: "Invalid API key" } }),
    ),
  });
  const response = await handler(
    new Request("http://localhost/nfse-fiscal", {
      headers: {
        origin: "http://localhost:5173",
        authorization: "Bearer user-jwt",
      },
    }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "SERVER_AUTH_CONFIG");
  assert.doesNotMatch(body.error, /sessão expirou/i);
});
