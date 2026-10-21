/**
 * Web Push with nothing but WebCrypto, so it runs on Cloudflare Workers as
 * well as Node: the message is encrypted for the browser (RFC 8291,
 * aes128gcm) and the request signed with the portal's VAPID key (RFC 8292).
 */

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** A P-256 private key from its raw scalar and uncompressed public point. */
function privateJwk(d: Uint8Array, publicKey: Uint8Array): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(publicKey.slice(1, 33)),
    y: toBase64Url(publicKey.slice(33, 65)),
    d: toBase64Url(d),
    ext: true,
  };
}

export interface PushTarget {
  endpoint: string;
  /** The browser's public key and auth secret, base64url, from PushSubscription.toJSON().keys. */
  p256dh: string;
  auth: string;
}

/** Fixed sender key and salt, for the RFC 8291 test vector only. */
export interface EncryptOverrides {
  salt: Uint8Array<ArrayBuffer>;
  senderPrivate: Uint8Array<ArrayBuffer>;
  senderPublic: Uint8Array<ArrayBuffer>;
}

/** The aes128gcm request body for one push message (a single record). */
export async function encryptPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  target: Pick<PushTarget, "p256dh" | "auth">,
  overrides?: EncryptOverrides
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromBase64Url(target.p256dh);
  const authSecret = fromBase64Url(target.auth);
  const salt = overrides?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let senderPrivate: CryptoKey;
  let senderPublic: Uint8Array<ArrayBuffer>;
  if (overrides) {
    senderPrivate = await crypto.subtle.importKey(
      "jwk",
      privateJwk(overrides.senderPrivate, overrides.senderPublic),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"]
    );
    senderPublic = overrides.senderPublic;
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, senderPrivate, 256)
  );

  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublic, senderPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the plaintext, then the 0x02 delimiter that marks the last record.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2])))
  );

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, ciphertext);
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (what the browser subscribes with). */
  publicKey: string;
  /** Private scalar, base64url. */
  privateKey: string;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: toBase64Url(publicKey), privateKey: jwk.d! };
}

/** The Authorization header value that identifies the portal to the push service. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk(fromBase64Url(keys.privateKey), fromBase64Url(keys.publicKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const part = (value: object) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  // WebCrypto signs ECDSA as raw r||s, which is the JWS ES256 format.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(unsigned))
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

export type PushResult = "sent" | "gone" | { error: string };

/**
 * Sends one message. "gone" means the browser has dropped the subscription
 * (uninstalled, notifications turned off) and it should be deleted.
 */
export async function sendPush(
  target: PushTarget,
  message: unknown,
  keys: VapidKeys,
  subject: string,
  options: { ttlSeconds?: number } = {}
): Promise<PushResult> {
  try {
    const body = await encryptPayload(encoder.encode(JSON.stringify(message)), target);
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(target.endpoint, keys, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttlSeconds ?? 600),
        Urgency: "high",
      },
      body,
    });
    if (response.status === 404 || response.status === 410) return "gone";
    if (!response.ok) return { error: `HTTP ${response.status} ${(await response.text()).slice(0, 200)}` };
    return "sent";
  } catch (error) {
    return { error: error instanceof Error ? error.message : "unknown" };
  }
}
