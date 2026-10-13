import { hash, compare } from "bcryptjs";
import type { Env } from "./env";
export const COOKIE = "__Host-cq_session";
const DAYS = 30 * 86400;
export const now = () => Math.floor(Date.now()/1000);
export class PublicError extends Error { constructor(message:string,public status=400){super(message);} }
export function json(data:unknown,status=200,headers:Record<string,string>={}) {
 return Response.json(data,{status,headers:{"cache-control":"no-store",...headers}});
}
export async function digest(value:string):Promise<string> {
 const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
export function token():string {
 return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
}
export function cookie(value:string,seconds=DAYS):string {
 return COOKIE+"="+value+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+seconds;
}
export function assertOrigin(request:Request) {
 if(request.headers.get("Origin")!==new URL(request.url).origin) throw new PublicError("Refresh this page and try again.",403);
}
export async function body(request:Request):Promise<Record<string,unknown>> {
 if(!request.headers.get("Content-Type")?.startsWith("application/json")) throw new PublicError("Expected JSON.",415);
 if(Number(request.headers.get("Content-Length")||0)>8192) throw new PublicError("Request too large.",413);
 const text=await request.text();if(text.length>8192)throw new PublicError("Request too large.",413);
 try { const data=JSON.parse(text);if(!data||typeof data!=="object"||Array.isArray(data))throw Error();return data; }
 catch {throw new PublicError("Invalid request.");}
}
export function emailInput(value:unknown):string {
 if(typeof value!=="string")throw new PublicError("Enter a valid email address.");
 const email=value.trim().toLowerCase();
 if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new PublicError("Enter a valid email address.");
 return email;
}
export function passwordInput(value:unknown):string {
 if(typeof value!=="string"||value.length<12||new TextEncoder().encode(value).length>72)throw new PublicError("Use at least 12 characters and no more than 72 bytes for your password.");
 return value;
}
export interface Student { id:string;email:string;name:string;stripe_customer_id:string|null }
export interface Session extends Student { sessionHash:string;expires_at:number }
export async function sessionByHash(env:Env,key:string):Promise<Session|null> {
 if(!env.DB)return null;
 return env.DB.prepare("SELECT u.id,u.email,u.name,u.stripe_customer_id,s.token_hash AS sessionHash,s.expires_at FROM cq_sessions s JOIN cq_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(key,now()).first<Session>();
}
export async function currentSession(request:Request,env:Env):Promise<Session|null> {
 const raw=request.headers.get("Cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
 return raw&&/^[a-f0-9]{64}$/.test(raw)?sessionByHash(env,await digest(raw)):null;
}
export async function requireSession(request:Request,env:Env):Promise<Session> {
 const s=await currentSession(request,env);if(!s)throw new PublicError("Sign in to your Clinical Quest account.",401);return s;
}
export async function newSession(env:Env,id:string):Promise<string> {
 const raw=token();await env.DB.prepare("INSERT INTO cq_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await digest(raw),id,now()+DAYS).run();return raw;
}
export async function throttle(request:Request,env:Env,scope:string,identifier?:string) {
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";
 const keys=[scope+":ip:"+await digest(ip)];if(identifier)keys.push(scope+":email:"+await digest(identifier));
 for(const key of keys) {
 const row=await env.DB.prepare("INSERT INTO cq_rate_limits(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING hits").bind(key,now()+600,now(),now()).first<{hits:number}>();
 if(!row||row.hits>(identifier&&key.includes(":email:")?8:30))throw new PublicError("Too many attempts. Please wait 10 minutes.",429);
 }
}
export function publicStudent(s:Student){return {id:s.id,name:s.name,email:s.email};}
export async function accountRoute(request:Request,env:Env):Promise<Response|null> {
 const path=new URL(request.url).pathname;
 if(!path.startsWith("/api/account/"))return null;
 if(!env.DB)throw new PublicError("Account storage is not available yet.",503);
 if(request.method==="GET"&&path==="/api/account/me"){
 const s=await currentSession(request,env);return json({user:s?publicStudent(s):null,recoveryAvailable:Boolean(env.RESEND_API_KEY&&env.EMAIL_FROM)});
 }
 if(request.method!=="POST")throw new PublicError("Method not allowed.",405);
 assertOrigin(request);
 if(path==="/api/account/logout"){
 const s=await currentSession(request,env);if(s)await env.DB.prepare("DELETE FROM cq_sessions WHERE token_hash=?").bind(s.sessionHash).run();
 return json({ok:true},200,{"set-cookie":cookie("",0)});
 }
 const data=await body(request);
 if(path==="/api/account/signup"||path==="/api/account/login"){
 const email=emailInput(data.email);const password=passwordInput(data.password);await throttle(request,env,"credentials",email);
 if(path.endsWith("signup")){
 const name=typeof data.name==="string"?data.name.trim():"";if(name.length<1||name.length>80)throw new PublicError("Enter your name (up to 80 characters).");
 if(await env.DB.prepare("SELECT id FROM cq_users WHERE email=?").bind(email).first())throw new PublicError("Unable to create that account. Try signing in or resetting your password.",409);
 const id=crypto.randomUUID(),passwordHash=await hash(password,12);
 try {await env.DB.prepare("INSERT INTO cq_users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)").bind(id,email,name,passwordHash,now()).run();}
 catch {throw new PublicError("Unable to create that account. Try signing in.",409);}
 const raw=await newSession(env,id);
 return json({user:{id,email,name}},201,{"set-cookie":cookie(raw)});
 }
 const u=await env.DB.prepare("SELECT id,email,name,stripe_customer_id,password_hash FROM cq_users WHERE email=?").bind(email).first<Student&{password_hash:string}>();
 const matched=await compare(password,u?.password_hash||"$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW");
 if(!u||!matched)throw new PublicError("Email or password is incorrect.",401);
 return json({user:publicStudent(u)},200,{"set-cookie":cookie(await newSession(env,u.id))});
 }
 if(path==="/api/account/password"){
 const s=await requireSession(request,env);await throttle(request,env,"password",s.email);
 const current=passwordInput(data.currentPassword),next=passwordInput(data.password);
 const u=await env.DB.prepare("SELECT password_hash FROM cq_users WHERE id=?").bind(s.id).first<{password_hash:string}>();
 if(!u||!await compare(current,u.password_hash))throw new PublicError("Current password is incorrect.",401);
 await env.DB.batch([env.DB.prepare("UPDATE cq_users SET password_hash=? WHERE id=?").bind(await hash(next,12),s.id),env.DB.prepare("DELETE FROM cq_sessions WHERE user_id=?").bind(s.id),env.DB.prepare("DELETE FROM cq_recovery WHERE user_id=?").bind(s.id)]);
 return json({ok:true},200,{"set-cookie":cookie(await newSession(env,s.id))});
 }
 if(path==="/api/account/forgot"){
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)throw new PublicError("Email password recovery is not configured yet.",503);
 const email=emailInput(data.email);await throttle(request,env,"recovery",email);
 const u=await env.DB.prepare("SELECT id FROM cq_users WHERE email=?").bind(email).first<{id:string}>();
 if(u) {
 const raw=token();await env.DB.prepare("INSERT INTO cq_recovery(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await digest(raw),u.id,now()+1800).run();
 const origin=appOrigin(request,env);
 const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.EMAIL_FROM,to:[email],subject:"Reset your Clinical Quest password",text:"Reset your password within 30 minutes: "+origin+"/#reset="+raw+"\nIf you did not request this, you can ignore this email."})});
 if(!res.ok){await env.DB.prepare("DELETE FROM cq_recovery WHERE token_hash=?").bind(await digest(raw)).run();throw new PublicError("Email delivery is unavailable. Please try later.",503);}
 }
 return json({ok:true,message:"If that account exists, a reset link will arrive by email."});
 }
 if(path==="/api/account/reset"){
 await throttle(request,env,"reset");
 const raw=typeof data.token==="string"?data.token:"",password=passwordInput(data.password);
 if(!/^[a-f0-9]{64}$/.test(raw))throw new PublicError("This reset link is invalid or expired.");
 const key=await digest(raw);
 // DELETE RETURNING consumes the token atomically before updating credentials.
 const r=await env.DB.prepare("DELETE FROM cq_recovery WHERE token_hash=? AND expires_at>? RETURNING user_id").bind(key,now()).first<{user_id:string}>();
 if(!r)throw new PublicError("This reset link is invalid or expired.");
 await env.DB.batch([env.DB.prepare("UPDATE cq_users SET password_hash=? WHERE id=?").bind(await hash(password,12),r.user_id),env.DB.prepare("DELETE FROM cq_sessions WHERE user_id=?").bind(r.user_id),env.DB.prepare("DELETE FROM cq_recovery WHERE user_id=?").bind(r.user_id)]);
 return json({ok:true});
 }
 throw new PublicError("Not found.",404);
}
export function appOrigin(request:Request,env:Env):string {
 const u=new URL(env.APP_ORIGIN||new URL(request.url).origin);
 if(u.protocol!=="https:")throw new PublicError("Secure application address is required.",503);
 return u.origin;
}
