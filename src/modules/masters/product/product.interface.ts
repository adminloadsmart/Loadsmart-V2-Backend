import { PaginationInput } from '../../../shared/utils/pagination';
import {
  ProductApprovalStatus,
  ProductClassification,
  ProductConversionModel,
  ProductDimensionUnit,
  ProductStatus,
} from './product.types';

export interface ProductSubItemInput {
  name: string;
}
export interface CreateProductInput {
  productDetails: string;
  hsnCode?: string;
  packaging?: string;
  invoiceValue?: number;
  billingUnit?: string;
  dimensions?: string;
  weight?: number;
  weightUnit?: string;
  classification?: ProductClassification;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: ProductDimensionUnit;
  conversionModel?: ProductConversionModel;
  subItems?: ProductSubItemInput[];
}
export interface UpdateProductInput {
  productDetails?: string;
  hsnCode?: string | null;
  packaging?: string | null;
  invoiceValue?: number | null;
  billingUnit?: string | null;
  dimensions?: string | null;
  weight?: number | null;
  weightUnit?: string | null;
  classification?: ProductClassification;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  dimensionUnit?: ProductDimensionUnit | null;
  conversionModel?: ProductConversionModel | null;
  status?: ProductStatus;
  subItems?: {
    add?: ProductSubItemInput[];
    update?: { id: string; name: string }[];
    remove?: string[];
  };
}
export interface ListProductsInput extends PaginationInput {
  search?: string;
  status?: ProductStatus;
  approvalStatus?: ProductApprovalStatus;
}
