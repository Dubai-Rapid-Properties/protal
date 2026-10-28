import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tellWebsite } from "@/lib/website-bookings";

// The Holiday Homes website, as the portal sees it when staff accept or decline a booking made there.
const calls: { url: string; auth: string; body: unknown }[] = [];
let server: Server;
let base: string;

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ url: req.url!, auth: req.headers.authorization ?? "", body: JSON.parse(raw || "null") });
      const ref = req.url!.split("/").pop();
      res.setHeader("content-type", "application/json");
      if (ref === "GONE") return res.writeHead(404).end(JSON.stringify({ error: "Unknown booking." }));
      if (ref === "LAPSED")
        return res.writeHead(409).end(JSON.stringify({ error: "The card hold could not be charged (it may have expired or been released), so the booking was not confirmed." }));
      res.end(JSON.stringify({ ok: true, status: "confirmed", payment: "paid" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test("accepting a request asks the website, with the shared key", async () => {
  assert.deepEqual(await tellWebsite("DRP-ABC123", "confirmed", undefined, base, "secret"), { ok: true });
  assert.deepEqual(calls.at(-1), { url: "/api/portal/bookings/DRP-ABC123", auth: "Bearer secret", body: { status: "confirmed" } });
  await tellWebsite("DRP-ABC123", "cancelled", "Owner stay", base, "secret");
  assert.deepEqual(calls.at(-1)?.body, { status: "cancelled", reason: "Owner stay" });
});

test("the website's refusal is passed on, so the portal changes nothing", async () => {
  assert.deepEqual(await tellWebsite("LAPSED", "confirmed", undefined, base, "secret"), {
    error: "The card hold could not be charged (it may have expired or been released), so the booking was not confirmed.",
  });
});

test("a booking the website doesn't know is left to the portal", async () => {
  assert.deepEqual(await tellWebsite("GONE", "cancelled", undefined, base, "secret"), { missing: true });
});

test("no key or no website: nothing is changed", async () => {
  assert.ok("error" in (await tellWebsite("DRP-ABC123", "confirmed", undefined, base, undefined)));
  const unreachable = await tellWebsite("DRP-ABC123", "confirmed", undefined, "http://127.0.0.1:9", "secret");
  assert.ok("error" in unreachable && /couldn't be reached/.test(unreachable.error));
});
