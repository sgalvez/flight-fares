import { loadConfig } from "./config.js";
import { PostgresStore } from "./db/postgres-store.js";
import { SqliteStore } from "./db/sqlite-store.js";
import { Logger } from "./logger.js";
import { ConsoleNotifier, TelegramNotifier } from "./notifier.js";
import { RadarPipeline, type RunOptions } from "./pipeline.js";
import { ConfiguredBrowserSource } from "./sources/browser.js";
import { AmadeusSource } from "./sources/amadeus.js";
import { MemoryStore } from "./store.js";
import { valuePerMile } from "./pricing.js";

const config = loadConfig();
const logger = new Logger(config.LOG_LEVEL);
const store = config.DATABASE_URL
  ? new PostgresStore(config.DATABASE_URL)
  : config.EPHEMERAL_STORE.toLowerCase() === "true"
    ? new MemoryStore()
    : new SqliteStore(config.SQLITE_PATH);
const notifier = config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID
  ? new TelegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID)
  : new ConsoleNotifier();
const amadeus = new AmadeusSource({
  ...(config.AMADEUS_API_KEY ? { apiKey: config.AMADEUS_API_KEY } : {}),
  ...(config.AMADEUS_API_SECRET ? { apiSecret: config.AMADEUS_API_SECRET } : {}),
  baseUrl: config.AMADEUS_BASE_URL,
  cabinBagEstimates: config.cabinBagEstimates
});
const browsers = config.browserSources.map((source) => new ConfiguredBrowserSource(source, config.SCREENSHOT_DIR));
const pipeline = new RadarPipeline({ config, store, amadeus, browsers, notifier, logger });

const modes: Record<string, RunOptions> = {
  run: { discover: true, verify: true, promotions: true, alerts: true, digest: true },
  morning: { discover: true, verify: true, promotions: false, alerts: true, digest: false },
  midday: { discover: false, verify: true, promotions: false, alerts: true, digest: false },
  evening: { discover: false, verify: true, promotions: true, alerts: true, digest: true },
  discover: { discover: true, verify: false, promotions: false, alerts: true, digest: false },
  verify: { discover: false, verify: true, promotions: false, alerts: true, digest: false },
  digest: { discover: false, verify: false, promotions: true, alerts: true, digest: true },
  backfill: { discover: true, verify: false, promotions: false, alerts: false, digest: false },
  health: { discover: false, verify: false, promotions: false, alerts: false, digest: true }
};

const command = process.argv[2] ?? "run";
const options = modes[command];
if (command === "miles") {
  const [cashRaw, milesRaw, taxesRaw] = process.argv.slice(3).map((value) => Number(value?.replace(/[^0-9.]/g, "")));
  if (!cashRaw || !milesRaw || taxesRaw === undefined || Number.isNaN(taxesRaw)) {
    console.error("Usage: npm run radar -- miles <precio_efectivo_clp> <millas> <tasas_clp>");
    process.exitCode = 2;
  } else {
    const result = valuePerMile(cashRaw, milesRaw, taxesRaw);
    console.log(`${result.toLocaleString("es-CL", { maximumFractionDigits: 2 })} CLP por milla`);
  }
} else if (!options) {
  console.error(`Unknown command: ${command}\nAvailable: ${Object.keys(modes).join(", ")}`);
  process.exitCode = 2;
} else {
  if (!config.DATABASE_URL && config.EPHEMERAL_STORE.toLowerCase() !== "true") {
    logger.info("Using local SQLite persistence", { path: config.SQLITE_PATH });
  }
  await store.init();
  try {
    await pipeline.run(command, options);
  } finally {
    await store.close();
  }
}
