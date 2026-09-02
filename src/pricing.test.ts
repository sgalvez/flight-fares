import { describe, expect, it } from "vitest";
import { comparablePrice, normalizeFareFamily, parseClp, valuePerMile } from "./pricing.js";

describe("comparable pricing", () => {
  it("adds a required cabin bag only when not included", () => {
    expect(comparablePrice({
      basePriceClp: 25_000, taxesClp: 7_000, mandatoryFeesClp: 1_000,
      cabinBagRequired: true, cabinBagIncluded: false, cabinBagFeeClp: 15_000,
      confirmedDiscountClp: 3_000
    })).toBe(45_000);
    expect(comparablePrice({
      basePriceClp: 25_000, taxesClp: 7_000, mandatoryFeesClp: 1_000,
      cabinBagRequired: true, cabinBagIncluded: true, cabinBagFeeClp: 15_000,
      confirmedDiscountClp: 3_000
    })).toBe(30_000);
  });

  it("parses Chilean display prices", () => {
    expect(parseClp("$ 34.990 CLP")).toBe(34_990);
    expect(normalizeFareFamily("Economy Light")).toBe("LIGHT");
  });

  it("calculates the effective CLP value obtained per mile", () => {
    expect(valuePerMile(50_000, 4_000, 10_000)).toBe(10);
  });
});
