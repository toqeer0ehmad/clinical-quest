import {cloudflareTest,readD1Migrations} from "@cloudflare/vitest-pool-workers";
import {defineConfig} from "vitest/config";
export default defineConfig({
 test:{include:["tests/*.test.ts"],setupFiles:["tests/setup.ts"],testTimeout:20000},
 plugins:[cloudflareTest(async()=>({wrangler:{configPath:"./wrangler.jsonc"},miniflare:{bindings:{TEST_MIGRATIONS:JSON.stringify(await readD1Migrations("./migrations"))}}}))]
});
