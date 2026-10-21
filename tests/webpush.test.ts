import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encryptPayload,
  fromBase64Url,
  generateVapidKeys,
  sendPush,
  toBase64Url,
  vapidAuthorization,
} from "@/lib/push/webpush";

test("encrypts the RFC 8291 example exactly", async () => {
  const body = await encryptPayload(
    new TextEncoder().encode("When I grow up, I want to be a watermelon"),
    {
      p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    },
    {
      salt: fromBase64Url("DGv6ra1nlYgDCS1FRnbzlw"),
      senderPrivate: fromBase64Url("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
      senderPublic: fromBase64Url(
        "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
      ),
    }
  );
  assert.equal(
    toBase64Url(body),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
      "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
      "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
  );
});

test("the VAPID header is an ES256 token the public key verifies", async () => {
  const keys = await generateVapidKeys();
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, "mailto:ops@example.ae");
  const [, token, k] = /^vapid t=(.+), k=(.+)$/.exec(header)!;
  assert.equal(k, keys.publicKey);
  const [head, claims, signature] = token.split(".");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(claims)));
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.equal(payload.sub, "mailto:ops@example.ae");
  assert.ok(payload.exp > Date.now() / 1000 && payload.exp <= Date.now() / 1000 + 24 * 3600);
  const verifier = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(keys.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifier,
    fromBase64Url(signature),
    new TextEncoder().encode(`${head}.${claims}`)
  );
  assert.ok(ok);
});

test("a push the browser dropped reports gone", async () => {
  const keys = await generateVapidKeys();
  // A real browser key pair, so encryption succeeds.
  const browser = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const target = {
    endpoint: "https://push.example.net/sub/1",
    p256dh: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", browser.publicKey))),
    auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const original = globalThis.fetch;
  const seen: RequestInit[] = [];
  try {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(null, { status: seen.length === 1 ? 201 : 410 });
    }) as typeof fetch;
    assert.equal(await sendPush(target, { title: "x" }, keys, "mailto:ops@example.ae"), "sent");
    assert.equal(await sendPush(target, { title: "x" }, keys, "mailto:ops@example.ae"), "gone");
  } finally {
    globalThis.fetch = original;
  }
  const headers = seen[0].headers as Record<string, string>;
  assert.equal(headers["Content-Encoding"], "aes128gcm");
  assert.match(headers.Authorization, /^vapid t=/);
});
