import Stripe from "stripe";
import type { Env } from "./env";
import { PublicError, json, requireSession, assertOrigin, body, appOrigin, now, throttle } from "./accounts";
function client(env:Env):Stripe {
 if(!env.STRIPE_SECRET_KEY)throw new PublicError("Membership checkout is not available yet.",503);
 return new Stripe(env.STRIPE_SECRET_KEY,{httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:1});
}
export function billingReady(env:Env):boolean {
 return env.BILLING_ENABLED==="true"&&Boolean(env.STRIPE_SECRET_KEY&&env.STRIPE_WEBHOOK_SECRET&&env.STRIPE_PRICE_MONTHLY&&env.STRIPE_PRICE_ANNUAL);
}
const configuredPrices=(env:Env)=>[env.STRIPE_PRICE_MONTHLY,env.STRIPE_PRICE_ANNUAL].filter(Boolean);
export async function membership(env:Env,id:string) {
 const rows=await env.DB.prepare("SELECT status,price_id,period_end,cancel_at_period_end FROM cq_subscriptions WHERE user_id=? ORDER BY period_end DESC").bind(id).all<{status:string;price_id:string;period_end:number;cancel_at_period_end:number}>();
 const matching=rows.results.filter(r=>configuredPrices(env).includes(r.price_id));
 const active=matching.find(r=>["active","trialing"].includes(r.status)&&r.period_end>now());
 const current=active||matching[0];
 return {active:Boolean(active),status:current?.status||"none",periodEnd:current?.period_end||null,cancelAtPeriodEnd:Boolean(current?.cancel_at_period_end)};
}
async function syncSubscription(env:Env,s:Stripe.Subscription,eventTime:number) {
 const customerId=typeof s.customer==="string"?s.customer:s.customer.id;
 const user=await env.DB.prepare("SELECT id FROM cq_users WHERE stripe_customer_id=?").bind(customerId).first<{id:string}>();
 if(!user)return;
 const item=s.items.data.find(i=>configuredPrices(env).includes(i.price.id));
 const period=item?.current_period_end||0;
 const price=item?.price.id||"unrecognized";
 await env.DB.prepare("INSERT INTO cq_subscriptions(id,user_id,status,price_id,period_end,cancel_at_period_end,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,price_id=excluded.price_id,period_end=excluded.period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=excluded.updated_at WHERE cq_subscriptions.updated_at<=excluded.updated_at").bind(s.id,user.id,s.status,price,period,s.cancel_at_period_end?1:0,eventTime).run();
}
async function refreshCustomer(env:Env,customerId:string) {
 const all=await client(env).subscriptions.list({customer:customerId,status:"all",limit:100});
 for(const s of all.data)await syncSubscription(env,s,now());
 return all.data;
}
function safeStripeURL(value:string|null,host:string):string {
 if(!value)throw new PublicError("Unable to open Stripe. Please try again.",502);
 const url=new URL(value);if(url.protocol!=="https:"||url.hostname!==host)throw new PublicError("Unable to open Stripe.",502);return url.href;
}
export async function billingRoute(request:Request,env:Env):Promise<Response|null> {
 const path=new URL(request.url).pathname;
 if(!path.startsWith("/api/billing/")&&path!=="/api/stripe/webhook")return null;
 if(!env.DB)throw new PublicError("Account storage is unavailable.",503);
 if(path==="/api/stripe/webhook"){
 if(request.method!=="POST")throw new PublicError("Method not allowed.",405);
 if(!env.STRIPE_WEBHOOK_SECRET||!env.STRIPE_SECRET_KEY)throw new PublicError("Billing notifications are not configured.",503);
 if(Number(request.headers.get("Content-Length")||0)>1000000)throw new PublicError("Payload too large.",413);
 const raw=await request.text();if(raw.length>1000000)throw new PublicError("Payload too large.",413);
 let event:Stripe.Event;
 try{event=await client(env).webhooks.constructEventAsync(raw,request.headers.get("Stripe-Signature")||"",env.STRIPE_WEBHOOK_SECRET,300,Stripe.createSubtleCryptoProvider());}
 catch{throw new PublicError("Invalid Stripe signature.",400);}
 if(event.livemode!==env.STRIPE_SECRET_KEY.startsWith("sk_live_"))throw new PublicError("Billing mode mismatch.",400);
 if(await env.DB.prepare("SELECT id FROM cq_stripe_events WHERE id=?").bind(event.id).first())return json({received:true});
 const supported=["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed","customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed"];
 if(supported.includes(event.type)){
 const obj=event.data.object as unknown as Record<string,unknown>;
 const value=obj.customer;
 const customerId=typeof value==="string"?value:null;
 // Fetch the current Stripe state rather than granting access from a redirect or
 // trusting an old webhook snapshot. Inactive/expired subscriptions revoke access.
 if(customerId)await refreshCustomer(env,customerId);
 }
 await env.DB.prepare("INSERT OR IGNORE INTO cq_stripe_events(id,processed_at) VALUES(?,?)").bind(event.id,now()).run();
 return json({received:true});
 }
 if(path==="/api/billing/plans"&&request.method==="GET"){
 if(!billingReady(env))return json({enabled:false,plans:[],testMode:true});
 const stripe=client(env),plans=[];
 for(const [interval,id] of [["monthly",env.STRIPE_PRICE_MONTHLY],["annual",env.STRIPE_PRICE_ANNUAL]] as const){
 const price=await stripe.prices.retrieve(id!);
 if(!price.active||price.type!=="recurring"||price.unit_amount===null||price.recurring?.interval!==(interval==="monthly"?"month":"year")||price.recurring?.interval_count!==1)throw new PublicError("Membership plans are not configured correctly.",503);
 plans.push({interval,amount:price.unit_amount,currency:price.currency});
 }
 return json({enabled:true,plans,testMode:!env.STRIPE_SECRET_KEY?.startsWith("sk_live_")});
 }
 const s=await requireSession(request,env);
 if(path==="/api/billing/status"&&request.method==="GET")return json({membership:await membership(env,s.id),enabled:billingReady(env),testMode:!env.STRIPE_SECRET_KEY?.startsWith("sk_live_"),hasCustomer:Boolean(s.stripe_customer_id)});
 if(request.method!=="POST")throw new PublicError("Method not allowed.",405);
 assertOrigin(request);await throttle(request,env,"billing",s.email);
 if(!billingReady(env))throw new PublicError("Membership checkout is not available yet.",503);
 const stripe=client(env),origin=appOrigin(request,env);
 if(path==="/api/billing/refresh"){
 if(s.stripe_customer_id)await refreshCustomer(env,s.stripe_customer_id);
 return json({membership:await membership(env,s.id)});
 }
 if(path==="/api/billing/portal"){
 if(!s.stripe_customer_id)throw new PublicError("You do not have a billing account yet.");
 const p=await stripe.billingPortal.sessions.create({customer:s.stripe_customer_id,return_url:origin+"/?account=1"});
 return json({url:safeStripeURL(p.url,"billing.stripe.com")});
 }
 if(path==="/api/billing/checkout"){
 const data=await body(request);
 const interval=data.interval;if(interval!=="monthly"&&interval!=="annual")throw new PublicError("Choose monthly or annual billing.");
 const price=interval==="monthly"?env.STRIPE_PRICE_MONTHLY!:env.STRIPE_PRICE_ANNUAL!;
 const lock=await env.DB.prepare("INSERT INTO cq_billing_locks(user_id,expires_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING user_id").bind(s.id,now()+90,now()).first();
 if(!lock)throw new PublicError("Checkout is already opening. Please try again shortly.",409);
 try {
 let customer=s.stripe_customer_id;
 if(!customer){
 const c=await stripe.customers.create({email:s.email,name:s.name,metadata:{cq_user_id:s.id}},{idempotencyKey:"cq-customer-"+s.id});
 customer=c.id;
 await env.DB.prepare("UPDATE cq_users SET stripe_customer_id=? WHERE id=?").bind(customer,s.id).run();
 }
 const subscriptions=await refreshCustomer(env,customer);
 if(subscriptions.some(sub=>sub.items.data.some(i=>configuredPrices(env).includes(i.price.id))&&!["canceled","incomplete_expired"].includes(sub.status)))throw new PublicError("A subscription already exists. Use Manage billing to change your plan or payment method.",409);
 const pending=await env.DB.prepare("SELECT session_id,price_id FROM cq_checkouts WHERE user_id=?").bind(s.id).first<{session_id:string;price_id:string}>();
 if(pending) {
 const existing=await stripe.checkout.sessions.retrieve(pending.session_id);
 if(existing.status==="open"&&pending.price_id===price)return json({url:safeStripeURL(existing.url,"checkout.stripe.com")});
 if(existing.status==="open")await stripe.checkout.sessions.expire(existing.id);
 }
 const checkout=await stripe.checkout.sessions.create({mode:"subscription",customer,line_items:[{price,quantity:1}],client_reference_id:s.id,metadata:{cq_user_id:s.id},subscription_data:{metadata:{cq_user_id:s.id}},success_url:origin+"/?account=1&checkout=success",cancel_url:origin+"/?account=1&checkout=cancelled"});
 await env.DB.prepare("INSERT INTO cq_checkouts(user_id,session_id,price_id) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,price_id=excluded.price_id").bind(s.id,checkout.id,price).run();
 return json({url:safeStripeURL(checkout.url,"checkout.stripe.com")});
 }finally{await env.DB.prepare("DELETE FROM cq_billing_locks WHERE user_id=?").bind(s.id).run();}
 }
 throw new PublicError("Not found.",404);
}
