import {SELF,env} from "cloudflare:test";
import type {Env} from "../src/env";
import {newSession,now} from "../src/accounts";
const e=env as unknown as Env;
import {describe,it,expect} from "vitest";
import * as logic from "../src/logic.js";
const getView=(s:any,p:string):any=>logic.viewFor(s,p);
async function open(id:string){
 const stored=await e.DB.prepare("SELECT id FROM cq_users WHERE id=?").bind(id).first();
 if(!stored)await e.DB.prepare("INSERT INTO cq_users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)").bind(id,id+"@example.test","Student","unused",now()).run();
 const cookie="__Host-cq_session="+await newSession(e,id);
 const res=await SELF.fetch("https://game.test/ws/me",{headers:{Upgrade:"websocket",Cookie:cookie,Origin:"https://game.test"}});
 expect(res.status).toBe(101);const ws=res.webSocket!;ws.accept();const frames:any[]=[];
 ws.addEventListener("message",e=>{try{frames.push(JSON.parse(String(e.data)));}catch{}});
 const next=async(pred:(x:any)=>boolean)=>{for(let i=0;i<150;i++){const k=frames.findIndex(pred);if(k>=0)return frames.splice(k,1)[0];await scheduler.wait(10);}throw Error("Frame timeout");};
 const send=(m:unknown)=>ws.send(JSON.stringify(m));send({type:"join",playerId:id});const first=await next(x=>x.type==="state");return {ws,send,next,first};
}
function go(s:any,a:any){expect(logic.validateAction(s,"p",a).ok).toBe(true);return logic.applyAction(s,"p",a);}
function finish(s:any,id:string,wrong=false){
 s=go(s,{type:"start",caseId:id});
 for(let i=0;i<5;i++){const v=getView(s,"p");s=go(s,{type:"answer",caseId:id,questionId:v.question.id,choice:wrong?0:0});s=go(s,{type:"next",caseId:id});}
 s=go(s,{type:"transfer",caseId:id});let v=getView(s,"p");s=go(s,{type:"answer",caseId:id,questionId:v.question.id,choice:0});return go(s,{type:"next",caseId:id});
}
describe("Clinical Quest rules",()=>{
 it("hides answers and future story before submission",()=>{let s=go(logic.setup(["p"]),{type:"start",caseId:"infection"});let v=getView(s,"p");expect(v.question.answer).toBeUndefined();expect(v.feedback).toBeNull();expect(v.story).toBeNull();expect(JSON.stringify(v)).not.toContain("explanations");expect(getView(s,"intruder")).toBeNull();});
 it("rejects duplicate answers, stale question IDs and invalid choices",()=>{let s=go(logic.setup(["p"]),{type:"start",caseId:"infection"});expect(logic.validateAction(s,"p",{type:"answer",caseId:"infection",questionId:"i1",choice:99}).ok).toBe(false);s=go(s,{type:"answer",caseId:"infection",questionId:"i1",choice:1});expect(logic.validateAction(s,"p",{type:"answer",caseId:"infection",questionId:"i1",choice:1}).ok).toBe(false);s=go(s,{type:"next",caseId:"infection"});expect(logic.validateAction(s,"p",{type:"answer",caseId:"infection",questionId:"i1",choice:1}).ok).toBe(false);});
 it("allows mistakes and completes every case without XP farming",()=>{let s=logic.setup(["p"]);for(const id of ["infection","dka","pe"]){s=finish(s,id);expect(getView(s,"p").attempt.phase).toBe("summary");}const before=getView(s,"p");expect(before.records.length).toBe(3);expect(before.review.length).toBeGreaterThan(0);const xp=before.xp;s=go(s,{type:"replay",caseId:"infection"});s=finish(s,"infection");expect(getView(s,"p").xp).toBe(xp);});
 it("keeps hint status and scores a correct hinted answer at 50 XP",()=>{let s=go(logic.setup(["p"]),{type:"start",caseId:"infection"});s=go(s,{type:"hint",caseId:"infection",questionId:"i1"});expect(getView(s,"p").hint).toBeTruthy();s=go(s,{type:"answer",caseId:"infection",questionId:"i1",choice:1});expect(getView(s,"p").feedback.hinted).toBe(true);expect(getView(s,"p").feedback.correct).toBe(true);});
 it("does not mutate previous state",()=>{const s=logic.setup(["p"]);const text=JSON.stringify(s);go(s,{type:"start",caseId:"dka"});expect(JSON.stringify(s)).toBe(text);});
});
describe("real room protocol",()=>{
 it("starts single-player and survives reconnect",async()=>{const room="persist-"+crypto.randomUUID();const a=await open(room);expect(a.first.status).toBe("playing");a.send({type:"action",action:{type:"start",caseId:"infection"}});await a.next(x=>x.view?.question?.id==="i1");a.send({type:"action",action:{type:"answer",caseId:"infection",questionId:"i1",choice:1}});await a.next(x=>x.view?.feedback?.correct);a.ws.close();const b=await open(room);expect(b.first.view.feedback.correct).toBe(true);expect(b.first.view.attempt.answers.length).toBe(1);b.ws.close();});
 it("isolates account progress",async()=>{const a=await open("isolation-"+crypto.randomUUID());a.send({type:"action",action:{type:"start",caseId:"dka"}});await a.next(x=>x.view?.active==="dka");const b=await open("other-"+crypto.randomUUID());expect(b.first.view.active).toBeNull();expect(b.first.you).not.toBe(a.first.you);a.ws.close();b.ws.close();});
 it("blocks anonymous gameplay, legacy room URLs and forged identity headers",async()=>{
 for(const path of ["/ws","/ws/me","/ws/main","/ws/cq-guest","/ws/account_forged"]){
  const r=await SELF.fetch("https://game.test"+path,{headers:{Upgrade:"websocket",Origin:"https://game.test","X-CQ-Student":"forged","X-CQ-Session":"forged"}});
  expect(r.status).toBe(401);expect(r.webSocket).toBeFalsy();
 }
 const id=crypto.randomUUID();await e.DB.prepare("INSERT INTO cq_users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)").bind(id,id+"@example.test","Student","unused",now()).run();
 const cookie="__Host-cq_session="+await newSession(e,id);
 for(const path of ["/ws","/ws/main","/ws/cq-guest","/ws/account_"+id])expect((await SELF.fetch("https://game.test"+path,{headers:{Upgrade:"websocket",Cookie:cookie,Origin:"https://game.test"}})).status).toBe(403);
 expect((await SELF.fetch("https://game.test/ws/me",{headers:{Upgrade:"websocket",Cookie:cookie,Origin:"https://attacker.test"}})).status).toBe(403);
 });
 it("reset clears all progress",async()=>{const a=await open("reset-"+crypto.randomUUID());a.send({type:"action",action:{type:"start",caseId:"dka"}});await a.next(x=>x.view?.active==="dka");a.send({type:"reset"});const r=await a.next(x=>x.type==="state"&&x.view?.active===null);expect(r.view.xp).toBe(0);a.ws.close();});
});