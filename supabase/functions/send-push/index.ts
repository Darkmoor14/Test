// supabase/functions/send-push/index.ts
//
// Sends a real push notification to every device that has installed
// the Insta Grup Admin PWA and granted notification permission — using
// the standard, free Web Push protocol.
//
// WHO CAN CALL THIS (security fix — see supabase/sql/README.md): this
// used to accept a bare anon-key request and push whatever
// title/body/url it was given to every staff device — meaning anyone
// could fire an arbitrary push notification at every logged-in staff
// member. It now accepts exactly two kinds of caller, same pattern as
// bright-processor:
//
//   1. The database notify trigger (005_notify_triggers.sql) —
//      authenticated by a shared secret (`x-notify-secret` header),
//      given only a ticket_id. The title/body/url are built here from
//      the real ticket row (service-role fetch), never from anything
//      the caller sent directly.
//
//   2. An authenticated staff member — admin.html's existing calls
//      already send the logged-in user's session token automatically,
//      so nothing changes there; the title/body/url it sends are
//      trusted exactly as before.
//
// IMPLEMENTATION NOTE (why this doesn't use the "web-push" npm
// package): that library works fine under Node.js, but running it
// under Deno (which is what Supabase Edge Functions use) via Deno's
// Node-compatibility layer produced JWTs that Apple's push service
// (web.push.apple.com) rejected with a "BadJwtToken" error — most
// likely because the underlying signature ended up DER-encoded rather
// than the raw (r||s) format the JOSE/JWS ES256 spec and Apple's
// validator expect. Deno's native Web Crypto API (crypto.subtle),
// used directly below, always produces the correct raw format per the
// W3C spec, sidestepping that whole class of problem. This
// implementation follows RFC 8291 (message encryption) and RFC 8292
// (VAPID) directly, using only Deno's built-in crypto — no external
// push library dependency at all.
//
// DEPLOY:
//   supabase functions deploy send-push
//
// REQUIRED SECRETS (Project Settings -> Edge Functions -> Secrets)
// — these are the SAME secrets already configured, plus the new
// NOTIFY_SHARED_SECRET (see supabase/sql/README.md):
//   VAPID_PUBLIC_KEY           — raw P-256 public key, base64url,
//                                 no padding (matches admin.html's key)
//   VAPID_PRIVATE_KEY          — raw P-256 private scalar, base64url,
//                                 no padding
//   SUPABASE_URL                — same project URL used elsewhere
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (bypasses RLS to
//                                 read every stored subscription)
//   NOTIFY_SHARED_SECRET        — same value as in Vault, used by the
//                                 notify trigger to authenticate itself
//
// admin.html calls this with a simple JSON body:
//   { "title": "...", "body": "...", "url": "/admin.html" }
// and this function fans it out to every stored subscription. Any
// subscription that comes back expired/invalid (404/410 — a device
// that uninstalled the app, revoked permission, etc.) is automatically
// deleted from the table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notify-secret",
};

// ============================================================
// Small helpers
// ============================================================

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.byteLength; }
  return out;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return await hmacSha256(salt, ikm);
}

// Single-round expand — sufficient here since every length we need
// (16 or 32 bytes) is <= the SHA-256 output size (32 bytes).
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const okm = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

// ============================================================
// VAPID keys — imported from the existing stored secrets. The
// private key is reconstructed as a JWK (x/y come from the already-
// known public key, d is the stored private scalar), since Web
// Crypto's "raw" import format isn't supported for EC private keys.
// ============================================================

async function importVapidKeys(publicKeyB64url: string, privateKeyB64url: string) {
  const publicRaw = base64UrlDecode(publicKeyB64url); // 0x04 || X(32) || Y(32)
  const x = publicRaw.slice(1, 33);
  const y = publicRaw.slice(33, 65);
  const d = base64UrlDecode(privateKeyB64url);

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    d: base64UrlEncode(d),
    ext: true,
  };

  const privateKey = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  return { privateKey, publicRaw };
}

async function buildVapidJWT(audience: string, subject: string, privateKey: CryptoKey): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };

  const signingInput =
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(header))) + "." +
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));

  // crypto.subtle always produces the raw (r||s) ECDSA signature
  // format per the WebCrypto spec — exactly what JWS ES256 (and
  // Apple's push validator) require.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput),
  );

  return signingInput + "." + base64UrlEncode(new Uint8Array(signature));
}

// ============================================================
// RFC 8291 — encrypt the notification payload for one subscriber.
// Uses a fresh ephemeral ECDH key pair per message (the RFC's
// recommended approach — no need to persist or reuse this).
// ============================================================

async function encryptPayload(plaintext: Uint8Array, p256dhB64url: string, authB64url: string) {
  const uaPublicRaw = base64UrlDecode(p256dhB64url);
  const authSecret = base64UrlDecode(authB64url);

  const asKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  ) as CryptoKeyPair;
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  const uaPublicKey = await crypto.subtle.importKey(
    "raw", uaPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPublicKey }, asKeyPair.privateKey, 256,
  );
  const ecdhSecret = new Uint8Array(sharedSecretBits);

  const prkKey = await hkdfExtract(authSecret, ecdhSecret);
  const keyInfo = concatBytes(new TextEncoder().encode("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);

  const cekBytes = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const cek = await crypto.subtle.importKey("raw", cekBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const paddedPlaintext = concatBytes(plaintext, new Uint8Array([2])); // delimiter byte, no extra padding needed
  const ciphertextBits = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, cek, paddedPlaintext,
  );
  const ciphertext = new Uint8Array(ciphertextBits);

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const idLen = new Uint8Array([asPublicRaw.byteLength]);
  const header = concatBytes(salt, recordSize, idLen, asPublicRaw);

  return concatBytes(header, ciphertext);
}

// ============================================================
// Send one push message to one subscription.
// ============================================================

async function sendPushToSubscription(
  sub: { endpoint: string; p256dh: string; auth: string },
  payloadBytes: Uint8Array,
  vapidPrivateKey: CryptoKey,
  vapidPublicKeyB64url: string,
) {
  const body = await encryptPayload(payloadBytes, sub.p256dh, sub.auth);
  const audience = new URL(sub.endpoint).origin;
  const jwt = await buildVapidJWT(audience, "mailto:office@insta-grup.ro", vapidPrivateKey);

  const resp = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
      "Urgency": "normal",
      "Authorization": `vapid t=${jwt}, k=${vapidPublicKeyB64url}`,
    },
    body,
  });

  return resp;
}

// ============================================================
// Who's allowed to call this, and what title/body/url to use.
// ============================================================

const NOTIFY_SHARED_SECRET = Deno.env.get("NOTIFY_SHARED_SECRET")!;

async function resolveNotificationContent(
  req: Request,
): Promise<{ title: string; body: string; url: string } | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const sharedSecret = req.headers.get("x-notify-secret");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (sharedSecret && sharedSecret === NOTIFY_SHARED_SECRET) {
    // Trigger-originated: only ever given a ticket_id — the real
    // title/body/url are built here from the actual saved row, never
    // trusted from the request itself.
    const payload = await req.json();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error } = await admin
      .from("tickets")
      .select("ticket_number, address")
      .eq("id", payload.ticket_id)
      .single();
    if (error || !data) return new Response("ticket not found", { status: 404 });

    return {
      title: "Sesizare nouă",
      body: `${data.ticket_number} — ${data.address}`,
      url: "admin.html?ticket=" + encodeURIComponent(data.ticket_number),
    };
  }

  if (authHeader.startsWith("Bearer ")) {
    // Staff-authenticated (admin.html): verify it's a real logged-in
    // user, then trust the title/body/url it sends, same as before.
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return new Response("unauthorized", { status: 401 });

    const payload = await req.json();
    return {
      title: payload.title || "Sesizare nouă",
      body: payload.body || "A fost înregistrată o sesizare nouă pe site.",
      url: payload.url || "admin.html",
    };
  }

  return new Response("unauthorized", { status: 401 });
}

// ============================================================
// Main handler
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("send-push: missing one or more required secrets");
      return new Response(
        JSON.stringify({ error: "Push not configured (missing secrets)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const content = await resolveNotificationContent(req);
    if (content instanceof Response) return content;
    const { title, body: notifBody, url } = content;

    const { privateKey: vapidPrivateKey } = await importVapidKeys(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const subsResp = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    const subs = await subsResp.json();

    if (!Array.isArray(subs) || subs.length === 0) {
      return new Response(JSON.stringify({ results: [], note: "No subscribed devices" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notificationPayload = new TextEncoder().encode(JSON.stringify({ title, body: notifBody, url }));

    const results = await Promise.all(
      subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          const resp = await sendPushToSubscription(sub, notificationPayload, vapidPrivateKey, VAPID_PUBLIC_KEY);
          if (resp.ok) {
            return { id: sub.id, ok: true };
          }
          const bodyText = await resp.text();
          if (resp.status === 404 || resp.status === 410) {
            await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${sub.id}`, {
              method: "DELETE",
              headers: {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
            });
            return { id: sub.id, ok: false, removed: true };
          }
          console.error("send-push: failed for subscription", sub.id, resp.status, bodyText);
          return { id: sub.id, ok: false, status: resp.status, body: bodyText };
        } catch (err) {
          console.error("send-push: exception for subscription", sub.id, err);
          return { id: sub.id, ok: false, error: String(err) };
        }
      }),
    );

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
