const ORIGIN = "https://mushmoreby.blogspot.com";
const API = "https://api-m.paypal.com";
const SANDBOX = "https://api-m.sandbox.paypal.com";
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":ORIGIN,"access-control-allow-methods":"GET, POST, OPTIONS","access-control-allow-headers":"Content-Type, Authorization","cache-control":"no-store","vary":"Origin"}});
const err=(m,s=400)=>json({error:m},s);
const txt=(v,n=254)=>typeof v==="string"?v.trim().slice(0,n):"";
function paypalBase(env){return env.PAYPAL_ENVIRONMENT==="live"?API:SANDBOX}
async function paypalToken(env){
 if(!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET)throw new Error("PayPal غير مضبوط بعد. أضف PAYPAL_CLIENT_ID وPAYPAL_CLIENT_SECRET إلى Cloudflare Worker Secrets.");
 const r=await fetch(paypalBase(env)+"/v1/oauth2/token",{method:"POST",headers:{authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET),"content-type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
 const d=await r.json();if(!r.ok||!d.access_token)throw new Error("تعذر الاتصال ببوابة PayPal.");return d.access_token;
}
async function paypalFetch(env,path,token,body){
 const r=await fetch(paypalBase(env)+path,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json","prefer":"return=representation"},body:JSON.stringify(body)});
 const d=await r.json();if(!r.ok)throw new Error(d.message||"تعذر إكمال عملية PayPal.");return d;
}
export async function handlePaypalRequest(req,env){
 const u=new URL(req.url);if(!u.pathname.startsWith("/store/paypal/"))return null;
 if(req.headers.get("Origin")!==ORIGIN)return new Response("Forbidden",{status:403});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":ORIGIN,"access-control-allow-methods":"GET, POST, OPTIONS","access-control-allow-headers":"Content-Type, Authorization"}});
 if(u.pathname==="/store/paypal/config"&&req.method==="GET"){
  if(!env.PAYPAL_CLIENT_ID)return err("بوابة PayPal لم تُضبط بعد.",503);
  return json({clientId:env.PAYPAL_CLIENT_ID,currency:"EUR",intent:"capture"});
 }
 if(u.pathname==="/store/paypal/create"&&req.method==="POST"){
  let d;try{d=await req.json()}catch{return err("بيانات الطلب غير صالحة.");}
  const email=txt(d.email).toLowerCase(),items=Array.isArray(d.items)?d.items:[],lat=d.latitude===""||d.latitude==null?null:Number(d.latitude),lng=d.longitude===""||d.longitude==null?null:Number(d.longitude);
  const customerName=txt(d.customerName,120),customerPhone=txt(d.customerPhone,50),shippingAddress=txt(d.shippingAddress,300),shippingCity=txt(d.shippingCity,100),shippingPostcode=txt(d.shippingPostcode,30),shippingCountry=txt(d.shippingCountry,2).toUpperCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!items.length||items.length>30)return err("أدخل بريداً صحيحاً وأضف منتجات إلى السلة.");
  if(!customerName||!customerPhone)return err("أدخل اسم المستلم ورقم الهاتف.");

  const quantities=new Map();for(const x of items){const id=txt(x.id,80),q=Number(x.quantity);if(!id||!Number.isInteger(q)||q<1||q>50)return err("عنصر في السلة غير صالح.");quantities.set(id,(quantities.get(id)||0)+q);}
  const ids=[...quantities.keys()],marks=ids.map(()=>"?").join(",");
  const result=await env.DB.prepare("SELECT p.id,p.title,p.sku,p.price_cents,p.stock,p.active,p.product_type,p.seller_id,COALESCE(s.commission_bps,1000) AS commission_bps FROM store_products p LEFT JOIN store_sellers s ON s.id=p.seller_id WHERE p.id IN ("+marks+")").bind(...ids).all();
  const rows=new Map((result.results||[]).map(x=>[x.id,x]));let total=0;const snapshot=[];
  let hasPhysical=false;
  for(const [id,q] of quantities){const p=rows.get(id);if(!p||!p.active)return err("أحد المنتجات لم يعد متاحاً.",409);if(p.product_type!=="digital"&&p.stock<q)return err("المخزون غير كافٍ للمنتج "+p.title,409);if(p.product_type!=="digital")hasPhysical=true;total+=p.price_cents*q;snapshot.push({id,title:p.title,sku:p.sku||"",quantity:q,unitPriceCents:p.price_cents,productType:p.product_type,sellerId:p.seller_id||null,commissionBps:p.commission_bps});}
  if(hasPhysical&&(!shippingAddress||!shippingCity||!/^([A-Z]{2})$/.test(shippingCountry)))return err("للطلبات المادية أدخل عنوان الشحن والمدينة ورمز البلد الدولي من حرفين.");
  if(!Number.isSafeInteger(total)||total<1)return err("إجمالي الطلب غير صالح.");
  try{
   const token=await paypalToken(env);
   const purchaseUnit={reference_id:crypto.randomUUID(),custom_id:crypto.randomUUID(),description:"Mushmore order: "+snapshot.map(x=>x.sku||x.id).join(", ").slice(0,120),amount:{currency_code:"EUR",value:(total/100).toFixed(2)}};
   if(hasPhysical)purchaseUnit.shipping={name:{full_name:customerName},address:{address_line_1:shippingAddress,admin_area_2:shippingCity,postal_code:shippingPostcode||undefined,country_code:shippingCountry}};
   const order=await paypalFetch(env,"/v2/checkout/orders",token,{intent:"CAPTURE",purchase_units:[purchaseUnit],payment_source:{paypal:{experience_context:{brand_name:"Mushmore",shipping_preference:hasPhysical?"SET_PROVIDED_ADDRESS":"NO_SHIPPING",user_action:"PAY_NOW"}}}});
   await env.DB.prepare("INSERT INTO store_paypal_payments(paypal_order_id,customer_email,items_json,amount_cents,currency,status,buyer_latitude,buyer_longitude,customer_name,customer_phone,shipping_address,shipping_city,shipping_postcode,shipping_country) VALUES(?,?,?,?,?,'created',?,?,?,?,?,?,?,?)").bind(order.id,email,JSON.stringify(snapshot),total,"EUR",Number.isFinite(lat)&&lat>=-90&&lat<=90?lat:null,Number.isFinite(lng)&&lng>=-180&&lng<=180?lng:null,customerName,customerPhone,shippingAddress,shippingCity,shippingPostcode,shippingCountry).run();
   return json({id:order.id,status:order.status},201);
  }catch(e){return err(e.message||"تعذر إنشاء دفعة PayPal.",502);}
 }
 if(u.pathname==="/store/paypal/capture"&&req.method==="POST"){
  let d;try{d=await req.json()}catch{return err("بيانات الدفع غير صالحة.");}
  const paypalId=txt(d.paypalOrderId,100),email=txt(d.email).toLowerCase();
  if(!paypalId||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return err("معرّف الدفع أو البريد غير صالح.");
  const payment=await env.DB.prepare("SELECT * FROM store_paypal_payments WHERE paypal_order_id=? AND customer_email=?").bind(paypalId,email).first();
  if(!payment)return err("لم يتم العثور على جلسة الدفع.",404);
  if(payment.status==="completed"&&payment.order_id){const o=await env.DB.prepare("SELECT order_number,total_cents FROM store_orders WHERE id=?").bind(payment.order_id).first();return json({success:true,orderNumber:o.order_number,total:o.total_cents/100,currency:"EUR"});}
  try{
   const token=await paypalToken(env),captured=await paypalFetch(env,"/v2/checkout/orders/"+encodeURIComponent(paypalId)+"/capture",token,{});
   if(captured.status!=="COMPLETED")return err("لم يؤكد PayPal استلام المبلغ.",402);
   const cap=captured.purchase_units?.[0]?.payments?.captures?.[0];
   if(!cap||cap.status!=="COMPLETED"||Number(cap.amount?.value).toFixed(2)!==(payment.amount_cents/100).toFixed(2)||cap.amount?.currency_code!=="EUR")return err("تعذر مطابقة مبلغ الدفع مع الطلب.",409);
   const items=JSON.parse(payment.items_json),updates=[],warehouseUpdates=[];
   for(const item of items){
    if(item.productType==="digital")continue;
    const up=await env.DB.prepare("UPDATE store_products SET stock=stock-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND active=1 AND stock>=?").bind(item.quantity,item.id,item.quantity).run();
    if(!up.success||up.meta?.changes!==1){for(const x of updates)await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(x.q,x.id).run();for(const x of warehouseUpdates)await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND warehouse_id=?").bind(x.q,x.id,x.w).run();return err("المخزون تغيّر أثناء الدفع. تواصل مع المتجر لاسترداد المبلغ.",409);}
    updates.push({id:item.id,q:item.quantity});
    const whs=await env.DB.prepare("SELECT warehouse_id,quantity,reserved FROM store_warehouse_stock WHERE product_id=? ORDER BY warehouse_id").bind(item.id).all();let left=item.quantity;
    for(const w of whs.results||[]){const n=Math.min(left,Math.max(0,w.quantity-w.reserved));if(n){await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity-?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND warehouse_id=?").bind(n,item.id,w.warehouse_id).run();warehouseUpdates.push({id:item.id,w:w.warehouse_id,q:n});left-=n;}if(!left)break;}
    if(left){for(const x of updates)await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(x.q,x.id).run();for(const x of warehouseUpdates)await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity+? WHERE product_id=? AND warehouse_id=?").bind(x.q,x.id,x.w).run();return err("مخزون المستودعات غير متزامن. تواصل مع المتجر لاسترداد المبلغ.",409);}
   }
   const id=crypto.randomUUID(),number="MM-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,4).toUpperCase(),total=payment.amount_cents;
   try{
    await env.DB.prepare("INSERT INTO store_orders(id,order_number,customer_name,customer_email,customer_phone,shipping_address,shipping_city,shipping_postcode,shipping_country,items_json,subtotal_cents,shipping_cents,total_cents,currency,payment_method,payment_status,order_status,buyer_latitude,buyer_longitude) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,'EUR','online','paid','new',?,?)").bind(id,number,payment.customer_name||email,email,payment.customer_phone||"",payment.shipping_address||"",payment.shipping_city||"",payment.shipping_postcode||"",payment.shipping_country||"",JSON.stringify(items),total,total,payment.buyer_latitude,payment.buyer_longitude).run();
    await env.DB.prepare("UPDATE store_paypal_payments SET status='completed',order_id=?,updated_at=CURRENT_TIMESTAMP WHERE paypal_order_id=?").bind(id,paypalId).run();
    for(const item of items){if(!item.sellerId)continue;const gross=item.unitPriceCents*item.quantity,net=Math.floor(gross*(10000-item.commissionBps)/10000);if(net>0)await env.DB.prepare("INSERT OR IGNORE INTO store_seller_ledger(id,seller_id,order_id,entry_type,amount_cents,currency,status,description,reference) VALUES(?,?,?,'sale_credit',?,'EUR','available',?,?)").bind(crypto.randomUUID(),item.sellerId,id,net,"مستحقات بيع SKU "+(item.sku||item.id),item.sku||item.id).run();}
   }catch(e){for(const x of updates)await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(x.q,x.id).run();for(const x of warehouseUpdates)await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity+? WHERE product_id=? AND warehouse_id=?").bind(x.q,x.id,x.w).run();throw e;}
   return json({success:true,orderNumber:number,total:total/100,currency:"EUR"});
  }catch(e){return err(e.message||"تعذر تأكيد الدفع.",502);}
 }
 return err("المسار غير موجود.",404);
}
