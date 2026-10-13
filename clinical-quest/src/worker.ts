import type { Env } from "./env";
import { Room } from "./room";
import { accountRoute, currentSession, json, PublicError } from "./accounts";
import { billingRoute } from "./billing";
import { applySecurityHeaders } from "./lib/security-headers.server";
export { Room };
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  try {
   const url=new URL(request.url);
   const api=await accountRoute(request,env)||await billingRoute(request,env);
   if(api)return applySecurityHeaders(api);
   if(url.pathname==="/ws"||url.pathname.startsWith("/ws/")){
    if(request.headers.get("Upgrade")!=="websocket")return applySecurityHeaders(new Response("expected a websocket upgrade",{status:426}));
    if(request.headers.get("Origin")&&request.headers.get("Origin")!==url.origin)throw new PublicError("Invalid socket origin.",403);
    const s=await currentSession(request,env);
    if(!s)throw new PublicError("Create an account or sign in to enter the hospital.",401);
    // Every gameplay connection belongs to the authenticated account.
    // Legacy anonymous URLs and browser-supplied room IDs cannot bypass login.
    if(url.pathname!=="/ws/me")throw new PublicError("Account rooms are private. Use your signed-in account.",403);
    const room="account_"+s.id;
    const headers=new Headers(request.headers);
    headers.delete("X-CQ-Student");headers.delete("X-CQ-Session");
    headers.set("X-CQ-Student",s.id);headers.set("X-CQ-Session",s.sessionHash);
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(request,{headers}));
   }
   if(request.method==="GET"&&request.headers.get("Accept")?.includes("text/html"))return env.ASSETS.fetch(new Request(new URL("/",url),request));
   return applySecurityHeaders(new Response("Not found",{status:404}));
  }catch(e){
   if(e instanceof PublicError)return applySecurityHeaders(json({error:e.message},e.status));
   // Never return provider errors, database rows, credentials, or request bodies.
   return applySecurityHeaders(json({error:"This service is temporarily unavailable. Please try again."},503));
  }
 }
} satisfies ExportedHandler<Env>;
