export interface Env {
 ASSETS: Fetcher;
 ROOMS: DurableObjectNamespace;
 DB: D1Database;
 HF_ENV?:string;
 APP_SLUG?:string;
 APP_ORIGIN?:string;
 STRIPE_SECRET_KEY?:string;
 STRIPE_WEBHOOK_SECRET?:string;
 STRIPE_PRICE_MONTHLY?:string;
 STRIPE_PRICE_ANNUAL?:string;
 BILLING_ENABLED?:string;
 RESEND_API_KEY?:string;
 EMAIL_FROM?:string;
}
