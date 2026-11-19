import { handleStoreRequest } from "./store.js";

const ALLOWED_ORIGIN = "https://mushmoreby.blogspot.com";
const OTP_TTL_SECONDS = 300;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;
const IP_WINDOW_SECONDS = 3600;
const MAX_IP_SENDS = 10;

function json(data, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-max-age": "86400",
      "vary": "Origin",
      "cache-control": "no-store"
    }
  });
}

function corsOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === ALLOWED_ORIGIN ? origin : null;
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function makeOtp() {
  // Rejection sampling avoids modulo bias.
  const limit = Math.floor(0x100000000 / 1000000) * 1000000;
  const buffer = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return String(value % 1000000).padStart(6, "0");
}

function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function sendCode(request, env, origin) {
  if (!env.DB || !env.RESEND_API_KEY || !env.OTP_PEPPER || !env.RESEND_TEST_TO_EMAIL) {
    return json({ error: "الخدمة غير مكتملة الإعداد. يرجى مراجعة إعدادات Worker." }, 503, origin);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "طلب غير صالح." }, 400, origin); }
  const email = normalizeEmail(body.email);
  const testRecipient = normalizeEmail(env.RESEND_TEST_TO_EMAIL);
  if (!testRecipient) return json({ error: "إعداد بريد الاختبار غير صحيح." }, 503, origin);
  if (!email) return json({ error: "يرجى إدخال بريد إلكتروني صحيح." }, 400, origin);
  if (email !== testRecipient) return json({ error: "وضع الاختبار يسمح بالإرسال إلى بريد حساب Resend المحدد فقط." }, 403, origin);

  const now = Math.floor(Date.now() / 1000);
  const ipHash = await sha256(env.OTP_PEPPER + ":" + getClientIp(request));
  const limit = await env.DB.prepare(
    "SELECT window_start, request_count FROM otp_rate_limits WHERE ip_hash = ?"
  ).bind(ipHash).first();

  if (limit && now - limit.window_start < IP_WINDOW_SECONDS && limit.request_count >= MAX_IP_SENDS) {
    return json({ error: "تجاوزت عدد المحاولات المسموح. حاول لاحقاً." }, 429, origin);
  }

  const previous = await env.DB.prepare(
    "SELECT last_sent_at FROM verification_codes WHERE email = ?"
  ).bind(email).first();

  if (previous && now - previous.last_sent_at < RESEND_COOLDOWN_SECONDS) {
    return json({ error: "انتظر دقيقة قبل طلب رمز جديد." }, 429, origin);
  }

  const code = makeOtp();
  const codeHash = await sha256(env.OTP_PEPPER + ":" + email + ":" + code);
  const expiresAt = now + OTP_TTL_SECONDS;

  await env.DB.prepare(
    `INSERT INTO verification_codes (email, code_hash, expires_at, attempts, last_sent_at, created_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       last_sent_at = excluded.last_sent_at,
       created_at = excluded.created_at`
  ).bind(email, codeHash, expiresAt, now, now).run();

  await env.DB.prepare(
    `INSERT INTO otp_rate_limits (ip_hash, window_start, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(ip_hash) DO UPDATE SET
       window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END,
       request_count = CASE WHEN ? - window_start >= ? THEN 1 ELSE request_count + 1 END`
  ).bind(ipHash, now, now, IP_WINDOW_SECONDS, now, now, IP_WINDOW_SECONDS).run();

  const mailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: "Mushmore <onboarding@resend.dev>",
      to: [email],
      subject: "رمز التحقق - Mushmore",
      html: `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:center">
        <h2>تأكيد البريد الإلكتروني</h2>
        <p>رمز التحقق الخاص بك:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</div>
        <p>تنتهي صلاحية الرمز خلال 5 دقائق. لا تشاركه مع أي شخص.</p>
      </div>`
    })
  });

  if (!mailResponse.ok) {
    await env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(email).run();
    const detail = await mailResponse.text();
    console.error("Resend error:", mailResponse.status, detail.slice(0, 500));
    return json({ error: "تعذر إرسال الرمز حالياً. تحقق من إعدادات البريد." }, 502, origin);
  }

  return json({ success: true, message: "تم إرسال رمز التحقق إلى بريدك." }, 200, origin);
}

async function verifyCode(request, env, origin) {
  if (!env.DB || !env.OTP_PEPPER) {
    return json({ error: "الخدمة غير مكتملة الإعداد." }, 503, origin);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "طلب غير صالح." }, 400, origin); }
  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    return json({ error: "البريد أو رمز التحقق غير صالح." }, 400, origin);
  }

  const row = await env.DB.prepare(
    "SELECT code_hash, expires_at, attempts FROM verification_codes WHERE email = ?"
  ).bind(email).first();

  if (!row) return json({ error: "لا يوجد رمز صالح. اطلب رمزاً جديداً." }, 400, origin);

  const now = Math.floor(Date.now() / 1000);
  if (now > row.expires_at) {
    await env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(email).run();
    return json({ error: "انتهت صلاحية الرمز. اطلب رمزاً جديداً." }, 400, origin);
  }

  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    await env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(email).run();
    return json({ error: "تم تجاوز عدد المحاولات. اطلب رمزاً جديداً." }, 429, origin);
  }

  const submittedHash = await sha256(env.OTP_PEPPER + ":" + email + ":" + code);
  if (submittedHash !== row.code_hash) {
    await env.DB.prepare(
      "UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?"
    ).bind(email).run();
    return json({ error: "رمز التحقق غير صحيح." }, 400, origin);
  }

  await env.DB.prepare("DELETE FROM verification_codes WHERE email = ?").bind(email).run();
  return json({
    success: true,
    verified: true,
    email,
    message: "تم التحقق من البريد بنجاح."
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = corsOrigin(request);
    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }

    if (!origin) return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/store/")) return handleStoreRequest(request, env);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "mushmore-auth" }, 200, origin);
    }
    if (request.method === "POST" && url.pathname === "/send-code") {
      return sendCode(request, env, origin);
    }
    if (request.method === "POST" && url.pathname === "/verify-code") {
      return verifyCode(request, env, origin);
    }

    return json({ error: "المسار غير موجود." }, 404, origin);
  }
};