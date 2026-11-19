const ORIGIN = "https://mushmoreby.blogspot.com";
const json = (data, status=200) => new Response(JSON.stringify(data), {status,headers:{
  "content-type":"application/json; charset=utf-8","access-control-allow-origin":ORIGIN,
  "access-control-allow-methods":"GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "access-control-allow-headers":"Content-Type, Authorization","cache-control":"no-store","vary":"Origin"
}});
const error = (message,status=400)=>json({error:message},status);
const text = (v,n=300)=>typeof v==="string"?v.trim().slice(0,n):"";
async function body(req){try{return await req.json()}catch{return null}}
async function identity(req,env){
  const m=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i); if(!m||!env.FIREBASE_API_KEY)return null;
  try{const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+encodeURIComponent(env.FIREBASE_API_KEY),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken:m[1]})});
    if(!r.ok)return null;const d=await r.json(),u=d.users&&d.users[0];return u&&u.localId?{uid:u.localId,email:(u.email||"").toLowerCase(),name:u.displayName||""}:null;
  }catch{return null}
}
async function admin(req,env){const u=await identity(req,env);const ids=String(env.ADMIN_UIDS||"").split(",").map(x=>x.trim()).filter(Boolean);return u&&ids.includes(u.uid)?u:null}
async function seller(req,env){const u=await identity(req,env);if(!u)return null;const s=await env.DB.prepare("SELECT * FROM store_sellers WHERE firebase_uid=? AND status='approved'").bind(u.uid).first();return s?{user:u,store:s}:null}
function trackingUrl(template,number){return template?template.replace(/\{tracking\}/g,encodeURIComponent(number)):""}
export async function handleMarketplaceRequest(req,env){
 const url=new URL(req.url),p=url.pathname,m=req.method;
 if(!p.startsWith("/store/"))return null;
 if(req.headers.get("Origin")!==ORIGIN)return new Response("Forbidden",{status:403});
 if(m==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":ORIGIN,"access-control-allow-methods":"GET, POST, PATCH, PUT, DELETE, OPTIONS","access-control-allow-headers":"Content-Type, Authorization"}});
 if(p==="/store/sellers/apply"&&m==="POST"){
   const u=await identity(req,env);if(!u)return error("سجّل الدخول أولاً.",401);
   const d=await body(req);if(!d)return error("البيانات غير صالحة.");
   const storeName=text(d.storeName,120),phone=text(d.phone,50),country=text(d.country,100);
   if(!storeName||!u.email)return error("اسم المتجر والبريد مطلوبان.");
   const id=crypto.randomUUID();
   try{await env.DB.prepare("INSERT INTO store_sellers(id,firebase_uid,store_name,contact_name,email,phone,country) VALUES(?,?,?,?,?,?,?)").bind(id,u.uid,storeName,u.name, u.email,phone,country).run();}
   catch{return error("يوجد طلب بائع سابق لهذا الحساب.",409)}
   return json({success:true,id,status:"pending"},201);
 }
 if(p==="/store/admin/sellers"&&m==="GET"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const r=await env.DB.prepare("SELECT id,store_name,contact_name,email,phone,country,status,commission_bps,created_at FROM store_sellers ORDER BY created_at DESC").all();
   return json({sellers:r.results||[]});
 }
 let match=p.match(/^\/store\/admin\/sellers\/([a-zA-Z0-9-]+)$/);
 if(match&&m==="PATCH"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const d=await body(req),status=text(d&&d.status,20),bps=Number(d&&d.commissionBps);
   if(!["pending","approved","rejected","suspended"].includes(status)||!Number.isInteger(bps)||bps<0||bps>5000)return error("حالة أو عمولة غير صالحة.");
   await env.DB.prepare("UPDATE store_sellers SET status=?,commission_bps=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,bps,match[1]).run();
   return json({success:true});
 }
 if(p==="/store/seller/me"&&m==="GET"){
   const s=await seller(req,env);if(!s)return error("حساب البائع غير معتمد أو غير مسجل.",403);
   return json({seller:{id:s.store.id,storeName:s.store.store_name,status:s.store.status,commissionBps:s.store.commission_bps}});
 }
 if(p==="/store/admin/warehouses"&&m==="GET"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const r=await env.DB.prepare("SELECT * FROM store_warehouses ORDER BY created_at DESC").all();return json({warehouses:r.results||[]});
 }
 if(p==="/store/admin/warehouses"&&m==="POST"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const d=await body(req),name=text(d&&d.name,120),code=text(d&&d.code,40).toUpperCase();
   if(!name||!code)return error("اسم المستودع ورمزه مطلوبان.");
   const id=crypto.randomUUID();try{await env.DB.prepare("INSERT INTO store_warehouses(id,code,name,country,city,address) VALUES(?,?,?,?,?,?)").bind(id,code,name,text(d.country,100),text(d.city,100),text(d.address,500)).run()}catch{return error("رمز المستودع مستخدم بالفعل.",409)}
   return json({success:true,id},201);
 }
 if(p==="/store/admin/warehouses/stock"&&m==="PUT"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const d=await body(req),productId=text(d&&d.productId,80),warehouseId=text(d&&d.warehouseId,80),qty=Number(d&&d.quantity);
   if(!productId||!warehouseId||!Number.isInteger(qty)||qty<0)return error("بيانات المخزون غير صالحة.");
   try{await env.DB.prepare("INSERT INTO store_warehouse_stock(product_id,warehouse_id,quantity,reserved) VALUES(?,?,?,0) ON CONFLICT(product_id,warehouse_id) DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP").bind(productId,warehouseId,qty).run();
     const total=await env.DB.prepare("SELECT COALESCE(SUM(quantity-reserved),0) AS n FROM store_warehouse_stock WHERE product_id=?").bind(productId).first();
     await env.DB.prepare("UPDATE store_products SET stock=? WHERE id=?").bind(total.n,productId).run();
   }catch{return error("تعذر تحديث المخزون. تحقق من المنتج والمستودع.",409)}
   return json({success:true,available:total.n});
 }
 if(p==="/store/admin/carriers"&&m==="GET"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const r=await env.DB.prepare("SELECT id,code,name,website,tracking_url_template,integration_type,enabled FROM store_shipping_carriers ORDER BY name").all();return json({carriers:r.results||[]});
 }
 if(p==="/store/admin/carriers"&&m==="POST"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const d=await body(req),name=text(d&&d.name,120),code=text(d&&d.code,50).toLowerCase(),type=text(d&&d.integrationType,20)||"manual";
   if(!name||!code||!["manual","aggregator","direct_api"].includes(type))return error("بيانات شركة الشحن غير صالحة.");
   const id=crypto.randomUUID();try{await env.DB.prepare("INSERT INTO store_shipping_carriers(id,code,name,website,tracking_url_template,integration_type,enabled) VALUES(?,?,?,?,?,?,?)").bind(id,code,name,text(d.website,500),text(d.trackingUrlTemplate,1000),type,d.enabled?1:0).run()}catch{return error("رمز شركة الشحن موجود مسبقاً.",409)}
   return json({success:true,id},201);
 }
 if(p==="/store/admin/shipments"&&m==="POST"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const d=await body(req),orderId=text(d&&d.orderId,80),carrierId=text(d&&d.carrierId,80),tracking=text(d&&d.trackingNumber,160),warehouseId=text(d&&d.warehouseId,80);
   if(!orderId||!carrierId||!tracking)return error("الطلب وشركة الشحن ورقم التتبع مطلوبة.");
   const c=await env.DB.prepare("SELECT * FROM store_shipping_carriers WHERE id=? AND enabled=1").bind(carrierId).first();if(!c)return error("شركة الشحن غير مفعلة أو غير موجودة.",404);
   const order=await env.DB.prepare("SELECT id FROM store_orders WHERE id=?").bind(orderId).first();if(!order)return error("الطلب غير موجود.",404);
   const id=crypto.randomUUID(),track=trackingUrl(c.tracking_url_template,tracking)||text(d.trackingUrl,1000);
   await env.DB.prepare("INSERT INTO store_shipments(id,order_id,carrier_id,warehouse_id,tracking_number,tracking_url,status,shipped_at,last_event_at) VALUES(?,?,?,?,?,?, 'shipped',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").bind(id,orderId,carrierId,warehouseId||null,tracking,track).run();
   await env.DB.prepare("UPDATE store_orders SET order_status='shipped',carrier_id=?,tracking_number=?,tracking_url=?,shipped_at=CURRENT_TIMESTAMP,shipping_method=? WHERE id=?").bind(carrierId,tracking,track,c.name,orderId).run();
   await env.DB.prepare("INSERT INTO store_shipment_events(id,shipment_id,status,description,source) VALUES(?,?,'shipped','تم تسليم الشحنة لشركة النقل','manual')").bind(crypto.randomUUID(),id).run();
   return json({success:true,shipmentId:id,trackingUrl:track},201);
 }
 match=p.match(/^\/store\/track\/([a-zA-Z0-9-]+)$/);
 if(match&&m==="GET"){
   const o=await env.DB.prepare("SELECT order_number,order_status,shipping_method,tracking_number,tracking_url,shipped_at,delivered_at FROM store_orders WHERE order_number=?").bind(match[1]).first();
   if(!o)return error("لم يتم العثور على الطلب.",404);
   const sh=await env.DB.prepare("SELECT id,status,tracking_number,tracking_url,created_at FROM store_shipments WHERE order_id=(SELECT id FROM store_orders WHERE order_number=?) ORDER BY created_at DESC LIMIT 1").bind(match[1]).first();
   let events=[];if(sh){const r=await env.DB.prepare("SELECT status,description,location,event_at FROM store_shipment_events WHERE shipment_id=? ORDER BY event_at DESC").bind(sh.id).all();events=r.results||[]}
   return json({orderNumber:o.order_number,status:o.order_status,carrier:o.shipping_method,trackingNumber:o.tracking_number,trackingUrl:o.tracking_url,shippedAt:o.shipped_at,deliveredAt:o.delivered_at,events});
 }
 return null;
}
