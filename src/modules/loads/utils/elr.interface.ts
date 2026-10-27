import type { LoadEntity } from '../entities/load.entity';

/** What the shipper adds when making the e-LR — the rest fills in from the load. */
export interface ElrInput {
  packages: number;
  sealNumber?: string;
  /** Freight stays hidden on the LR unless the shipper ticks this. */
  showFreight?: boolean;
  /** Own fleet may type the invoice instead of uploading it. */
  invoiceNumber?: string;
  /** YYYY-MM-DD. */
  invoiceDate?: string;
  invoiceValue?: number;
}

export interface ElrRow {
  label: string;
  value: string;
}

export interface ElrSection {
  heading: string;
  rows: ElrRow[];
}

export interface ElrContent {
  title: string;
  /** "LR number" unless set — the renderer also prints Loadsmart's invoices. */
  numberLabel?: string;
  elrNumber: string;
  date: string;
  sections: ElrSection[];
}

export interface GeneratedElr {
  load: LoadEntity;
  elrNumber: string;
  /** Short-lived download URL of the generated PDF. */
  downloadUrl: string | null;
}
