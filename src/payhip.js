const STORE_ORIGIN = "https://mushmoreby.blogspot.com";
function json(data, status = 200, origin = STORE_ORIGIN) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, X-Mushmore-Secret",
    "cache-control": "no-store", "vary": "Origin"
  }});
}
function text(v, max = 5000) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function pick(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}
function moneyToMinor(value) {
  if (typeof value === "string") value = value.replace(/[, ]/g, "").replace(/^\$/, "");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) return null;
  return Math.round(n * 100);
}
export async function handlePayhipRequest(request, env) {
  if (new URL(request.url).pathname === "/integrations/payhip/webhook" && request.method === "POST") {
    if (!env.PAYHIP_WEBHOOK_SIGNATURE) return json({ error: "Payhip webhook signature is not configured." }, 503, "*");
    let event;
    try { event = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, "*"); }
    const supplied = text(event.signature, 128).toLowerCase();
    const expected = String(env.PAYHIP_WEBHOOK_SIGNATURE).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected) || supplied.length !== expected.length) return json({ error: "Unauthorized" }, 401, "*");
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
    if (diff !== 0) return json({ error: "Unauthorized" }, 401, "*");
    if (!env.DB) return json({ error: "Database unavailable" }, 503, "*");
    const type = text(event.type, 40);
    const transactionId = text(event.id, 180);
    const currency = text(event.currency, 3).toUpperCase();
    const price = Number(event.price);
    const email = text(event.email, 254).toLowerCase();
    if (!["paid", "refunded"].includes(type) || !transactionId || !/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(price) || price < 0) {
      return json({ error: "Invalid Payhip transaction payload." }, 400, "*");
    }
    const refunded = type === "refunded" ? Math.min(price, Math.max(0, Number.isSafeInteger(Number(event.amount_refunded)) ? Number(event.amount_refunded) : price)) : 0;
    const status = type === "paid" ? "paid" : refunded >= price ? "refunded" : "partially_refunded";
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO payhip_sales
      (transaction_id,customer_email,currency,price_minor,refunded_minor,status,items_json,transaction_at,refunded_at,payload_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(transaction_id) DO UPDATE SET
      customer_email=excluded.customer_email,currency=excluded.currency,
      price_minor=excluded.price_minor,refunded_minor=CASE WHEN excluded.status='paid' THEN payhip_sales.refunded_minor ELSE excluded.refunded_minor END,
      status=CASE WHEN payhip_sales.status IN ('refunded','partially_refunded') AND excluded.status='paid' THEN payhip_sales.status ELSE excluded.status END,
      items_json=excluded.items_json,transaction_at=COALESCE(payhip_sales.transaction_at,excluded.transaction_at),
      refunded_at=CASE WHEN excluded.status IN ('refunded','partially_refunded') THEN excluded.refunded_at ELSE payhip_sales.refunded_at END,
      payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .bind(transactionId,email,currency,price,refunded,status,JSON.stringify(Array.isArray(event.items)?event.items:[]).slice(0,20000),
        Number.isFinite(Number(event.date))?Math.floor(Number(event.date)):null,
        type==="refunded"?(Number.isFinite(Number(event.date_refunded))?Math.floor(Number(event.date_refunded)):Math.floor(Date.now()/1000)):null,
        JSON.stringify(event).slice(0,30000),now,now).run();
    return json({ success: true, transactionId, status }, 200, "*");
  }
  const url = new URL(request.url);
  if (url.pathname === "/integrations/payhip/products" && request.method === "POST") {
    const expected = String(env.PAYHIP_ZAPIER_SECRET || "");
    const auth = request.headers.get("Authorization") || "";
    const legacyHeader = request.headers.get("PAYHIP_ZAPIER_SECRET") || "";
    const suppliedRaw = request.headers.get("X-Mushmore-Secret") || auth || legacyHeader;
    const supplied = suppliedRaw.trim().replace(/^Bearer\s+/i, "").trim();
    if (!expected || supplied.length !== expected.length) return json({ error: "Unauthorized" }, 401, "*");
    let match = 0;
    for (let i = 0; i < expected.length; i++) match |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
    if (match !== 0) return json({ error: "Unauthorized" }, 401, "*");
    if (!env.DB) return json({ error: "Database unavailable" }, 503, "*");
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, "*"); }
    const productId = text(pick(body, ["product_id", "id", "Product ID", "ID"]), 180);
    const title = text(pick(body, ["title", "name", "product_name", "Product Name"]), 180);
    const description = text(pick(body, ["description", "Description"]), 5000);
    const productUrl = text(pick(body, ["product_url", "url", "Product URL", "Link"]), 1500);
    const imageUrl = text(pick(body, ["image_url", "image", "Image URL", "Product Image"]), 1500);
    const category = text(pick(body, ["category", "Category"]), 100) || "Digital";
    const currency = (text(pick(body, ["currency", "Currency"]), 3) || "USD").toUpperCase();
    const priceMinor = moneyToMinor(pick(body, ["price", "Price", "amount", "Amount"]));
    if (!productId || !title || !productUrl || priceMinor === null || !/^[A-Z]{3}$/.test(currency)) {
      return json({ error: "Required fields: product_id, title, price, currency, product_url. Check Zapier field mapping." }, 400, "*");
    }
    try { new URL(productUrl); } catch { return json({ error: "product_url must be a valid URL" }, 400, "*"); }
    if (imageUrl) { try { new URL(imageUrl); } catch { return json({ error: "image_url must be a valid URL" }, 400, "*"); } }
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO payhip_products
      (id,title,description,category,image_url,price_minor,currency,product_url,active,payload_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,
      category=excluded.category,image_url=excluded.image_url,price_minor=excluded.price_minor,
      currency=excluded.currency,product_url=excluded.product_url,active=1,
      payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .bind(productId,title,description,category,imageUrl,priceMinor,currency,productUrl,JSON.stringify(body).slice(0,20000),now,now).run();
    return json({ success: true, productId, message: "Payhip product synced to Mushmore." }, 200, "*");
  }
  if (url.pathname === "/store/payhip/products" && request.method === "GET") {
    const origin = request.headers.get("Origin");
    if (origin !== STORE_ORIGIN) return new Response("Forbidden", { status: 403 });
    if (!env.DB) return json({ error: "Database unavailable" }, 503);
    const result = await env.DB.prepare("SELECT id,title,description,category,image_url,price_minor,currency,product_url,updated_at FROM payhip_products WHERE active=1 ORDER BY updated_at DESC LIMIT 100").all();
    return json({ products: (result.results || []).map(p => ({
      id: p.id, title: p.title, description: p.description, category: p.category,
      imageUrl: p.image_url, price: p.price_minor / 100, currency: p.currency,
      productUrl: p.product_url, source: "payhip", updatedAt: p.updated_at
    })) });
  }
  return null;
}
