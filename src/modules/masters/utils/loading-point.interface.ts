import { PaginationInput } from './masters.types';
import { LoadingPointStatus } from './loading-point.types';

export interface CreateLoadingPointInput {
  title: string;
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  areaLocality?: string;
  city: string;
  state: string;
  pinCode: string;
  latitude?: number;
  longitude?: number;
  contactPersonName?: string;
  contactPersonNumber?: string;
  contactPersonEmail?: string;
}

export interface UpdateLoadingPointInput {
  title?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  landmark?: string | null;
  areaLocality?: string | null;
  city?: string;
  state?: string;
  pinCode?: string;
  latitude?: number | null;
  longitude?: number | null;
  contactPersonName?: string | null;
  contactPersonNumber?: string | null;
  contactPersonEmail?: string | null;
  status?: 'active' | 'inactive';
}

export interface ListLoadingPointsInput extends PaginationInput {
  search?: string;
  city?: string;
  status?: LoadingPointStatus;
}

export interface ListLoadingPointCitiesInput {
  status?: LoadingPointStatus;
}

export interface ListLoadingPointsQuery {
  page?: string | number;
  limit?: string | number;
  search?: string;
  city?: string;
  status?: string;
}

export interface CreateLoadingPointData {
  tenantId: string;
  title: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  areaLocality: string | null;
  city: string;
  state: string;
  pinCode: string;
  latitude: string | null;
  longitude: string | null;
  contactPersonName: string | null;
  contactPersonNumber: string | null;
  contactPersonEmail: string | null;
  status: LoadingPointStatus;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  createdBy: string | null;
}

export interface UpdateLoadingPointData {
  title?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  landmark?: string | null;
  areaLocality?: string | null;
  city?: string;
  state?: string;
  pinCode?: string;
  latitude?: string | null;
  longitude?: string | null;
  contactPersonName?: string | null;
  contactPersonNumber?: string | null;
  contactPersonEmail?: string | null;
  status?: 'active' | 'inactive';
  updatedBy?: string | null;
}

export interface ListLoadingPointsFilters {
  page: number;
  limit: number;
  search?: string;
  city?: string;
  status?: LoadingPointStatus;
}

export interface LoadingPointParams {
  loadingPointId: string;
}
