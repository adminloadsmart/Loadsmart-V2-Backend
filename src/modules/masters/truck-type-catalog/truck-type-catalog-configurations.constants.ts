import { TruckBodyType } from '../truck-type/truck-type.types';

export interface TruckTypeCatalogConfiguration {
  name: string;
  bodyType: TruckBodyType;
  wheelConfiguration: number;
  capacityTons: number;
  deckVolumeCubicMeters: number;
}

/**
 * The Market Fleet 3-step picker's body type → wheel configuration → capacity catalog
 * (Plan Dispatch v2.0 §6.6), seeded once into the global `masters.truck_type_catalog` table
 * (not per-tenant) so every org sees the same structured options. Source: the load-posting
 * redesign prototype's TRUCK_CATS table.
 */
export const TRUCK_TYPE_CATALOG_CONFIGURATIONS: readonly TruckTypeCatalogConfiguration[] = [
  // open_body
  {
    name: 'Open Body · 6 WH · 9T',
    bodyType: 'open_body',
    wheelConfiguration: 6,
    capacityTons: 9,
    deckVolumeCubicMeters: 30,
  },
  {
    name: 'Open Body · 10 WH · 15T',
    bodyType: 'open_body',
    wheelConfiguration: 10,
    capacityTons: 15,
    deckVolumeCubicMeters: 45,
  },
  {
    name: 'Open Body · 10 WH · 16T',
    bodyType: 'open_body',
    wheelConfiguration: 10,
    capacityTons: 16,
    deckVolumeCubicMeters: 48,
  },
  {
    name: 'Open Body · 12 WH · 21T',
    bodyType: 'open_body',
    wheelConfiguration: 12,
    capacityTons: 21,
    deckVolumeCubicMeters: 55,
  },
  {
    name: 'Open Body · 14 WH · 25T',
    bodyType: 'open_body',
    wheelConfiguration: 14,
    capacityTons: 25,
    deckVolumeCubicMeters: 60,
  },
  {
    name: 'Open Body · 16 WH · 28T',
    bodyType: 'open_body',
    wheelConfiguration: 16,
    capacityTons: 28,
    deckVolumeCubicMeters: 65,
  },
  {
    name: 'Open Body · 18 WH · 26T',
    bodyType: 'open_body',
    wheelConfiguration: 18,
    capacityTons: 26,
    deckVolumeCubicMeters: 70,
  },
  {
    name: 'Open Body · 18 WH · 43T',
    bodyType: 'open_body',
    wheelConfiguration: 18,
    capacityTons: 43,
    deckVolumeCubicMeters: 95,
  },

  // container
  {
    name: 'Container · 6 WH · 9T',
    bodyType: 'container',
    wheelConfiguration: 6,
    capacityTons: 9,
    deckVolumeCubicMeters: 28,
  },
  {
    name: 'Container · 10 WH · 15T',
    bodyType: 'container',
    wheelConfiguration: 10,
    capacityTons: 15,
    deckVolumeCubicMeters: 42,
  },
  {
    name: 'Container · 10 WH · 16T',
    bodyType: 'container',
    wheelConfiguration: 10,
    capacityTons: 16,
    deckVolumeCubicMeters: 45,
  },
  {
    name: 'Container · 12 WH · 21T',
    bodyType: 'container',
    wheelConfiguration: 12,
    capacityTons: 21,
    deckVolumeCubicMeters: 52,
  },
  {
    name: 'Container · 14 WH · 25T',
    bodyType: 'container',
    wheelConfiguration: 14,
    capacityTons: 25,
    deckVolumeCubicMeters: 58,
  },
  {
    name: 'Container · 16 WH · 28T',
    bodyType: 'container',
    wheelConfiguration: 16,
    capacityTons: 28,
    deckVolumeCubicMeters: 62,
  },

  // lcv_open_body
  {
    name: 'LCV Open Body · 4 WH · 1T',
    bodyType: 'lcv_open_body',
    wheelConfiguration: 4,
    capacityTons: 1,
    deckVolumeCubicMeters: 5,
  },
  {
    name: 'LCV Open Body · 4 WH · 1.5T',
    bodyType: 'lcv_open_body',
    wheelConfiguration: 4,
    capacityTons: 1.5,
    deckVolumeCubicMeters: 7,
  },
  {
    name: 'LCV Open Body · 4 WH · 2.5T',
    bodyType: 'lcv_open_body',
    wheelConfiguration: 4,
    capacityTons: 2.5,
    deckVolumeCubicMeters: 10,
  },
  {
    name: 'LCV Open Body · 6 WH · 4T',
    bodyType: 'lcv_open_body',
    wheelConfiguration: 6,
    capacityTons: 4,
    deckVolumeCubicMeters: 14,
  },
  {
    name: 'LCV Open Body · 6 WH · 5T',
    bodyType: 'lcv_open_body',
    wheelConfiguration: 6,
    capacityTons: 5,
    deckVolumeCubicMeters: 17,
  },
  {
    name: 'LCV Open Body · 6 WH · 7T',
    bodyType: 'lcv_open_body',
    wheelConfiguration: 6,
    capacityTons: 7,
    deckVolumeCubicMeters: 22,
  },

  // lcv_container
  {
    name: 'LCV Container · 4 WH · 1T',
    bodyType: 'lcv_container',
    wheelConfiguration: 4,
    capacityTons: 1,
    deckVolumeCubicMeters: 4.5,
  },
  {
    name: 'LCV Container · 4 WH · 1.5T',
    bodyType: 'lcv_container',
    wheelConfiguration: 4,
    capacityTons: 1.5,
    deckVolumeCubicMeters: 6.5,
  },
  {
    name: 'LCV Container · 4 WH · 2.5T',
    bodyType: 'lcv_container',
    wheelConfiguration: 4,
    capacityTons: 2.5,
    deckVolumeCubicMeters: 9,
  },
  {
    name: 'LCV Container · 6 WH · 4T',
    bodyType: 'lcv_container',
    wheelConfiguration: 6,
    capacityTons: 4,
    deckVolumeCubicMeters: 13,
  },
  {
    name: 'LCV Container · 6 WH · 5T',
    bodyType: 'lcv_container',
    wheelConfiguration: 6,
    capacityTons: 5,
    deckVolumeCubicMeters: 16,
  },
  {
    name: 'LCV Container · 6 WH · 7T',
    bodyType: 'lcv_container',
    wheelConfiguration: 6,
    capacityTons: 7,
    deckVolumeCubicMeters: 20,
  },

  // trailer_dala_body
  {
    name: 'Trailer Dala Body · 14 WH · 25T',
    bodyType: 'trailer_dala_body',
    wheelConfiguration: 14,
    capacityTons: 25,
    deckVolumeCubicMeters: 65,
  },
  {
    name: 'Trailer Dala Body · 18 WH · 30T',
    bodyType: 'trailer_dala_body',
    wheelConfiguration: 18,
    capacityTons: 30,
    deckVolumeCubicMeters: 80,
  },
  {
    name: 'Trailer Dala Body · 18 WH · 35T',
    bodyType: 'trailer_dala_body',
    wheelConfiguration: 18,
    capacityTons: 35,
    deckVolumeCubicMeters: 90,
  },
  {
    name: 'Trailer Dala Body · 22 WH · 40T',
    bodyType: 'trailer_dala_body',
    wheelConfiguration: 22,
    capacityTons: 40,
    deckVolumeCubicMeters: 100,
  },

  // trailer_flat_bed
  {
    name: 'Trailer Flat Bed · 14 WH · 26T',
    bodyType: 'trailer_flat_bed',
    wheelConfiguration: 14,
    capacityTons: 26,
    deckVolumeCubicMeters: 60,
  },
  {
    name: 'Trailer Flat Bed · 18 WH · 30T',
    bodyType: 'trailer_flat_bed',
    wheelConfiguration: 18,
    capacityTons: 30,
    deckVolumeCubicMeters: 75,
  },
  {
    name: 'Trailer Flat Bed · 18 WH · 35T',
    bodyType: 'trailer_flat_bed',
    wheelConfiguration: 18,
    capacityTons: 35,
    deckVolumeCubicMeters: 85,
  },
  {
    name: 'Trailer Flat Bed · 22 WH · 40T',
    bodyType: 'trailer_flat_bed',
    wheelConfiguration: 22,
    capacityTons: 40,
    deckVolumeCubicMeters: 95,
  },
  {
    name: 'Trailer Flat Bed · 22 WH · 45T',
    bodyType: 'trailer_flat_bed',
    wheelConfiguration: 22,
    capacityTons: 45,
    deckVolumeCubicMeters: 105,
  },

  // tanker (deck volume mirrors capacity in the source prototype)
  {
    name: 'Tanker · 6 WH · 12T',
    bodyType: 'tanker',
    wheelConfiguration: 6,
    capacityTons: 12,
    deckVolumeCubicMeters: 12,
  },
  {
    name: 'Tanker · 10 WH · 16T',
    bodyType: 'tanker',
    wheelConfiguration: 10,
    capacityTons: 16,
    deckVolumeCubicMeters: 16,
  },
  {
    name: 'Tanker · 10 WH · 20T',
    bodyType: 'tanker',
    wheelConfiguration: 10,
    capacityTons: 20,
    deckVolumeCubicMeters: 20,
  },
  {
    name: 'Tanker · 12 WH · 24T',
    bodyType: 'tanker',
    wheelConfiguration: 12,
    capacityTons: 24,
    deckVolumeCubicMeters: 24,
  },
  {
    name: 'Tanker · 14 WH · 30T',
    bodyType: 'tanker',
    wheelConfiguration: 14,
    capacityTons: 30,
    deckVolumeCubicMeters: 30,
  },

  // tipper
  {
    name: 'Tipper · 6 WH · 9T',
    bodyType: 'tipper',
    wheelConfiguration: 6,
    capacityTons: 9,
    deckVolumeCubicMeters: 8,
  },
  {
    name: 'Tipper · 10 WH · 16T',
    bodyType: 'tipper',
    wheelConfiguration: 10,
    capacityTons: 16,
    deckVolumeCubicMeters: 14,
  },
  {
    name: 'Tipper · 12 WH · 21T',
    bodyType: 'tipper',
    wheelConfiguration: 12,
    capacityTons: 21,
    deckVolumeCubicMeters: 18,
  },
  {
    name: 'Tipper · 16 WH · 25T',
    bodyType: 'tipper',
    wheelConfiguration: 16,
    capacityTons: 25,
    deckVolumeCubicMeters: 22,
  },

  // bulker
  {
    name: 'Bulker · 14 WH · 25T',
    bodyType: 'bulker',
    wheelConfiguration: 14,
    capacityTons: 25,
    deckVolumeCubicMeters: 30,
  },
  {
    name: 'Bulker · 16 WH · 28T',
    bodyType: 'bulker',
    wheelConfiguration: 16,
    capacityTons: 28,
    deckVolumeCubicMeters: 34,
  },
  {
    name: 'Bulker · 18 WH · 30T',
    bodyType: 'bulker',
    wheelConfiguration: 18,
    capacityTons: 30,
    deckVolumeCubicMeters: 36,
  },

  // mini_pickup
  {
    name: 'Mini / Pickup Truck · 4 WH · 0.75T',
    bodyType: 'mini_pickup',
    wheelConfiguration: 4,
    capacityTons: 0.75,
    deckVolumeCubicMeters: 3,
  },
  {
    name: 'Mini / Pickup Truck · 4 WH · 1T',
    bodyType: 'mini_pickup',
    wheelConfiguration: 4,
    capacityTons: 1,
    deckVolumeCubicMeters: 4,
  },
  {
    name: 'Mini / Pickup Truck · 4 WH · 1.25T',
    bodyType: 'mini_pickup',
    wheelConfiguration: 4,
    capacityTons: 1.25,
    deckVolumeCubicMeters: 5,
  },
  {
    name: 'Mini / Pickup Truck · 4 WH · 1.7T',
    bodyType: 'mini_pickup',
    wheelConfiguration: 4,
    capacityTons: 1.7,
    deckVolumeCubicMeters: 6,
  },
];
