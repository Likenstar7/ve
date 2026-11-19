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
   const storeName=text(d.storeName,120),phone=text(d.phone,50),country=text(d.country,100),latitude=d.latitude===""||d.latitude==null?null:Number(d.latitude),longitude=d.longitude===""||d.longitude==null?null:Number(d.longitude);
   if(!storeName||!u.email)return error("اسم المتجر والبريد مطلوبان.");
   const id=crypto.randomUUID();
   try{await env.DB.prepare("INSERT INTO store_sellers(id,firebase_uid,store_name,contact_name,email,phone,country,latitude,longitude) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,u.uid,storeName,u.name,u.email,phone,country,Number.isFinite(latitude)&&latitude>=-90&&latitude<=90?latitude:null,Number.isFinite(longitude)&&longitude>=-180&&longitude<=180?longitude:null).run();}
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

 if(p==="/store/seller/products"&&(m==="GET"||m==="POST")){
   const s=await seller(req,env);if(!s)return error("حساب البائع غير معتمد أو غير مسجل.",403);
   if(m==="GET"){
     const r=await env.DB.prepare("SELECT id,title,slug,sku,description,category,image_url,price_cents,compare_at_cents,stock,active,product_type FROM store_products WHERE seller_id=? ORDER BY created_at DESC").bind(s.store.id).all();
     return json({products:(r.results||[]).map(x=>({...x,price:x.price_cents/100,compareAtPrice:x.compare_at_cents==null?null:x.compare_at_cents/100}))});
   }
   const d=await body(req);if(!d)return error("البيانات غير صالحة.");
   const title=text(d.title,160),sku=text(d.sku,80).toUpperCase(),price=Number(d.priceCents),stock=Number(d.stock);
   if(!title||!sku||!Number.isSafeInteger(price)||price<0||!Number.isInteger(stock)||stock<0)return error("الاسم وSKU والسعر والمخزون مطلوبة.");
   const id=crypto.randomUUID(),slug=(title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||id);
   try{await env.DB.prepare("INSERT INTO store_products(id,title,slug,sku,description,category,image_url,price_cents,stock,active,product_type,seller_id) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)").bind(id,title,slug,sku,text(d.description,5000),text(d.category,80),text(d.imageUrl,1000),price,stock,d.productType==="digital"?"digital":"physical",s.store.id).run();}
   catch{return error("تعذر إضافة المنتج؛ تحقق من أن SKU غير مستخدم.",409)}
   await env.DB.prepare("INSERT OR REPLACE INTO store_warehouse_stock(product_id,warehouse_id,quantity,reserved) VALUES(?,?,?,0)").bind(id,"wh-default",stock).run();
   return json({success:true,id},201);
 }


 // Seller USDT wallet management. Wallet addresses are public identifiers; never request private keys.
 if(p==="/store/seller/wallets"&&(m==="GET"||m==="POST")){
   const s=await seller(req,env);if(!s)return error("حساب البائع غير معتمد أو غير مسجل.",403);
   if(m==="GET"){const r=await env.DB.prepare("SELECT id,asset,network,wallet_address,label,status,created_at FROM store_seller_wallets WHERE seller_id=? ORDER BY created_at DESC").bind(s.store.id).all();return json({wallets:r.results||[]});}
   const d=await body(req),network=text(d&&d.network,20).toUpperCase(),address=text(d&&d.address,180),label=text(d&&d.label,80);
   if(!["TRC20","ERC20","BEP20","POLYGON","ARBITRUM"].includes(network)||address.length<20||address.length>180)return error("اختر شبكة مدعومة وأدخل عنوان محفظة صحيحاً مبدئياً.");
   const id=crypto.randomUUID();try{await env.DB.prepare("INSERT INTO store_seller_wallets(id,seller_id,network,wallet_address,label,status) VALUES(?,?,?,?,?,'pending')").bind(id,s.store.id,network,address,label).run();}catch{return error("هذه المحفظة مسجلة مسبقاً أو البيانات غير صالحة.",409);}
   return json({success:true,walletId:id,status:"pending",message:"أضيفت المحفظة وتحتاج إلى التحقق قبل استخدامها."},201);
 }
 if(p==="/store/seller/earnings"&&m==="GET"){
   const s=await seller(req,env);if(!s)return error("حساب البائع غير معتمد أو غير مسجل.",403);
   const r=await env.DB.prepare("SELECT currency,COALESCE(SUM(CASE WHEN status='available' AND entry_type IN ('sale_credit','adjustment_credit') THEN amount_cents WHEN status='available' AND entry_type IN ('refund_debit','payout_debit','adjustment_debit') THEN -amount_cents ELSE 0 END),0) AS available_cents FROM store_seller_ledger WHERE seller_id=? GROUP BY currency").bind(s.store.id).all();
   const payouts=await env.DB.prepare("SELECT id,amount_cents,source_currency,payout_asset,network,status,compliance_status,txid,created_at,paid_at FROM store_seller_payouts WHERE seller_id=? ORDER BY created_at DESC LIMIT 50").bind(s.store.id).all();
   return json({balances:r.results||[],payouts:payouts.results||[]});
 }
 if(p==="/store/seller/payouts"&&m==="POST"){
   const s=await seller(req,env);if(!s)return error("حساب البائع غير معتمد أو غير مسجل.",403);
   if(env.PAYOUTS_ENABLED!=="true"||env.PAYOUT_COMPLIANCE_CLEARED!=="true")return error("طلبات السحب متوقفة حتى اكتمال اعتماد الامتثال ومزود التحويل.",503);
   const d=await body(req),walletId=text(d&&d.walletId,80),amount=Math.floor(Number(d&&d.amountCents)),key=text(d&&d.idempotencyKey,100);
   if(!walletId||!Number.isSafeInteger(amount)||amount<100||!key)return error("حدد محفظة موثقة ومبلغاً صالحاً ومفتاح طلب فريداً.");
   const w=await env.DB.prepare("SELECT * FROM store_seller_wallets WHERE id=? AND seller_id=? AND status IN ('pending','verified')").bind(walletId,s.store.id).first();
   if(!w)return error("المحفظة غير موثقة أو لا تخص هذا البائع.",403);
   const bal=await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN entry_type IN ('sale_credit','adjustment_credit') THEN amount_cents ELSE -amount_cents END),0) AS n FROM store_seller_ledger WHERE seller_id=? AND currency='EUR' AND status='available'").bind(s.store.id).first();
   const queued=await env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM store_seller_payouts WHERE seller_id=? AND source_currency='EUR' AND status IN ('requested','under_review','approved','processing')").bind(s.store.id).first();
   if(amount>Number(bal.n)-Number(queued.n))return error("المبلغ يتجاوز رصيدك المتاح بعد احتساب طلبات السحب القائمة.",409);
   const id=crypto.randomUUID();
   try{await env.DB.prepare("INSERT INTO store_seller_payouts(id,seller_id,wallet_id,amount_cents,network,idempotency_key) VALUES(?,?,?,?,?,?)").bind(id,s.store.id,walletId,amount,w.network,key).run();}catch{return error("مفتاح الطلب مستخدم أو تعذر إنشاء الطلب.",409);}
   return json({success:true,payoutId:id,status:"requested",message:"تم تسجيل الطلب وسيخضع لمراجعة الامتثال وموافقة الإدارة."},201);
 }

 const walletAdminMatch=p.match(/^\/store\/admin\/wallets\/([a-zA-Z0-9-]+)$/);
 if(walletAdminMatch&&m==="PATCH"){
   const a=await admin(req,env);if(!a)return error("غير مصرح.",401);
   const d=await body(req),status=text(d&&d.status,20);
   if(!["verified","rejected","disabled"].includes(status))return error("حالة المحفظة غير صالحة.");
   const r=await env.DB.prepare("UPDATE store_seller_wallets SET status=?,verified_at=CASE WHEN ?='verified' THEN CURRENT_TIMESTAMP ELSE verified_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','verified')").bind(status,status,walletAdminMatch[1]).run();
   if(!r.meta?.changes)return error("لم يتم العثور على محفظة قابلة للتحديث.",404);
   return json({success:true,status});
 }
 if(p==="/store/admin/payouts"&&m==="GET"){
   if(!await admin(req,env))return error("غير مصرح.",401);
   const r=await env.DB.prepare("SELECT p.*,s.store_name,s.email,w.wallet_address,w.label AS wallet_label FROM store_seller_payouts p JOIN store_sellers s ON s.id=p.seller_id JOIN store_seller_wallets w ON w.id=p.wallet_id ORDER BY p.created_at DESC LIMIT 200").all();
   return json({payouts:r.results||[]});
 }
 match=p.match(/^\/store\/admin\/payouts\/([a-zA-Z0-9-]+)$/);
 if(match&&m==="PATCH"){
   const a=await admin(req,env);if(!a)return error("غير مصرح.",401);
   const d=await body(req),action=text(d&&d.action,20),note=text(d&&d.note,1000);
   const pyo=await env.DB.prepare("SELECT * FROM store_seller_payouts WHERE id=?").bind(match[1]).first();if(!pyo)return error("طلب السحب غير موجود.",404);
   if(action==="verify_wallet"){
     const r=await env.DB.prepare("UPDATE store_seller_wallets SET status='verified',verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND seller_id=? AND status='pending'").bind(pyo.wallet_id,pyo.seller_id).run();
     if(!r.meta?.changes)return error("تعذر توثيق المحفظة.",409);
     await env.DB.prepare("INSERT INTO store_payout_audit(id,payout_id,actor_uid,action,details) VALUES(?,?,?,'wallet_verified',?)").bind(crypto.randomUUID(),pyo.id,a.uid,note).run();
     return json({success:true});
   }
   if(action==="clear_compliance"){
     if(env.PAYOUTS_ENABLED!=="true"||env.PAYOUT_COMPLIANCE_CLEARED!=="true")return error("اعتماد الامتثال العام غير مفعّل في إعدادات Worker.",403);
     if(note.length<20)return error("أضف مرجع التحقق وملاحظات الامتثال (20 حرفاً على الأقل).");
     await env.DB.prepare("UPDATE store_seller_payouts SET compliance_status='cleared',compliance_note=?,status='under_review',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('requested','under_review')").bind(note,pyo.id).run();
     await env.DB.prepare("INSERT INTO store_payout_audit(id,payout_id,actor_uid,action,details) VALUES(?,?,?,'compliance_cleared',?)").bind(crypto.randomUUID(),pyo.id,a.uid,note).run();
     return json({success:true,complianceStatus:"cleared"});
   }
   if(action==="approve"){
     const wallet=await env.DB.prepare("SELECT status FROM store_seller_wallets WHERE id=? AND seller_id=?").bind(pyo.wallet_id,pyo.seller_id).first();
     if(!wallet||wallet.status!=="verified")return error("يجب توثيق محفظة البائع قبل الموافقة على الصرف.",403);
     if(env.PAYOUTS_ENABLED!=="true"||env.PAYOUT_COMPLIANCE_CLEARED!=="true")return error("لا يمكن الموافقة قبل تفعيل ضوابط الامتثال ومزود التحويل.",403);
     if(pyo.status!=="requested"&&pyo.status!=="under_review")return error("حالة الطلب لا تسمح بالموافقة.",409);
     if(pyo.compliance_status!=="cleared")return error("يجب إكمال فحص الامتثال وتسجيل compliance_status=cleared أولاً.",403);
     await env.DB.prepare("UPDATE store_seller_payouts SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,compliance_note=? WHERE id=?").bind(a.uid,note,pyo.id).run();
     await env.DB.prepare("INSERT INTO store_payout_audit(id,payout_id,actor_uid,action,details) VALUES(?,?,?,'approved',?)").bind(crypto.randomUUID(),pyo.id,a.uid,note).run();
     return json({success:true,status:"approved",message:"تمت الموافقة. ينتظر الطلب تنفيذ مزود التحويل المعتمد؛ لم يتم إرسال USDT بعد."});
   }
   if(action==="reject"){
     if(!["requested","under_review","approved"].includes(pyo.status))return error("حالة الطلب لا تسمح بالرفض.",409);
     await env.DB.prepare("UPDATE store_seller_payouts SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,compliance_note=? WHERE id=?").bind(a.uid,note,pyo.id).run();
     await env.DB.prepare("INSERT INTO store_payout_audit(id,payout_id,actor_uid,action,details) VALUES(?,?,?,'rejected',?)").bind(crypto.randomUUID(),pyo.id,a.uid,note).run();
     return json({success:true,status:"rejected"});
   }
   return error("الإجراء غير مدعوم.");
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
