export interface ShipperAnalyticsCards {
  loadsMoved: number;
  tonnage: number;
  onTimePercentage: number | null;
}

export interface TonnageByProductItem {
  productId: string;
  productName: string;
  tonnes: number;
}

export interface LanePerformanceItem {
  lane: string;
  loads: number;
  avgTatMinutes: number | null;
  onTimePercentage: number | null;
  avgKm: null;
}

export interface ShipperAnalyticsOverview {
  cards: ShipperAnalyticsCards;
  tonnageByProduct: TonnageByProductItem[];
  lanePerformance: LanePerformanceItem[];
}
