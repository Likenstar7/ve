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
  const url = new URL(request.url);
  if (url.pathname === "/integrations/payhip/products" && request.method === "POST") {
    const expected = String(env.PAYHIP_ZAPIER_SECRET || "");
    const auth = request.headers.get("Authorization") || "";
    const supplied = request.headers.get("X-Mushmore-Secret") || auth.replace(/^Bearer\s+/i, "");
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
