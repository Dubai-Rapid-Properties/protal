import { test } from "node:test";
import assert from "node:assert/strict";
import { env } from "@/lib/env";
import { rebuildWebsite } from "@/lib/website";

type Call = { url: string; init?: RequestInit };

/** Runs rebuildWebsite with the given settings and a fetch that records the call. */
async function rebuild(hook: string | undefined, token: string | undefined, status = 204) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  Object.assign(env, { websiteDeployHookUrl: hook, websiteDeployGithubToken: token });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status });
  }) as typeof fetch;
  try {
    return { result: await rebuildWebsite(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const DISPATCH = "https://api.github.com/repos/Dubai-Rapid-Properties/new-home/dispatches";

test("a deploy hook gets a plain POST", async () => {
  const { result, calls } = await rebuild("https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc", undefined, 200);
  assert.deepEqual(result, { started: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, undefined);
});

test("a GitHub dispatch URL sends a rebuild event with the token", async () => {
  const { result, calls } = await rebuild(DISPATCH, "github-token");
  assert.deepEqual(result, { started: true });
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer github-token");
  assert.ok(headers["User-Agent"], "GitHub refuses requests without a User-Agent");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { event_type: "rebuild" });
});

test("a GitHub dispatch URL without a token is not configured", async () => {
  const { result, calls } = await rebuild(DISPATCH, undefined);
  assert.deepEqual(result, { started: false, reason: "not_configured" });
  assert.equal(calls.length, 0);
});

test("no hook: not configured", async () => {
  const { result } = await rebuild(undefined, undefined);
  assert.deepEqual(result, { started: false, reason: "not_configured" });
});

test("a refused request is reported, not thrown", async () => {
  const { result } = await rebuild(DISPATCH, "bad-token", 401);
  assert.deepEqual(result, { started: false, reason: "HTTP 401" });
});
