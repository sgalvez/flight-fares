import type { FlightOffer, FlightSource, SearchRequest } from "../domain.js";
import { cabinBagIncluded, comparablePrice, fingerprint, normalizeFareFamily, roundClp } from "../pricing.js";

interface AmadeusSegment {
  departure: { iataCode: string; at: string };
  arrival: { iataCode: string; at: string };
  carrierCode: string;
  number: string;
  operating?: { carrierCode?: string };
}

interface AmadeusOffer {
  id: string;
  instantTicketingRequired?: boolean;
  itineraries: Array<{ segments: AmadeusSegment[] }>;
  price: { currency: string; total: string; base: string; grandTotal?: string };
  travelerPricings?: Array<{
    fareDetailsBySegment?: Array<{
      brandedFare?: string;
      includedCabinBags?: { quantity?: number };
      includedCheckedBags?: { quantity?: number };
    }>;
  }>;
  lastTicketingDate?: string;
}

interface TokenResponse { access_token: string; expires_in: number }

function officialPurchaseUrl(carrier: string): string {
  if (carrier === "LA") return "https://www.latamairlines.com/cl/es";
  if (carrier === "H2") return "https://www.skyairline.com/chile";
  if (carrier === "JA") return "https://jetsmart.com/cl/es";
  return "https://www.google.com/travel/flights";
}

export class AmadeusSource implements FlightSource {
  readonly name = "amadeus";
  readonly kind = "amadeus" as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: {
    apiKey?: string;
    apiSecret?: string;
    baseUrl: string;
    cabinBagEstimates: Record<string, number>;
    timeoutMs?: number;
  }) {}

  isEnabled() { return Boolean(this.options.apiKey && this.options.apiSecret); }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (!this.options.apiKey || !this.options.apiSecret) throw new Error("Amadeus credentials are missing");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.options.apiKey,
      client_secret: this.options.apiSecret
    });
    const response = await fetch(`${this.options.baseUrl}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 25_000)
    });
    if (!response.ok) throw new Error(`Amadeus authentication failed (${response.status}): ${await response.text()}`);
    const token = await response.json() as TokenResponse;
    this.token = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
    return token.access_token;
  }

  async searchOneWay(request: SearchRequest): Promise<FlightOffer[]> {
    const token = await this.accessToken();
    const query = new URLSearchParams({
      originLocationCode: request.route.origin,
      destinationLocationCode: request.route.destination,
      departureDate: request.departureDate,
      adults: String(request.adults),
      nonStop: String(request.directOnly),
      currencyCode: "CLP",
      max: "50"
    });
    const response = await fetch(`${this.options.baseUrl}/v2/shopping/flight-offers?${query}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 40_000)
    });
    if (response.status === 429) throw new Error("Amadeus monthly or rate quota exhausted (429)");
    if (!response.ok) throw new Error(`Amadeus search failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { data?: AmadeusOffer[] };
    const capturedAt = new Date().toISOString();
    return (payload.data ?? []).flatMap((raw): FlightOffer[] => {
      const segments = raw.itineraries[0]?.segments ?? [];
      if (segments.length !== 1) return [];
      const segment = segments[0]!;
      if (raw.price.currency !== "CLP") return [];
      const fareDetail = raw.travelerPricings?.[0]?.fareDetailsBySegment?.[0];
      const fareFamily = normalizeFareFamily(fareDetail?.brandedFare);
      const included = fareDetail?.includedCabinBags?.quantity !== undefined
        ? fareDetail.includedCabinBags.quantity > 0
        : cabinBagIncluded(segment.carrierCode, fareFamily);
      const cabinBagFee = included === true ? 0 : this.options.cabinBagEstimates[segment.carrierCode] ?? null;
      const total = roundClp(Number(raw.price.grandTotal ?? raw.price.total));
      const base = roundClp(Number(raw.price.base));
      const taxes = Math.max(0, total - base);
      const comparable = comparablePrice({
        basePriceClp: base,
        taxesClp: taxes,
        mandatoryFeesClp: 0,
        cabinBagRequired: true,
        cabinBagIncluded: included,
        cabinBagFeeClp: cabinBagFee,
        confirmedDiscountClp: 0
      });
      return [{
        source: this.name,
        sourceKind: this.kind,
        origin: request.route.origin,
        destination: request.route.destination,
        departureDate: request.departureDate,
        departureAt: new Date(segment.departure.at).toISOString(),
        arrivalAt: new Date(segment.arrival.at).toISOString(),
        carrier: segment.carrierCode,
        operatingCarrier: segment.operating?.carrierCode ?? segment.carrierCode,
        flightNumber: `${segment.carrierCode}${segment.number}`,
        fareFamily,
        currency: "CLP",
        basePriceClp: base,
        taxesClp: taxes,
        mandatoryFeesClp: 0,
        baggage: {
          personalItemIncluded: true,
          cabinBagIncluded: included,
          cabinBagFeeClp: cabinBagFee,
          checkedBagIncluded: fareDetail?.includedCheckedBags?.quantity !== undefined
            ? fareDetail.includedCheckedBags.quantity > 0
            : null
        },
        confirmedDiscountClp: 0,
        comparablePriceClp: comparable,
        verification: "estimated",
        purchaseUrl: officialPurchaseUrl(segment.carrierCode),
        capturedAt,
        ...(raw.lastTicketingDate ? { expiresAt: `${raw.lastTicketingDate}T23:59:59.000Z` } : {}),
        rawFingerprint: fingerprint([raw.id, segment, total, fareFamily])
      }];
    });
  }
}
