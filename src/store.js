import { handleMarketplaceRequest } from "./marketplace.js";
import { handlePaypalRequest } from "./paypal.js";

const STORE_ORIGIN = "https://mushmoreby.blogspot.com";
const CURRENCY = "EUR";

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": STORE_ORIGIN,
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-max-age": "86400",
      "cache-control": "no-store",
      "vary": "Origin"
    }
  });
}
function fail(message, status = 400) { return response({ error: message }, status); }
function slugify(s) {
  return String(s || "").toLowerCase().trim()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}
function cleanText(v, max = 2000) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function int(v, min = 0, max = 100000000) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}
async function bodyJson(request) {
  try { return await request.json(); } catch { return null; }
}
async function verifyFirebaseToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    if (!env.FIREBASE_API_KEY) return null;
    const url = "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_API_KEY);
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: match[1] })
    });
    if (!r.ok) return null;
    const data = await r.json();
    const user = data.users && data.users[0];
    if (!user || !user.localId || !user.email) return null;
    return { uid: user.localId, email: String(user.email).toLowerCase(), name: user.displayName || "" };
  } catch { return null; }
}
async function requireAdmin(request, env) {
  const user = await verifyFirebaseToken(request, env);
  const allowed = String(env.ADMIN_UIDS || "").split(",").map(x => x.trim()).filter(Boolean);
  return user && allowed.includes(user.uid) ? user : null;
}
function productRow(row) {
  return {
    id: row.id, title: row.title, slug: row.slug, sku: row.sku || "", sellerId: row.seller_id || null, sellerLatitude: row.seller_latitude ?? null, sellerLongitude: row.seller_longitude ?? null, productType: row.product_type || "physical", description: row.description,
    category: row.category, imageUrl: row.image_url,
    price: row.price_cents / 100,
    compareAtPrice: row.compare_at_cents == null ? null : row.compare_at_cents / 100,
    stock: row.stock, active: !!row.active, currency: CURRENCY
  };
}
async function listProducts(env, url) {
  const category = cleanText(url.searchParams.get("category"), 80);
  const search = cleanText(url.searchParams.get("q"), 100);
  const limit = Math.min(60, Math.max(1, int(url.searchParams.get("limit"), 1, 60) || 24));
  let sql = "SELECT p.*, s.latitude AS seller_latitude, s.longitude AS seller_longitude FROM store_products p LEFT JOIN store_sellers s ON s.id=p.seller_id WHERE p.active = 1";
  const args = [];
  if (category) { sql += " AND p.category = ?"; args.push(category); }
  if (search) { sql += " AND (p.title LIKE ? OR p.description LIKE ?)"; args.push("%" + search + "%", "%" + search + "%"); }
  sql += " ORDER BY p.created_at DESC LIMIT ?";
  args.push(limit);
  const result = await env.DB.prepare(sql).bind(...args).all();
  return response({ products: (result.results || []).map(productRow), currency: CURRENCY });
}
async function adminProducts(request, env, method, id) {
  const admin = await requireAdmin(request, env);
  if (!admin) return fail("غير مصرح. سجّل الدخول بحساب المدير.", 401);
  if (method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM store_products ORDER BY created_at DESC").all();
    return response({ products: (result.results || []).map(productRow) });
  }
  if (method === "DELETE" && id) {
    await env.DB.prepare("DELETE FROM store_products WHERE id = ?").bind(id).run();
    return response({ success: true });
  }
  const data = await bodyJson(request);
  if (!data) return fail("بيانات المنتج غير صالحة.");
  const title = cleanText(data.title, 160);
  const price = int(data.priceCents, 0, 100000000);
  const stock = int(data.stock, 0, 1000000);
  if (!title || price === null || stock === null) return fail("أدخل اسم المنتج والسعر بالم سنت والمخزون بشكل صحيح.");
  const slug = slugify(data.slug || title) || crypto.randomUUID();
  const sku = cleanText(data.sku, 80).toUpperCase();
  const productType = data.productType === "digital" ? "digital" : "physical";
  const fields = [
    cleanText(data.description, 5000), cleanText(data.category, 80),
    cleanText(data.imageUrl, 1000), price,
    data.compareAtCents == null || data.compareAtCents === "" ? null : int(data.compareAtCents, 0, 100000000),
    stock, data.active === false ? 0 : 1
  ];
  if (fields[4] === null && data.compareAtCents != null && data.compareAtCents !== "") return fail("سعر المقارنة غير صالح.");
  if (id && method === "PUT") {
    await env.DB.prepare(`UPDATE store_products SET title=?, slug=?, description=?, category=?, image_url=?, price_cents=?, compare_at_cents=?, stock=?, active=?, sku=?, product_type=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(title, slug, ...fields, sku || null, productType, id).run();
    const otherWarehouses = await env.DB.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM store_warehouse_stock WHERE product_id=? AND warehouse_id<>?").bind(id,"wh-default").first();
    const defaultQty = Math.max(0, stock - Number(otherWarehouses && otherWarehouses.n || 0));
    await env.DB.prepare("INSERT INTO store_warehouse_stock(product_id,warehouse_id,quantity,reserved) VALUES(?,?,?,0) ON CONFLICT(product_id,warehouse_id) DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP").bind(id,"wh-default",defaultQty).run();
    return response({ success: true, id });
  }
  const newId = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO store_products (id,title,slug,description,category,image_url,price_cents,compare_at_cents,stock,active,sku,product_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(newId, title, slug, ...fields, sku || null, productType).run();
  } catch (e) { return fail("تعذر حفظ المنتج. تحقق من عدم تكرار الرابط المختصر.", 409); }
  await env.DB.prepare("INSERT OR REPLACE INTO store_warehouse_stock(product_id,warehouse_id,quantity,reserved) VALUES(?,?,?,0)").bind(newId, "wh-default", stock).run();
  return response({ success: true, id: newId }, 201);
}
async function createOrder(request, env) {
  const data = await bodyJson(request);
  if (!data || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 30) return fail("السلة فارغة أو غير صالحة.");
  const name = cleanText(data.customerName, 120);
  const email = cleanText(data.email, 254).toLowerCase();
  const phone = cleanText(data.phone, 50);
  const address = cleanText(data.address, 500);
  const city = cleanText(data.city, 100);
  const country = cleanText(data.country, 100);
  const payment = cleanText(data.paymentMethod, 30);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || !address || !city || !country) {
    return fail("أكمل الاسم والبريد والهاتف والعنوان والمدينة والبلد.");
  }
  if (!["cod", "bank_transfer"].includes(payment)) {
    return fail("الدفع الإلكتروني المباشر غير مفعّل بعد. اختر الدفع عند الاستلام أو التحويل البنكي.");
  }
  const quantities = new Map();
  for (const item of data.items) {
    const id = cleanText(item && item.id, 80);
    const qty = int(item && item.quantity, 1, 50);
    if (!id || qty === null) return fail("أحد عناصر السلة غير صالح.");
    quantities.set(id, (quantities.get(id) || 0) + qty);
  }
  const ids = [...quantities.keys()];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT id,title,price_cents,stock,active,image_url FROM store_products WHERE id IN (${placeholders})`)
    .bind(...ids).all();
  const byId = new Map((rows.results || []).map(p => [p.id, p]));
  const snapshot = [];
  let subtotal = 0;
  for (const [id, qty] of quantities) {
    const p = byId.get(id);
    if (!p || !p.active) return fail("أحد المنتجات لم يعد متاحاً.");
    if (p.stock < qty) return fail("الكمية المطلوبة غير متوفرة للمنتج: " + p.title, 409);
    subtotal += p.price_cents * qty;
    snapshot.push({ id, title: p.title, imageUrl: p.image_url, unitPriceCents: p.price_cents, quantity: qty });
  }
  if (!Number.isSafeInteger(subtotal) || subtotal > 1000000000) return fail("قيمة الطلب غير صالحة.");
  const orderId = crypto.randomUUID();
  const orderNumber = "MM-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 4).toUpperCase();
  const user = await verifyFirebaseToken(request, env);
  const updates = [];
  const warehouseUpdates = [];
  for (const [id, qty] of quantities) {
    const result = await env.DB.prepare("UPDATE store_products SET stock=stock-?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND active=1 AND stock>=?")
      .bind(qty, id, qty).run();
    if (!result.success || (result.meta && result.meta.changes !== 1)) {
      for (const done of updates) await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(done.qty, done.id).run();
      return fail("تغيّر المخزون أثناء الطلب. حدّث السلة وحاول مجدداً.", 409);
    }
    updates.push({ id, qty });
    const warehouseRows = await env.DB.prepare("SELECT warehouse_id,quantity,reserved FROM store_warehouse_stock WHERE product_id=? ORDER BY warehouse_id").bind(id).all();
    let remaining = qty;
    for (const wh of (warehouseRows.results || [])) {
      const available = wh.quantity - wh.reserved;
      if (available <= 0 || remaining <= 0) continue;
      const take = Math.min(available, remaining);
      await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity-?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND warehouse_id=? AND quantity-reserved>=?")
        .bind(take,id,wh.warehouse_id,take).run();
      warehouseUpdates.push({id,warehouseId:wh.warehouse_id,qty:take});
      remaining -= take;
    }
    if (remaining > 0) {
      for (const done of updates) await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(done.qty,done.id).run();
      for (const done of warehouseUpdates) await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity+? WHERE product_id=? AND warehouse_id=?").bind(done.qty,done.id,done.warehouseId).run();
      return fail("مخزون المستودعات لا يكفي لإتمام الطلب.",409);
    }
  }
  try {
    await env.DB.prepare(`INSERT INTO store_orders
      (id,order_number,customer_uid,customer_name,customer_email,customer_phone,shipping_address,shipping_city,shipping_country,items_json,subtotal_cents,shipping_cents,total_cents,currency,payment_method,customer_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(orderId, orderNumber, user ? user.uid : null, name, email, phone, address, city, country,
        JSON.stringify(snapshot), subtotal, 0, subtotal, CURRENCY, payment, cleanText(data.note, 1000)).run();
  } catch (e) {
    for (const done of updates) await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(done.qty, done.id).run();
    for (const done of warehouseUpdates) await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity+? WHERE product_id=? AND warehouse_id=?").bind(done.qty,done.id,done.warehouseId).run();
    return fail("تعذر إنشاء الطلب. حاول مرة أخرى.", 500);
  }
  return response({ success: true, orderNumber, total: subtotal / 100, currency: CURRENCY, paymentMethod: payment }, 201);
}
async function adminOrders(request, env, method, id) {
  const admin = await requireAdmin(request, env);
  if (!admin) return fail("غير مصرح. سجّل الدخول بحساب المدير.", 401);
  if (method === "GET" && !id) {
    const result = await env.DB.prepare("SELECT * FROM store_orders ORDER BY created_at DESC LIMIT 100").all();
    const orders = (result.results || []).map(o => ({
      id:o.id, orderNumber:o.order_number, customerName:o.customer_name, email:o.customer_email,
      phone:o.customer_phone, address:o.shipping_address, city:o.shipping_city, country:o.shipping_country,
      items:JSON.parse(o.items_json), subtotal:o.subtotal_cents/100, total:o.total_cents/100,
      currency:o.currency, paymentMethod:o.payment_method, paymentStatus:o.payment_status,
      status:o.order_status, note:o.customer_note, createdAt:o.created_at
    }));
    return response({ orders });
  }
  if (method === "PATCH" && id) {
    const data = await bodyJson(request);
    const status = cleanText(data && data.status, 30);
    const paymentStatus = cleanText(data && data.paymentStatus, 30);
    const allowedStatus = ["new","processing","shipped","completed","cancelled"];
    const allowedPayment = ["pending","paid","refunded","failed"];
    if (!allowedStatus.includes(status) || !allowedPayment.includes(paymentStatus)) return fail("حالة الطلب أو الدفع غير صالحة.");
    await env.DB.prepare("UPDATE store_orders SET order_status=?,payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(status,paymentStatus,id).run();
    return response({ success:true });
  }
  return fail("المسار غير موجود.", 404);
}
export async function handleStoreRequest(request, env) {
  const paypalResponse = await handlePaypalRequest(request, env);
  if (paypalResponse) return paypalResponse;
  const marketplaceResponse = await handleMarketplaceRequest(request, env);
  if (marketplaceResponse) return marketplaceResponse;
  if (request.headers.get("Origin") !== STORE_ORIGIN) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": STORE_ORIGIN,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400", "vary": "Origin"
  }});
  if (!env.DB) return fail("قاعدة بيانات المتجر غير مربوطة.", 503);
  const url = new URL(request.url);
  const method = request.method;
  if (method === "GET" && url.pathname === "/store/account/loyalty") {
    const user = await verifyFirebaseToken(request, env);
    if (!user) return fail("سجّل الدخول لعرض نقاط المكافآت.", 401);
    const balance = await env.DB.prepare("SELECT COALESCE(SUM(points),0) AS points FROM store_loyalty_ledger WHERE firebase_uid=?").bind(user.uid).first();
    const recent = await env.DB.prepare("SELECT points,entry_type,description,created_at FROM store_loyalty_ledger WHERE firebase_uid=? ORDER BY created_at DESC LIMIT 30").bind(user.uid).all();
    return response({ points: Number(balance?.points || 0), pointsPerEuro: 1, redemptionEnabled: false, note: "النقاط مكافآت ترويجية مغلقة؛ لا تُباع ولا تُحوّل ولا تُسحب نقداً.", entries: recent.results || [] });
  }
  if (method === "GET" && url.pathname === "/store/products") return listProducts(env, url);
  if (url.pathname === "/store/orders" && method === "POST") return createOrder(request, env);
  if (url.pathname === "/store/admin/products") return adminProducts(request, env, method, null);
  const productMatch = url.pathname.match(/^\/store\/admin\/products\/([a-zA-Z0-9-]+)$/);
  if (productMatch) return adminProducts(request, env, method, productMatch[1]);
  if (url.pathname === "/store/admin/orders") return adminOrders(request, env, method, null);
  const orderMatch = url.pathname.match(/^\/store\/admin\/orders\/([a-zA-Z0-9-]+)$/);
  if (orderMatch) return adminOrders(request, env, method, orderMatch[1]);
  return fail("المسار غير موجود.", 404);
}
