const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let student=null,mode="login",resetToken=null,error="",notice="",busy=false,recovery=false,unavailable=false;
let membership=null,plans=[],enabled=false,testMode=true,changed=()=>{},draw=()=>{};
export const getStudent=()=>student;
async function api(path,data){
 const res=await fetch(path,{credentials:"same-origin",headers:data?{"Content-Type":"application/json"}:{},...(data?{method:"POST",body:JSON.stringify(data)}:{})});
 let body;try{body=await res.json();}catch{throw Error("Account services are unavailable. Please try again.");}
 if(!res.ok)throw Error(body.error||"Please try again.");return body;
}
export async function initialize(onChanged,onDraw){
 changed=onChanged;draw=onDraw;
 const fragment=new URLSearchParams(location.hash.slice(1));
 if(fragment.has("reset")){resetToken=fragment.get("reset");mode="reset";history.replaceState(null,"",location.pathname+location.search);}
 try{const data=await api("/api/account/me");student=data.user;recovery=data.recoveryAvailable;}catch{unavailable=true;}
 updateHeader();
 return {student,openAccount:Boolean(resetToken||new URLSearchParams(location.search).has("account"))};
}
function updateHeader(){
 $("#account").textContent=student?"My account":"Sign in";
 $("footer span").textContent=student?"Signed in · Progress saved to your account.":"Create an account or sign in to enter the hospital.";
}
async function loadBilling(refresh=false){
 if(!student)return;
 const [status,p]=await Promise.all([api("/api/billing/status"),api("/api/billing/plans")]);
 membership=status.membership;enabled=p.enabled;plans=p.plans;testMode=p.testMode;
 if(refresh&&enabled){const r=await api("/api/billing/refresh",{});membership=r.membership;}
}
function input(name,label,type="text",autocomplete="",value=""){
 return '<label>'+label+'<input name="'+name+'" type="'+type+'" autocomplete="'+autocomplete+'" value="'+esc(value)+'" '+(type==="password"?'minlength="12" maxlength="72"':'')+' '+(name==="name"?'maxlength="80"':name==="email"?'maxlength="254"':'')+' required></label>';
}
function message(){
 return (error?'<p class="account-message error" role="alert">'+esc(error)+'</p>':"")+(notice?'<p class="account-message" role="status">'+esc(notice)+'</p>':"");
}
function authForm(){
 if(window.self!==window.top)return '<div class="container"><section class="account-card"><div class="eyebrow">YOUR CLINICAL QUEST ACCOUNT</div><h1>Open your student account.</h1><p>Sign in in a separate tab so your browser can securely save your Clinical Quest session.</p><a class="primary stripe-link" href="'+esc(location.origin+'/?account=1')+'" target="_blank" rel="noopener noreferrer">Open Clinical Quest sign in →</a><p class="notice">A student account is required to enter any ward. After signing in, continue in the new tab.</p></section></div>';

 const signup=mode==="signup",forgot=mode==="forgot",reset=mode==="reset";
 const title=signup?"Start your first shift.":forgot?"Reset your password.":reset?"Choose a new password.":"Welcome back, doctor.";
 return '<div class="account-grid"><aside class="account-art"><div><div class="eyebrow">CLINICAL QUEST · STEP 1 / CBSE</div><h2>Learn the story.<br>Connect the clues.</h2><p>Choose a ward. Meet your patient. Work through the mechanism one connection at a time.</p></div></aside><section class="account-card"><div class="eyebrow">YOUR STUDENT ACCOUNT</div><h1>'+title+'</h1><p>'+(signup?"Create your account to enter the hospital and save your rounds across devices.":forgot?"We’ll email a link if an account matches your address.":reset?"Use at least 12 characters. Existing sessions will be signed out.":"Sign in to pick up where you left off.")+'</p>'+(!forgot&&!reset?'<div class="account-tabs"><button data-auth-mode="login" class="'+(!signup?"chosen":"")+'">Sign in</button><button data-auth-mode="signup" class="'+(signup?"chosen":"")+'">Create account</button></div>':"")+message()+(unavailable?'<p class="account-message error">Account services are temporarily unavailable. Please retry to sign in and enter the hospital.</p><button class="secondary" data-account-retry>Retry account connection</button>':"")+'<form id="auth-form">'+(signup?input("name","Your name","text","name"):"")+(reset?"":input("email","Email address","email","email"))+(forgot?"":input("password",reset||signup?"Password · at least 12 characters":"Password","password",reset||signup?"new-password":"current-password"))+'<button class="primary full" '+(busy||unavailable?"disabled":"")+'>'+(busy?"Please wait…":signup?"Create account":forgot?"Send reset link":reset?"Save new password":"Sign in")+'</button></form>'+(!signup&&!forgot&&!reset?(recovery?'<button class="text-button" data-auth-mode="forgot">Forgot your password?</button>':'<p class="notice">Email password recovery is not available yet. Keep your password safe.</p>'):"")+(forgot||reset?'<button class="text-button" data-auth-mode="login">Back to sign in</button>':"")+'<p class="notice">An account is required for every ward. Your account includes three introductory cases. Membership enrollment is not open yet.</p></section></div>';
}
function money(plan){return new Intl.NumberFormat(undefined,{style:"currency",currency:plan.currency.toUpperCase()}).format(plan.amount/100);}
function signedIn(){
 const m=membership;
 return '<div class="container account-dashboard"><div class="intro"><div><div class="eyebrow">YOUR CLINICAL QUEST ACCOUNT</div><h1>Welcome, '+esc(student.name)+'.</h1><p>'+esc(student.email)+'</p></div><button class="secondary" data-account-rounds>Continue your rounds →</button></div>'+message()+'<div class="account-columns"><section class="account-card"><h2>Your learning record</h2><p>Case progress, review questions, and lifetime XP are saved to this account. Sign in on another device to continue.</p><button class="primary" data-account-rounds>Enter the hospital →</button></section><section class="account-card"><div class="eyebrow">MEMBERSHIP</div><h2>'+(m?.active?"Membership active":"Introductory access")+'</h2><p>'+(m?.active?(m.cancelAtPeriodEnd?"Access ends":"Current billing period ends")+" "+esc(new Date(m.periodEnd*1000).toLocaleDateString())+".":"You can practice all three existing demo cases. Additional wards are still in development.")+'</p>'+(testMode&&enabled?'<p class="account-message">Stripe test mode · No real payments.</p>':"")+(!enabled?'<div class="enrollment-note"><strong>Enrollment is not open yet.</strong><p>Monthly and annual plans will be available when the paid case library and checkout are ready.</p></div>':!m?.active?'<div class="membership-plans">'+plans.map(p=>'<article><h3>'+(p.interval==="annual"?"Annual":"Monthly")+'</h3><p class="plan-price">'+esc(money(p))+'<small> / '+(p.interval==="annual"?"year":"month")+'</small></p><p>Renews '+(p.interval==="annual"?"annually":"monthly")+' until canceled.</p><button class="primary full" data-checkout="'+p.interval+'" '+(busy?"disabled":"")+'>'+ (testMode?"Test checkout":"Subscribe")+'</button></article>').join("")+'</div>':"")+(enabled?'<div class="actions"><button class="secondary" data-billing-refresh '+(busy?"disabled":"")+'>Refresh membership</button><button class="secondary" data-billing-portal '+(busy?"disabled":"")+'>Manage billing</button></div>':"")+'</section></div><section class="account-card password-card"><h2>Account security</h2><details><summary>Change password</summary><form id="password-form">'+input("currentPassword","Current password","password","current-password")+input("password","New password · at least 12 characters","password","new-password")+'<button class="primary" '+(busy?"disabled":"")+'>Save password</button></form></details><button class="text-button" data-logout '+(busy?"disabled":"")+'>Sign out of Clinical Quest</button></section></div>';
}
export async function openAccount(){
 error="";notice="";
 if(student){try{await loadBilling(new URLSearchParams(location.search).get("checkout")==="success");if(new URLSearchParams(location.search).get("checkout")==="success")notice=membership?.active?"Your membership is confirmed.":"Your payment has not yet activated a membership. Refresh status shortly.";if(new URLSearchParams(location.search).get("checkout")==="cancelled")notice="Checkout was canceled. Your account is still available.";}catch(e){error=e.message;}}
 draw();
}
export function renderAccount(host){
 host.innerHTML=student?signedIn():authForm();
 const retry=host.querySelector("[data-account-retry]");
 if(retry)retry.onclick=async()=>{try{const r=await api("/api/account/me");student=r.user;recovery=r.recoveryAvailable;unavailable=false;error="";updateHeader();await changed(student,false);if(student)await loadBilling();}catch(e){error=e.message;}draw();};
 host.querySelectorAll("[data-auth-mode]").forEach(b=>b.onclick=()=>{mode=b.dataset.authMode;error="";notice="";draw();});
 host.querySelectorAll("[data-account-rounds]").forEach(b=>b.onclick=()=>changed(student,true));
 const form=host.querySelector("#auth-form");
 if(form)form.onsubmit=async e=>{
 e.preventDefault();if(busy)return;const data=Object.fromEntries(new FormData(form));
 busy=true;error="";notice="";draw();
 try {
 if(mode==="forgot"){notice=(await api("/api/account/forgot",data)).message;}
 else if(mode==="reset"){await api("/api/account/reset",{password:data.password,token:resetToken});resetToken=null;mode="login";notice="Password updated. Sign in with your new password.";}
 else {const res=await api("/api/account/"+mode,data);student=res.user;unavailable=false;updateHeader();await changed(student,false);await loadBilling();notice="You’re signed in. Your account rounds are ready.";}
 }catch(e){error=e.message;}
 finally{busy=false;draw();}
 };
 const pass=host.querySelector("#password-form");
 if(pass)pass.onsubmit=async e=>{
 e.preventDefault();if(busy)return;const data=Object.fromEntries(new FormData(pass));busy=true;error="";notice="";draw();
 try{await api("/api/account/password",data);await changed(student,false);notice="Password changed. Other sessions are signed out.";}catch(e){error=e.message;}
 finally{busy=false;draw();}
 };
 const logout=host.querySelector("[data-logout]");
 if(logout)logout.onclick=async()=>{
 busy=true;error="";draw();
 try{await api("/api/account/logout",{});student=null;membership=null;mode="login";updateHeader();await changed(null,false);notice="You’re signed out.";}
 catch(e){error=e.message;}finally{busy=false;draw();}
 };
 host.querySelectorAll("[data-checkout]").forEach(b=>b.onclick=()=>billingAction("checkout",{interval:b.dataset.checkout}));
 const portal=host.querySelector("[data-billing-portal]");if(portal)portal.onclick=()=>billingAction("portal",{});
 const refresh=host.querySelector("[data-billing-refresh]");if(refresh)refresh.onclick=async()=>{busy=true;error="";notice="";draw();try{await loadBilling(true);notice=membership?.active?"Membership confirmed.":"No active membership was found.";}catch(e){error=e.message;}finally{busy=false;draw();}};
}
async function billingAction(action,data){
 if(busy)return;busy=true;error="";draw();
 try{
 const r=await api("/api/billing/"+action,data);
 const u=new URL(r.url);if(u.protocol!=="https:"||!["checkout.stripe.com","billing.stripe.com"].includes(u.hostname))throw Error("Unable to open checkout.");
 // A top-level link opens hosted Stripe outside the embedded game.
 $("#dialog-content").innerHTML='<h2>Continue securely on Stripe</h2><p>Stripe opens in a new tab. Return here afterward to refresh your membership.</p><a class="primary stripe-link" href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">Open Stripe →</a>';
 $("#dialog").showModal();
 }catch(e){error=e.message;}finally{busy=false;draw();}
}

export async function expireSession(){
 student=null;membership=null;mode="login";notice="Your session expired. Sign in to continue your saved rounds.";updateHeader();await changed(null,false);draw();
}
