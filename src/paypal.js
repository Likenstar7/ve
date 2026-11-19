const ORIGIN = "https://mushmoreby.blogspot.com";
const API = "https://api-m.paypal.com";
const SANDBOX = "https://api-m.sandbox.paypal.com";
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":ORIGIN,"access-control-allow-methods":"GET, POST, OPTIONS","access-control-allow-headers":"Content-Type, Authorization","cache-control":"no-store","vary":"Origin"}});
const err=(m,s=400)=>json({error:m},s);
const txt=(v,n=254)=>typeof v==="string"?v.trim().slice(0,n):"";
function paypalBase(env){return env.PAYPAL_ENVIRONMENT==="sandbox"?SANDBOX:API}
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
  const email=txt(d.email).toLowerCase(),items=Array.isArray(d.items)?d.items:[];
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!items.length||items.length>30)return err("أدخل بريداً صحيحاً وأضف منتجات إلى السلة.");
  const quantities=new Map();for(const x of items){const id=txt(x.id,80),q=Number(x.quantity);if(!id||!Number.isInteger(q)||q<1||q>50)return err("عنصر في السلة غير صالح.");quantities.set(id,(quantities.get(id)||0)+q);}
  const ids=[...quantities.keys()],marks=ids.map(()=>"?").join(",");
  const result=await env.DB.prepare("SELECT id,title,sku,price_cents,stock,active,product_type FROM store_products WHERE id IN ("+marks+")").bind(...ids).all();
  const rows=new Map((result.results||[]).map(x=>[x.id,x]));let total=0;const snapshot=[];
  for(const [id,q] of quantities){const p=rows.get(id);if(!p||!p.active)return err("أحد المنتجات لم يعد متاحاً.",409);if(p.product_type!=="digital"&&p.stock<q)return err("المخزون غير كافٍ للمنتج "+p.title,409);total+=p.price_cents*q;snapshot.push({id,title:p.title,sku:p.sku||"",quantity:q,unitPriceCents:p.price_cents,productType:p.product_type});}
  if(!Number.isSafeInteger(total)||total<1)return err("إجمالي الطلب غير صالح.");
  try{
   const token=await paypalToken(env),order=await paypalFetch(env,"/v2/checkout/orders",token,{intent:"CAPTURE",purchase_units:[{reference_id:crypto.randomUUID(),custom_id:crypto.randomUUID(),description:"Mushmore order: "+snapshot.map(x=>x.sku||x.id).join(", ").slice(0,120),amount:{currency_code:"EUR",value:(total/100).toFixed(2)}}],payment_source:{paypal:{experience_context:{brand_name:"Mushmore",shipping_preference:"NO_SHIPPING",user_action:"PAY_NOW"}}}});
   await env.DB.prepare("INSERT INTO store_paypal_payments(paypal_order_id,customer_email,items_json,amount_cents,currency,status) VALUES(?,?,?,?,?,'created')").bind(order.id,email,JSON.stringify(snapshot),total,"EUR").run();
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
    if(!up.success||up.meta?.changes!==1){for(const x of updates)await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(x.q,x.id).run();return err("المخزون تغيّر أثناء الدفع. تواصل مع المتجر لاسترداد المبلغ.",409);}
    updates.push({id:item.id,q:item.quantity});
    const whs=await env.DB.prepare("SELECT warehouse_id,quantity,reserved FROM store_warehouse_stock WHERE product_id=? ORDER BY warehouse_id").bind(item.id).all();let left=item.quantity;
    for(const w of whs.results||[]){const n=Math.min(left,Math.max(0,w.quantity-w.reserved));if(n){await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity-?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND warehouse_id=?").bind(n,item.id,w.warehouse_id).run();warehouseUpdates.push({id:item.id,w:w.warehouse_id,q:n});left-=n;}if(!left)break;}
    if(left){for(const x of updates)await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(x.q,x.id).run();for(const x of warehouseUpdates)await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity+? WHERE product_id=? AND warehouse_id=?").bind(x.q,x.id,x.w).run();return err("مخزون المستودعات غير متزامن. تواصل مع المتجر لاسترداد المبلغ.",409);}
   }
   const id=crypto.randomUUID(),number="MM-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,4).toUpperCase(),total=payment.amount_cents;
   try{
    await env.DB.prepare("INSERT INTO store_orders(id,order_number,customer_name,customer_email,customer_phone,shipping_address,shipping_city,shipping_postcode,shipping_country,items_json,subtotal_cents,shipping_cents,total_cents,currency,payment_method,payment_status,order_status) VALUES(?,?,?,?,'','','','','',?,?,0,?,'EUR','online','paid','new')").bind(id,number,email,email,JSON.stringify(items),total,total).run();
    await env.DB.prepare("UPDATE store_paypal_payments SET status='completed',order_id=?,updated_at=CURRENT_TIMESTAMP WHERE paypal_order_id=?").bind(id,paypalId).run();
   }catch(e){for(const x of updates)await env.DB.prepare("UPDATE store_products SET stock=stock+? WHERE id=?").bind(x.q,x.id).run();for(const x of warehouseUpdates)await env.DB.prepare("UPDATE store_warehouse_stock SET quantity=quantity+? WHERE product_id=? AND warehouse_id=?").bind(x.q,x.id,x.w).run();throw e;}
   return json({success:true,orderNumber:number,total:total/100,currency:"EUR"});
  }catch(e){return err(e.message||"تعذر تأكيد الدفع.",502);}
 }
 return err("المسار غير موجود.",404);
}
