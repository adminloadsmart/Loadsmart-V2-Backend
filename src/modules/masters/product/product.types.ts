export const PRODUCT_APPROVAL_STATUSES = ['pending_approval', 'approved', 'rejected'] as const;
export type ProductApprovalStatus = (typeof PRODUCT_APPROVAL_STATUSES)[number];

export const PRODUCT_STATUSES = ['active', 'inactive'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Add a Product → "Classification". */
export const PRODUCT_CLASSIFICATIONS = [
  'non_hazardous',
  'hazardous',
  'fragile',
  'perishable',
] as const;
export type ProductClassification = (typeof PRODUCT_CLASSIFICATIONS)[number];

export const PRODUCT_PACKAGINGS = [
  'bags',
  'drums',
  'pallets',
  'pieces',
  'boxes',
  'cartons',
  'tonnes',
  'bundles',
  'coils',
] as const;

/** Suggested "Unit" values (stored in billing_unit, which stays free text for older rows). */
export const PRODUCT_UNITS = ['MT', 'KG', 'QTL', 'PCS', 'LTR', 'CBM'] as const;

/** "Scale unit" for length × width × height, with its size in metres. */
export const PRODUCT_DIMENSION_UNITS = ['m', 'cm', 'ft', 'in'] as const;
export type ProductDimensionUnit = (typeof PRODUCT_DIMENSION_UNITS)[number];
export const METRES_PER_DIMENSION_UNIT: Record<ProductDimensionUnit, number> = {
  m: 1,
  cm: 0.01,
  ft: 0.3048,
  in: 0.0254,
};

/** "Conversion model" → chargeable kg per m³: surface 1:4000 ≈ 250 kg, express air 1:6000 ≈ 167 kg. */
export const PRODUCT_CONVERSION_MODELS = ['surface_road', 'express_air'] as const;
export type ProductConversionModel = (typeof PRODUCT_CONVERSION_MODELS)[number];
export const KG_PER_CBM: Record<ProductConversionModel, number> = {
  surface_road: 250,
  express_air: 167,
};
export const CFT_PER_CBM = 35.3147;
