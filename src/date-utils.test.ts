import { describe, expect, it } from "vitest";
import { chooseDiscoveryDates, daysBetween, horizonDates, leadBucket } from "./date-utils.js";

describe("date utilities", () => {
  it("creates a moving horizon starting tomorrow", () => {
    const dates = horizonDates(new Date("2026-09-01T14:00:00Z"), 3);
    expect(dates).toEqual(["2026-09-02", "2026-09-03", "2026-09-04"]);
  });

  it("handles leap days and stay lengths", () => {
    expect(horizonDates(new Date("2028-02-27T23:00:00Z"), 3)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(daysBetween("2028-02-28", "2028-03-02")).toBe(3);
  });

  it("never exceeds the source budget", () => {
    const dates = horizonDates(new Date("2026-09-01T00:00:00Z"), 60);
    const selected = chooseDiscoveryDates(dates, 17, new Date("2026-09-01T00:00:00Z"));
    expect(selected).toHaveLength(17);
    expect(new Set(selected).size).toBe(17);
    expect(selected.every((date) => dates.includes(date))).toBe(true);
  });

  it("assigns stable lead-time buckets", () => {
    expect(leadBucket("2026-09-08", "2026-09-01T12:00:00Z")).toBe("1-7");
    expect(leadBucket("2026-09-15", "2026-09-01T12:00:00Z")).toBe("8-14");
    expect(leadBucket("2026-10-01", "2026-09-01T12:00:00Z")).toBe("15-30");
    expect(leadBucket("2026-10-15", "2026-09-01T12:00:00Z")).toBe("31-60");
  });
});
