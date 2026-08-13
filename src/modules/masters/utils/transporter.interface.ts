import { TransporterEntity } from '../entities/transporter.entity';
import { PaginationInput, Paginated } from './masters.types';

export interface CreateTransporterInput {
  name: string;
  rate: string;
  creditDays: number;
}
export interface UpdateTransporterInput {
  name?: string;
  rate?: string;
  creditDays?: number;
}
export interface ListTransportersInput extends PaginationInput {
  search?: string;
}
export type PaginatedTransporters = Paginated<TransporterEntity>;
