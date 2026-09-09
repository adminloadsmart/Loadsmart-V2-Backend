import { PaginationInput } from '../../../shared/utils/pagination';
import { ProductApprovalStatus, ProductStatus } from './product.types';

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
