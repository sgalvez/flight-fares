import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("treats empty optional secrets as unset and keeps SQLite enabled", () => {
    const config = loadConfig({
      DATABASE_URL: "",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_CHAT_ID: "",
      AMADEUS_API_KEY: "",
      AMADEUS_API_SECRET: ""
    });

    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(config.AMADEUS_API_KEY).toBeUndefined();
    expect(config.SQLITE_PATH).toBe("data/radar.sqlite");
    expect(config.EPHEMERAL_STORE).toBe("false");
  });
});
