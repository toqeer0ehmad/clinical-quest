import {SELF,env} from "cloudflare:test";
import {describe,it,expect,vi} from "vitest";
import Stripe from "stripe";
import type {Env} from "../src/env";
import {digest,newSession,PublicError,now} from "../src/accounts";
import {billingRoute,membership} from "../src/billing";
const e=env as unknown as Env;
const origin="https://game.test";
function request(path:string,data?:unknown,cookie?:string){
 return new Request(origin+path,{method:data===undefined?"GET":"POST",headers:{Origin:origin,"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});
}
async function signup(){
 const email=crypto.randomUUID()+"@example.test";
 const res=await SELF.fetch(request("/api/account/signup",{email,name:"Student",password:"Learning-stories-2026"}));
 expect(res.status).toBe(201);
 const user=(await res.json() as any).user;
 return {user,email,cookie:res.headers.get("Set-Cookie")!.split(";")[0]!};
}
async function fixture(){
 const id=crypto.randomUUID();
 await e.DB.prepare("INSERT INTO cq_users(id,email,name,password_hash,created_at,stripe_customer_id) VALUES(?,?,?,?,?,?)").bind(id,id+"@example.test","Student","unused",now(),"cus_"+id).run();
 return {id,customer:"cus_"+id,cookie:"__Host-cq_session="+await newSession(e,id)};
}
const billingEnv=():Env=>({...e,STRIPE_SECRET_KEY:"sk_test_fixture_not_real",STRIPE_WEBHOOK_SECRET:"whsec_fixture_not_real",STRIPE_PRICE_MONTHLY:"price_monthly",STRIPE_PRICE_ANNUAL:"price_annual",BILLING_ENABLED:"true"});
function subscription(customer:string,status="active"){return {id:"sub_"+customer,object:"subscription",customer,status,cancel_at_period_end:false,items:{data:[{price:{id:"price_annual"},current_period_end:now()+86400} ]}};}
describe("student accounts and privacy",()=>{
 it("creates a real account with a hashed password and secure opaque session",async()=>{
 const s=await signup();const me=await SELF.fetch(request("/api/account/me",undefined,s.cookie));
 expect((await me.json() as any).user.email).toBe(s.email);
 const stored=await e.DB.prepare("SELECT password_hash FROM cq_users WHERE id=?").bind(s.user.id).first<any>();
 expect(stored.password_hash).toMatch(/^\$2/);expect(stored.password_hash).not.toContain("Learning");
 const sessions=await e.DB.prepare("SELECT token_hash FROM cq_sessions WHERE user_id=?").bind(s.user.id).first<any>();
 expect(sessions.token_hash).toBe(await digest(s.cookie.split("=")[1]!));
 const raw=await SELF.fetch(request("/api/account/login",{email:s.email,password:"Learning-stories-2026"}));
 expect(raw.status).toBe(200);expect(raw.headers.get("Set-Cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
 });
 it("rejects cross-site mutations, weak passwords and incorrect credentials",async()=>{
 const cross=await SELF.fetch(new Request(origin+"/api/account/signup",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://attacker.test"},body:JSON.stringify({})}));expect(cross.status).toBe(403);
 expect((await SELF.fetch(request("/api/account/signup",{email:"x@example.test",name:"x",password:"short"}))).status).toBe(400);
 expect((await SELF.fetch(request("/api/account/login",{email:"missing@example.test",password:"Learning-stories-2026"}))).status).toBe(401);
 expect((await SELF.fetch(request("/api/billing/status"))).status).toBe(401);
 });
 it("binds account rooms to sessions and revokes an open socket on logout",async()=>{
 const a=await signup();
 const res=await SELF.fetch(origin+"/ws/me",{headers:{Upgrade:"websocket",Cookie:a.cookie,Origin:origin}});
 expect(res.status).toBe(101);
 const ws=res.webSocket!;ws.accept();const frames:any[]=[];ws.addEventListener("message",msg=>frames.push(JSON.parse(String(msg.data))));
 async function next(pred:(m:any)=>boolean){for(let i=0;i<200;i++){const n=frames.findIndex(pred);if(n>=0)return frames.splice(n,1)[0];await scheduler.wait(10);}throw Error("Frame timeout");}
 ws.send(JSON.stringify({type:"join",playerId:"forged"}));expect((await next(x=>x.type==="error")).error).toContain("identity");
 ws.send(JSON.stringify({type:"join",playerId:a.user.id}));expect((await next(x=>x.type==="state")).view.xp).toBe(0);
 expect((await SELF.fetch(origin+"/ws/account_"+a.user.id,{headers:{Upgrade:"websocket",Cookie:a.cookie}})).status).toBe(403);
 await SELF.fetch(request("/api/account/logout",{},a.cookie));
 expect((await SELF.fetch(request("/api/account/me",undefined,a.cookie)).then(r=>r.json()) as any).user).toBeNull();
 ws.send(JSON.stringify({type:"action",action:{type:"start",caseId:"infection"}}));
 expect((await next(x=>x.type==="error")).error).toContain("expired");
 ws.close();
 });
 it("shares progress across sessions and keeps other accounts separate",async()=>{
 const a=await fixture(),b=await fixture();
 const open=async(cookie:string,id:string)=>{
 const r=await SELF.fetch(origin+"/ws/me",{headers:{Upgrade:"websocket",Cookie:cookie}});const w=r.webSocket!;w.accept();
 const next=()=>new Promise<any>(resolve=>w.addEventListener("message",x=>resolve(JSON.parse(String(x.data))),{once:true}));
 let p=next();w.send(JSON.stringify({type:"join",playerId:id}));const initial=await p;return {w,next,initial};};
 const first=await open(a.cookie,a.id);const waiting=first.next();first.w.send(JSON.stringify({type:"action",action:{type:"start",caseId:"dka"}}));await waiting;first.w.close();
 const again=await open("__Host-cq_session="+await newSession(e,a.id),a.id);expect(again.initial.view.active).toBe("dka");again.w.close();
 const other=await open(b.cookie,b.id);expect(other.initial.view.active).toBeNull();other.w.close();
 });
 it("disables billing and email recovery when configuration is missing",async()=>{
 const s=await fixture();
 expect((await SELF.fetch(request("/api/billing/plans")).then(r=>r.json()) as any).enabled).toBe(false);
 expect((await SELF.fetch(request("/api/billing/checkout",{interval:"annual"},s.cookie))).status).toBe(503);
 expect((await SELF.fetch(request("/api/account/forgot",{email:"x@example.test"}))).status).toBe(503);
 });
 it("sends single-use recovery links and invalidates existing sessions",async()=>{
 const s=await fixture();let sent:any=null;
 const mocked=vi.spyOn(globalThis,"fetch").mockImplementation(async(_input,init)=>{sent=JSON.parse(String(init?.body));return Response.json({id:"email_fixture"});});
 try{
 const {accountRoute}=await import("../src/accounts");
 const recoveryEnv={...e,RESEND_API_KEY:"re_fixture_not_real",EMAIL_FROM:"Clinical Quest <noreply@example.test>"};
 expect((await accountRoute(request("/api/account/forgot",{email:s.id+"@example.test"}),recoveryEnv))?.status).toBe(200);
 const raw=sent.text.match(/reset=([a-f0-9]{64})/)[1];
 expect((await accountRoute(request("/api/account/reset",{token:raw,password:"Different-password-2026"}),recoveryEnv))?.status).toBe(200);
 await expect(accountRoute(request("/api/account/reset",{token:raw,password:"Different-password-2026"}),recoveryEnv)).rejects.toThrow("invalid or expired");
 expect((await SELF.fetch(request("/api/account/me",undefined,s.cookie)).then(r=>r.json()) as any).user).toBeNull();
 }finally{mocked.mockRestore();}
 });
});
describe("Stripe subscription boundary",()=>{
 it("rejects missing, tampered, and stale webhook signatures",async()=>{
 const be=billingEnv();const stripe=new Stripe(be.STRIPE_SECRET_KEY!);
 const payload=JSON.stringify({id:"evt_signature",object:"event",livemode:false,type:"customer.subscription.updated",data:{object:{customer:"cus_missing"}}});
 const header=await stripe.webhooks.generateTestHeaderStringAsync({payload,secret:be.STRIPE_WEBHOOK_SECRET!,cryptoProvider:Stripe.createSubtleCryptoProvider()});
 const webhook=(text:string,signature:string)=>new Request(origin+"/api/stripe/webhook",{method:"POST",headers:{"Stripe-Signature":signature},body:text});
 await expect(billingRoute(webhook(payload,""),be)).rejects.toThrow("signature");
 await expect(billingRoute(webhook(payload+" ",header),be)).rejects.toThrow("signature");
 const stale=await stripe.webhooks.generateTestHeaderStringAsync({payload,secret:be.STRIPE_WEBHOOK_SECRET!,timestamp:now()-600,cryptoProvider:Stripe.createSubtleCryptoProvider()});
 await expect(billingRoute(webhook(payload,stale),be)).rejects.toThrow("signature");
 });
 it("activates, deduplicates, and revokes membership using current Stripe state",async()=>{
 const s=await fixture(),be=billingEnv(),stripe=new Stripe(be.STRIPE_SECRET_KEY!);let status="active",calls=0;
 const mocked=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{calls++;return Response.json({object:"list",has_more:false,data:[subscription(s.customer,status)]});});
 async function event(id:string,type:string){
 const payload=JSON.stringify({id,object:"event",livemode:false,type,data:{object:{customer:s.customer}}});
 const signature=await stripe.webhooks.generateTestHeaderStringAsync({payload,secret:be.STRIPE_WEBHOOK_SECRET!,cryptoProvider:Stripe.createSubtleCryptoProvider()});
 return billingRoute(new Request(origin+"/api/stripe/webhook",{method:"POST",headers:{"Stripe-Signature":signature},body:payload}),be);}
 try{
 expect((await event("evt_"+s.id,"customer.subscription.updated"))?.status).toBe(200);
 expect((await membership(be,s.id)).active).toBe(true);
 await event("evt_"+s.id,"customer.subscription.updated");expect(calls).toBe(1);
 status="canceled";await event("evt_cancel_"+s.id,"customer.subscription.deleted");expect((await membership(be,s.id)).active).toBe(false);
 }finally{mocked.mockRestore();}
 });
 it("creates annual checkout for the authenticated customer and reuses an open session",async()=>{
 const s=await fixture(),be=billingEnv();let creates=0,submitted="";
 const mocked=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
 const url=String(input);
 if(url.includes("/v1/subscriptions"))return Response.json({object:"list",has_more:false,data:[]});
 if(url.endsWith("/v1/checkout/sessions")){creates++;submitted=String(init?.body);return Response.json({id:"cs_fixture",url:"https://checkout.stripe.com/c/pay/cs_fixture"});}
 if(url.includes("/v1/checkout/sessions/cs_fixture"))return Response.json({id:"cs_fixture",status:"open",url:"https://checkout.stripe.com/c/pay/cs_fixture"});
 throw Error("Unexpected Stripe request");
 });
 try {
 const first=await billingRoute(request("/api/billing/checkout",{interval:"annual",userId:"forged"},s.cookie),be);
 expect(first?.status).toBe(200);expect(submitted).toContain("price_annual");expect(submitted).toContain(s.customer);expect(submitted).not.toContain("forged");
 await billingRoute(request("/api/billing/checkout",{interval:"annual"},s.cookie),be);expect(creates).toBe(1);
 }finally{mocked.mockRestore();}
 });
 it("does not grant access from a success URL or expired subscription",async()=>{
 const s=await fixture(),be=billingEnv();
 const res=await billingRoute(request("/api/billing/status?checkout=success",undefined,s.cookie),be);
 expect((await res!.json() as any).membership.active).toBe(false);
 await e.DB.prepare("INSERT INTO cq_subscriptions VALUES(?,?,?,?,?,?,?)").bind("sub_expired",s.id,"active","price_annual",now()-1,0,now()).run();
 expect((await membership(be,s.id)).active).toBe(false);
 await expect(billingRoute(request("/api/billing/checkout",{interval:"weekly"},s.cookie),be)).rejects.toBeInstanceOf(PublicError);
 });
});
