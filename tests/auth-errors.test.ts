import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthFailure, isTransientFailure } from "@/lib/auth/errors";

test("a refused access token is an auth failure, not a transient one", () => {
  assert.equal(isAuthFailure({ code: "PGRST301", message: "JWT expired" }), true);
  assert.equal(isAuthFailure({ code: "PGRST303", message: "JWT claim" }), true);
  assert.equal(isAuthFailure({ code: "", message: "Invalid JWT" }), true);
  assert.equal(isAuthFailure({ code: "", message: "boom" }, 401), true);
  assert.equal(isTransientFailure({ code: "PGRST301", message: "JWT expired" }), false);
});

test("a network error or a 5xx is transient: it must not sign anyone out", () => {
  assert.equal(isTransientFailure({ code: "", message: "TypeError: fetch failed" }), true);
  assert.equal(isTransientFailure({ code: "", message: "boom" }, 503), true);
  assert.equal(isTransientFailure({ code: "", message: "boom" }, 429), true);
  assert.equal(isTransientFailure({ name: "AuthRetryableFetchError", message: "x", status: 0 }), true);
  assert.equal(isTransientFailure({ code: "", message: "request timed out" }), true);
  assert.equal(isAuthFailure({ code: "", message: "TypeError: fetch failed" }), false);
  assert.equal(isAuthFailure({ code: "", message: "boom" }, 503), false);
});

test("other errors are neither", () => {
  assert.equal(isAuthFailure({ code: "42501", message: "permission denied" }), false);
  assert.equal(isTransientFailure({ code: "42501", message: "permission denied" }, 403), false);
  assert.equal(isAuthFailure(null), false);
  assert.equal(isTransientFailure(undefined), false);
});
