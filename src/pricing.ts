import { createHash } from "node:crypto";
import type { FareFamily, FlightOffer } from "./domain.js";

export function roundClp(value: number): number {
  return Math.max(0, Math.round(value));
}

export function parseClp(raw: string): number {
  const normalized = raw.replace(/[^0-9]/g, "");
  if (!normalized) throw new Error(`Could not parse CLP amount from: ${raw}`);
  return Number.parseInt(normalized, 10);
}

export function normalizeFareFamily(raw: string | undefined): FareFamily {
  const upper = raw?.toUpperCase() ?? "";
  if (upper.includes("BASIC")) return "BASIC";
  if (upper.includes("LIGHT")) return "LIGHT";
  if (upper.includes("FULL") || upper.includes("FLEX")) return "FULL";
  return "UNKNOWN";
}

export function cabinBagIncluded(carrier: string, fareFamily: FareFamily): boolean | null {
  if (carrier === "LA") {
    if (fareFamily === "BASIC") return false;
    if (fareFamily === "LIGHT" || fareFamily === "FULL") return true;
  }
  return null;
}

export function comparablePrice(input: {
  basePriceClp: number;
  taxesClp: number;
  mandatoryFeesClp: number;
  cabinBagRequired: boolean;
  cabinBagIncluded: boolean | null;
  cabinBagFeeClp: number | null;
  confirmedDiscountClp: number;
}): number {
  const baggage = input.cabinBagRequired && input.cabinBagIncluded !== true
    ? input.cabinBagFeeClp ?? 0
    : 0;
  return roundClp(
    input.basePriceClp + input.taxesClp + input.mandatoryFeesClp + baggage - input.confirmedDiscountClp
  );
}

export function fingerprint(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export function offerIdentity(offer: FlightOffer): string {
  return [offer.origin, offer.destination, offer.departureDate, offer.carrier, offer.flightNumber, offer.fareFamily].join(":");
}

export function formatClp(value: number): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

export function valuePerMile(cashPriceClp: number, miles: number, redemptionTaxesClp: number): number {
  if (cashPriceClp < 0 || redemptionTaxesClp < 0 || miles <= 0) throw new Error("Cash price and taxes must be non-negative, and miles must be positive");
  return Math.max(0, cashPriceClp - redemptionTaxesClp) / miles;
}
