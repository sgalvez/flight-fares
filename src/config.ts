import { z } from "zod";
import type { RadarPreferences } from "./domain.js";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  AMADEUS_API_KEY: z.string().min(1).optional(),
  AMADEUS_API_SECRET: z.string().min(1).optional(),
  AMADEUS_BASE_URL: z.string().url().default("https://api.amadeus.com"),
  AMADEUS_MONTHLY_CAP: z.coerce.number().int().min(0).default(0),
  AMADEUS_CAP_SAFETY_PERCENT: z.coerce.number().int().min(1).max(100).default(80),
  LATAM_CABIN_BAG_ESTIMATE_CLP: z.coerce.number().int().min(0).default(20_000),
  SKY_CABIN_BAG_ESTIMATE_CLP: z.coerce.number().int().min(0).default(20_000),
  JETSMART_CABIN_BAG_ESTIMATE_CLP: z.coerce.number().int().min(0).default(20_000),
  BROWSER_SOURCES_JSON: z.string().default("[]"),
  PROMOTION_URLS_JSON: z.string().default("[]"),
  BANK_PRODUCTS: z.string().default(""),
  LATAM_PASS_TIER: z.string().default("LATAM"),
  LATAM_PASS_CLUB: z.string().default("false"),
  RADAR_TIMEZONE: z.string().default("America/Santiago"),
  HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  BROWSER_CHECKS_PER_DAY: z.coerce.number().int().min(0).max(100).default(18),
  SCREENSHOT_DIR: z.string().default("screenshots"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export interface BrowserSourceConfig {
  name: string;
  carrier: string;
  urlTemplate: string;
  priceSelector: string;
  flightNumberSelector?: string;
  departureTimeSelector?: string;
  arrivalTimeSelector?: string;
  fareFamilySelector?: string;
  cabinBagIncluded?: boolean;
  cabinBagFeeClp?: number;
  waitForSelector?: string;
  cookieAcceptSelector?: string;
  enabled?: boolean;
}

export interface PromotionUrlConfig {
  url: string;
  titleSelector?: string;
  benefitTokens?: string[];
}

function parseJsonArray<T>(raw: string, name: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("must be an array");
    return parsed as T[];
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${String(error)}`);
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(source);
  const browserSources = parseJsonArray<BrowserSourceConfig>(env.BROWSER_SOURCES_JSON, "BROWSER_SOURCES_JSON");
  const promotionUrls = parseJsonArray<PromotionUrlConfig>(env.PROMOTION_URLS_JSON, "PROMOTION_URLS_JSON");
  const preferences: RadarPreferences = {
    routes: [
      { origin: "SCL", destination: "IQQ" },
      { origin: "IQQ", destination: "SCL" }
    ],
    horizonDays: env.HORIZON_DAYS,
    adults: 1,
    cabinBagRequired: true,
    stayNights: [2, 3, 4],
    latamTolerancePercent: 10,
    competitorSavingsPercent: 20,
    bankProducts: env.BANK_PRODUCTS.split(",").map((value) => value.trim()).filter(Boolean),
    latamPassTier: env.LATAM_PASS_TIER,
    latamPassClub: env.LATAM_PASS_CLUB.toLowerCase() === "true"
  };

  return {
    ...env,
    browserSources,
    promotionUrls,
    preferences,
    cabinBagEstimates: {
      LA: env.LATAM_CABIN_BAG_ESTIMATE_CLP,
      H2: env.SKY_CABIN_BAG_ESTIMATE_CLP,
      JA: env.JETSMART_CABIN_BAG_ESTIMATE_CLP
    } as Record<string, number>
  };
}

export type RadarConfig = ReturnType<typeof loadConfig>;
