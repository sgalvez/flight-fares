export const AIRPORTS = ["SCL", "IQQ"] as const;
export type Airport = (typeof AIRPORTS)[number];

export const CARRIERS = ["LA", "H2", "JA"] as const;
export type PreferredCarrier = (typeof CARRIERS)[number];
export type SourceKind = "amadeus" | "browser" | "fixture";
export type Verification = "estimated" | "verified" | "stale";
export type FareFamily = "BASIC" | "LIGHT" | "FULL" | "UNKNOWN";

export interface Route {
  origin: Airport;
  destination: Airport;
}

export interface BaggageAllowance {
  personalItemIncluded: boolean;
  cabinBagIncluded: boolean | null;
  cabinBagFeeClp: number | null;
  checkedBagIncluded: boolean | null;
}

export interface FlightOffer {
  id?: number;
  source: string;
  sourceKind: SourceKind;
  origin: Airport;
  destination: Airport;
  departureDate: string;
  departureAt: string;
  arrivalAt: string;
  carrier: string;
  operatingCarrier: string;
  flightNumber: string;
  fareFamily: FareFamily;
  currency: "CLP";
  basePriceClp: number;
  taxesClp: number;
  mandatoryFeesClp: number;
  baggage: BaggageAllowance;
  confirmedDiscountClp: number;
  potentialDiscountLabel?: string;
  comparablePriceClp: number;
  verification: Verification;
  purchaseUrl: string;
  capturedAt: string;
  expiresAt?: string;
  rawFingerprint: string;
}

export interface SearchRequest {
  route: Route;
  departureDate: string;
  adults: number;
  directOnly: boolean;
}

export interface FlightSource {
  readonly name: string;
  readonly kind: SourceKind;
  readonly carrier?: string;
  isEnabled(): boolean;
  searchOneWay(request: SearchRequest): Promise<FlightOffer[]>;
  close?(): Promise<void>;
}

export interface DealAssessment {
  key: string;
  offer: FlightOffer;
  tier: "signal" | "good" | "exceptional";
  medianClp: number | null;
  percentBelowMedian: number | null;
  reason: string;
  recommended: boolean;
}

export interface TripPair {
  key: string;
  outbound: FlightOffer;
  inbound: FlightOffer;
  nights: 2 | 3 | 4;
  totalComparableClp: number;
  allVerified: boolean;
}

export interface PromotionObservation {
  sourceUrl: string;
  title: string;
  matchedBenefits: string[];
  observedAt: string;
  fingerprint: string;
}

export interface SourceHealth {
  source: string;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export interface RadarPreferences {
  routes: Route[];
  horizonDays: number;
  adults: number;
  cabinBagRequired: true;
  stayNights: readonly [2, 3, 4];
  latamTolerancePercent: number;
  competitorSavingsPercent: number;
  bankProducts: string[];
  latamPassTier: string;
  latamPassClub: boolean;
}
