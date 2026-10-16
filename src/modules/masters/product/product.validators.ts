import { z } from 'zod';
import { paginationQuery } from '../../../shared/validators/pagination';
import {
  PRODUCT_APPROVAL_STATUSES,
  PRODUCT_CLASSIFICATIONS,
  PRODUCT_CONVERSION_MODELS,
  PRODUCT_DIMENSION_UNITS,
  PRODUCT_PACKAGINGS,
  PRODUCT_STATUSES,
} from './product.types';

const uuid = z.string().uuid();
const fields = {
  productDetails: z.string().trim().min(1).max(255),
  hsnCode: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'HSN code must contain 4 to 8 digits'),
  packaging: z.enum(PRODUCT_PACKAGINGS),
  invoiceValue: z.number().nonnegative(),
  billingUnit: z.string().trim().max(30),
  dimensions: z.string().trim().max(100),
  weight: z.number().nonnegative(),
  weightUnit: z.string().trim().max(30),
  length: z.number().positive().max(100000),
  width: z.number().positive().max(100000),
  height: z.number().positive().max(100000),
  dimensionUnit: z.enum(PRODUCT_DIMENSION_UNITS),
  conversionModel: z.enum(PRODUCT_CONVERSION_MODELS),
};
const subItem = z.object({ name: z.string().trim().min(1).max(255) }).strict();
const params = z.object({ productId: uuid });
export const productValidators = {
  list: z.object({
    query: paginationQuery.extend({
      search: z.string().trim().min(1).optional(),
      status: z.enum(PRODUCT_STATUSES).optional(),
      approvalStatus: z.enum(PRODUCT_APPROVAL_STATUSES).optional(),
    }),
  }),
  get: z.object({ params }),
  export: z.object({
    query: z.object({
      search: z.string().trim().min(1).optional(),
      status: z.enum(PRODUCT_STATUSES).optional(),
      approvalStatus: z.enum(PRODUCT_APPROVAL_STATUSES).optional(),
    }),
  }),
  create: z.object({
    body: z
      .object({
        productDetails: fields.productDetails,
        hsnCode: fields.hsnCode.optional(),
        packaging: fields.packaging.optional(),
        invoiceValue: fields.invoiceValue.optional(),
        billingUnit: fields.billingUnit.optional(),
        dimensions: fields.dimensions.optional(),
        weight: fields.weight.optional(),
        weightUnit: fields.weightUnit.optional(),
        classification: z.enum(PRODUCT_CLASSIFICATIONS).optional(),
        length: fields.length.optional(),
        width: fields.width.optional(),
        height: fields.height.optional(),
        dimensionUnit: fields.dimensionUnit.optional(),
        conversionModel: fields.conversionModel.optional(),
        subItems: z.array(subItem).max(100).optional(),
      })
      .strict(),
  }),
  update: z.object({
    params,
    body: z
      .object({
        ...Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [key, value.nullable().optional()]),
        ),
        classification: z.enum(PRODUCT_CLASSIFICATIONS).optional(),
        status: z.enum(PRODUCT_STATUSES).optional(),
        subItems: z
          .object({
            add: z.array(subItem).max(100).optional(),
            update: z
              .array(z.object({ id: uuid, name: z.string().trim().min(1).max(255) }))
              .max(100)
              .optional(),
            remove: z.array(uuid).max(100).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),
  approve: z.object({ params }),
  reject: z.object({
    params,
    body: z.object({ reason: z.string().trim().min(1).max(1000) }).strict(),
  }),
  delete: z.object({ params }),
  status: z.object({ params, body: z.object({ status: z.enum(PRODUCT_STATUSES) }).strict() }),
};
