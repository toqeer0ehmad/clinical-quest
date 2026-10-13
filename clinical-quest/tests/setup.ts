import {env,applyD1Migrations} from "cloudflare:test";
import {beforeAll} from "vitest";
beforeAll(async()=>{
 const e=env as unknown as {DB:D1Database;TEST_MIGRATIONS:string};
 await applyD1Migrations(e.DB,JSON.parse(e.TEST_MIGRATIONS));
});
