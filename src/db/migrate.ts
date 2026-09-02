import { loadConfig } from "../config.js";
import { PostgresStore } from "./postgres-store.js";
import { SqliteStore } from "./sqlite-store.js";

const config = loadConfig();
const store = config.DATABASE_URL ? new PostgresStore(config.DATABASE_URL) : new SqliteStore(config.SQLITE_PATH);
await store.init();
await store.close();
console.log("Database migration complete");
