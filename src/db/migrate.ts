import { loadConfig } from "../config.js";
import { PostgresStore } from "./postgres-store.js";

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = new PostgresStore(config.DATABASE_URL);
await store.init();
await store.close();
console.log("Database migration complete");
