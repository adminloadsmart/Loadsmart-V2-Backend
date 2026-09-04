export interface TransporterPayablesQuery {
  transporterId?: string;
  overdueOnly?: boolean;
  podPending?: boolean;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export interface TransporterPayablesTiles {
  totalPending: string;
  due: string;
  overdue: string;
  paidInPeriod: string;
}

export interface TransporterPayableRow {
  transporterId: string;
  transporterName: string;
  advancePercentage: number | null;
  creditDays: number | null;
  loadsCount: number;
  podPendingCount: number;
  advancePaid: string;
  balancePending: string;
  dueAmount: string;
  overdueAmount: string;
  paidToDate: string;
}

export interface TransporterPayablesDashboard {
  tiles: TransporterPayablesTiles;
  transporters: TransporterPayableRow[];
  total: number;
}

export interface TransporterPayableLoadRow {
  loadId: string;
  loadCode: string;
  podStatus: 'uploaded' | 'pending';
  deliveredAt: string | null;
  advancePaid: string;
  balancePending: string;
  dueDate: string | null;
  overdueAmount: string;
  isOverdue: boolean;
}

export interface TransporterLoadsQuery {
  overdueOnly?: boolean;
  podPending?: boolean;
  page: number;
  limit: number;
}

export interface TransporterLoadsResult {
  items: TransporterPayableLoadRow[];
  total: number;
}
