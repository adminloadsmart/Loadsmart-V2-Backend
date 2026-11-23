/** What the visitor wants to see, as picked on the landing page's "Interested in" chips. */
export const DEMO_REQUEST_PRODUCTS = [
  'tms',
  'fms',
  'load_board',
  'driver_app',
  'not_sure',
] as const;
export type DemoRequestProduct = (typeof DEMO_REQUEST_PRODUCTS)[number];

export interface CreateDemoRequestInput {
  name: string;
  companyName: string;
  email: string;
  /** 10 digits, no country code (validators normalise "+91 98765 43210"). */
  phoneNumber: string;
  product: DemoRequestProduct;
  /** Honeypot: hidden from people, filled by bots. Any value means the request is dropped. */
  website?: string;
}

/** Request metadata kept for spam triage; never shown to the visitor. */
export interface DemoRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface DemoRequestReceipt {
  received: true;
}
