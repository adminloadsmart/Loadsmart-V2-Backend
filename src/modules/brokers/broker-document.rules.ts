import { BrokerDocumentType } from './broker-document.entity';

/** What each document type needs. Kept in step with the console's document form. */
export interface BrokerDocumentRule {
  numberRequired: boolean;
  /** The number's format, checked after spaces are removed (and upper-cased, except Aadhaar). */
  pattern: RegExp;
  message: string;
  issuedOnRequired: boolean;
  expiresOnRequired: boolean;
  noteRequired: boolean;
  /** At most one of this type per broker. */
  single: boolean;
}

const rule = (
  r: Partial<BrokerDocumentRule> & Pick<BrokerDocumentRule, 'pattern' | 'message'>,
) => ({
  numberRequired: true,
  issuedOnRequired: false,
  expiresOnRequired: false,
  noteRequired: false,
  single: false,
  ...r,
});

export const BROKER_DOCUMENT_RULES: Record<BrokerDocumentType, BrokerDocumentRule> = {
  pan_card: rule({
    pattern: /^[A-Z]{5}\d{4}[A-Z]$/,
    message: 'Enter a valid PAN, e.g. ABCDE1234F',
    single: true,
  }),
  // 12 digits, not starting 0 or 1.
  aadhaar: rule({
    pattern: /^[2-9]\d{11}$/,
    message: 'Enter the 12-digit Aadhaar number',
    single: true,
  }),
  gst_certificate: rule({
    pattern: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    message: 'Enter a valid 15-character GSTIN, e.g. 08ABCDE1234F1Z5',
    single: true,
  }),
  cancelled_cheque: rule({
    pattern: /^\d{6}$/,
    message: 'Enter the 6-digit cheque number',
  }),
  trade_licence: rule({
    pattern: /^[A-Z0-9/-]{4,50}$/,
    message: 'Use 4–50 letters, digits, / or -',
    expiresOnRequired: true,
  }),
  agreement: rule({
    numberRequired: false,
    pattern: /^[A-Z0-9/-]{2,50}$/,
    message: 'Use letters, digits, / or -',
    issuedOnRequired: true,
  }),
  other: rule({
    numberRequired: false,
    pattern: /^[A-Z0-9/-]{2,50}$/,
    message: 'Use letters, digits, / or -',
    noteRequired: true,
  }),
};

/** The number as stored: spaces removed, upper-cased (Aadhaar digits only). */
export const normaliseDocumentNumber = (type: BrokerDocumentType, raw: string) => {
  const compact = raw.replace(/\s/g, '');
  return type === 'aadhaar' ? compact : compact.toUpperCase();
};
