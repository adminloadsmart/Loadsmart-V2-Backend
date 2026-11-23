import {
  MessageIntent,
  MessageRecipientKind,
  OfferAction,
  OutboundMessageKind,
} from '../messaging.types';

/**
 * The load-flow WhatsApp templates of today's tasks 7 and 8, keyed by their id in the load-flow
 * notification catalog (LS_N_…; "Load flow notifications" sheet). Wording, tokens and buttons are
 * the catalog's. Each key maps to its approved MSG91 template name through env
 * (MSG91_WHATSAPP_TEMPLATE_<KEY>).
 *
 * In MSG91 these templates are created with {{var1}}, {{var2}}… (no underscore, unlike the older
 * notification templates' {{var_1}}) in the order of `variables` below; one marked
 * `catalogParameterNames` uses the catalog tokens themselves ({{from_area}}…). The send must use
 * the same names (msg91ParameterNamesOf) or Meta rejects it: "Parameter name is missing".
 * msg91BodyOf gives the body to create. All are Utility templates; at most 3 buttons; a body never
 * starts or ends with a variable (MSG91 / Meta reject those).
 */

/** A template button. A quick reply with `action` is acted on when tapped (the reply router reads
 *  the tapped message and this title); one without is shown but not handled yet; `url` buttons
 *  open a link. A URL button with `urlVariable` has a dynamic link: the template's URL ends in
 *  {{1}} and the send fills it with that variable's value (load_uuid → the load's id,
 *  destination_query → "lat,lng" or the drop address for a maps search). */
export interface TemplateButton {
  title: string;
  action?: OfferAction;
  url?: boolean;
  urlVariable?: string;
}

export interface TemplateDefinition {
  audience: MessageRecipientKind[];
  intent: MessageIntent;
  category: 'UTILITY' | 'MARKETING';
  /** What a reply to this template answers (drives the reply router). */
  kind: OutboundMessageKind;
  /** Catalog tokens in template order: {{var1}} = variables[0], and so on. */
  variables: readonly string[];
  /** The approved MSG91 template names its placeholders after these tokens ({{from_area}})
   *  instead of {{var1}}, {{var2}}… */
  catalogParameterNames?: boolean;
  /** The catalog wording, with {{token}} placeholders. */
  body: string;
  buttons?: readonly TemplateButton[];
  headerDocument?: boolean;
  /** A shipper message that may go on WhatsApp before the load memo (an exception to the "no
   *  WhatsApp to the shipper before the memo" rule). None today: user decision 23 Nov — the memo
   *  (LS_N_0069) is the shipper's first WhatsApp; LS_N_0067 / LS_N_0103 are held (logged as
   *  suppressed). Set it back on those two to send them again. */
  sendsBeforeMemo?: boolean;
}

const BROKER: MessageRecipientKind[] = ['partner'];
const TRANSPORTER: MessageRecipientKind[] = ['transporter'];
const OFFER_REPLIES = [
  { title: 'Accept', action: 'accept' },
  { title: 'Negotiate', action: 'negotiate' },
  { title: 'Reject', action: 'reject' },
] as const satisfies readonly TemplateButton[];
const QUOTE_REPLIES = [
  { title: 'Give rate', action: 'give_rate' },
  { title: 'Reject', action: 'reject' },
] as const satisfies readonly TemplateButton[];

export const TEMPLATE_REGISTRY = {
  // ---- Task 7: requirement, quotes, indent, memo
  LS_N_0105: {
    audience: BROKER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'offer',
    variables: ['from_area', 'to_area', 'truck_type', 'weight', 'reporting_time', 'rate'],
    // Approved in MSG91 as ls_n_0105 with {{from_area}}… rather than {{var1}}….
    catalogParameterNames: true,
    body: 'New load from Loadsmart: {{from_area}} to {{to_area}}, {{truck_type}}, {{weight}} t, reporting {{reporting_time}}. Rate ₹{{rate}}. Are you interested?',
    buttons: OFFER_REPLIES,
  },
  LS_N_0106: {
    audience: BROKER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'offer',
    variables: ['from_area', 'to_area', 'truck_type', 'weight', 'reporting_time'],
    body: 'New load from Loadsmart: {{from_area}} to {{to_area}}, {{truck_type}}, {{weight}} t, reporting {{reporting_time}}. Send us your best rate.',
    buttons: QUOTE_REPLIES,
  },
  LS_N_0119: {
    audience: TRANSPORTER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'offer',
    variables: ['shipper_name', 'origin', 'destination', 'truck_type', 'reporting_time', 'price'],
    body: 'New load from {{shipper_name}}: {{origin}} to {{destination}}, {{truck_type}}, reporting {{reporting_time}}. Price ₹{{price}}. Are you interested?',
    buttons: OFFER_REPLIES,
  },
  // The catalog's "Ask for quotes variant" of LS_N_0119, as approved in MSG91 ("New Load
  // Available – Submit Your Quote" header, named parameters). No quick replies: the transporter
  // types a rate (with the truck number) or opens the load in the app — a fixed link.
  LS_N_0119_QUOTE: {
    audience: TRANSPORTER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'offer',
    variables: [
      'origin',
      'destination',
      'reporting_datetime',
      'delivery_datetime',
      'truck_type',
      'goods',
    ],
    catalogParameterNames: true,
    body:
      'A new load is available. Please review the details below and submit your quote.\n\n' +
      'Source: {{origin}}\n' +
      'Destination: {{destination}}\n' +
      'Reporting Date & Time: {{reporting_datetime}}\n' +
      'Delivery Date & Time: {{delivery_datetime}}\n' +
      'Truck Type: {{truck_type}}\n' +
      'Goods: {{goods}}\n\n' +
      'Please review the load details and submit your best quote.',
    buttons: [{ title: 'View load in app', url: true }],
  },
  LS_N_0120: {
    audience: TRANSPORTER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'offer',
    variables: ['shipper_name', 'origin', 'destination', 'truck_type', 'reporting_time', 'rate'],
    body: 'New indent from {{shipper_name}}: {{origin}} to {{destination}}, {{truck_type}}, reporting {{reporting_time}}. Contract rate ₹{{rate}}. Will you take it?',
    buttons: [
      { title: 'Accept', action: 'accept' },
      { title: 'Reject', action: 'reject' },
    ],
  },
  // ---- Shipper, before the memo — held by the channel rule until the memo (user decision 23 Nov)
  LS_N_0067: {
    audience: ['shipper_user'],
    intent: 'action',
    category: 'UTILITY',
    kind: 'offer',
    variables: ['origin', 'destination', 'truck_type', 'reporting_time', 'price'],
    body: "Loadsmart's bid for your load {{origin}} to {{destination}} ({{truck_type}}, reporting {{reporting_time}}) is ₹{{price}}. Accept it and we'll send the truck details.",
    buttons: [
      { title: 'Accept', action: 'accept' },
      { title: 'Counter', action: 'negotiate' },
      { title: 'Reject', action: 'reject' },
    ],
  },
  LS_N_0103: {
    audience: ['shipper_user'],
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['origin', 'destination', 'bid_count', 'best_rate'],
    body: 'Your load {{origin}} to {{destination}} has {{bid_count}} bids. Lowest is ₹{{best_rate}}. Pick one to get the truck details.',
    buttons: [{ title: 'Compare bids', url: true, urlVariable: 'load_uuid' }],
  },
  LS_N_0069: {
    audience: ['shipper_user'],
    intent: 'action',
    category: 'UTILITY',
    kind: 'offer',
    variables: ['vehicle_no', 'driver_name', 'price', 'origin', 'destination', 'expiry_time'],
    body: 'Your load memo is ready: truck {{vehicle_no}}, driver {{driver_name}}, ₹{{price}} for {{origin}} to {{destination}}. Accept it by {{expiry_time}} to confirm the truck.',
    buttons: [
      { title: 'Accept memo', action: 'accept' },
      { title: 'View memo', url: true, urlVariable: 'load_uuid' },
    ],
  },

  // ---- Task 8: confirmations, papers approved, payment advice, POD, balance on hold
  LS_N_0107: {
    audience: BROKER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['rate', 'from_area', 'to_area'],
    body: 'Your rate of ₹{{rate}} for {{from_area}} to {{to_area}} is accepted. Reply with the truck number, driver name, driver mobile and DL number.',
  },
  // A truck or driver failed its check before the memo (VAHAN, Sarathi, or a licence class that
  // doesn't fit the truck) — to the broker on a Loadsmart load, else the shipper's transporter.
  LS_N_0108: {
    audience: [...BROKER, ...TRANSPORTER],
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['failed_item', 'load_id', 'check_issue'],
    body: "We can't use {{failed_item}} for load {{load_id}}: {{check_issue}}. Please send another one.",
  },
  LS_N_0121: {
    audience: TRANSPORTER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['rate', 'origin', 'destination', 'shipper_name'],
    body: "Your rate of ₹{{rate}} for {{origin}} to {{destination}} is accepted by {{shipper_name}}. Reply with the truck number, driver name, mobile, DL number and the driver's date of birth.",
  },
  LS_N_0110: {
    audience: BROKER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['load_id', 'from_area', 'to_area', 'vehicle_no', 'reporting_time', 'driver_name'],
    body: 'Confirmed: load {{load_id}}, {{from_area}} to {{to_area}}. Truck {{vehicle_no}} must report by {{reporting_time}}. Driver {{driver_name}} has the loading point.',
    buttons: [{ title: 'Track truck', url: true, urlVariable: 'load_uuid' }],
  },
  LS_N_0123: {
    audience: TRANSPORTER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['shipper_name', 'vehicle_no', 'origin', 'destination', 'reporting_time'],
    body: 'Confirmed by {{shipper_name}}: truck {{vehicle_no}} for {{origin}} to {{destination}}. Report by {{reporting_time}}. Track the trip with this link.',
    buttons: [{ title: 'Track truck', url: true, urlVariable: 'load_uuid' }],
  },
  LS_N_0130: {
    audience: ['driver'],
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['vehicle_no', 'destination'],
    body: 'Papers approved for truck {{vehicle_no}}. You can leave for {{destination}} now.',
    buttons: [{ title: 'Get directions', url: true, urlVariable: 'destination_query' }],
  },
  LS_N_0112: {
    audience: BROKER,
    intent: 'update',
    category: 'UTILITY',
    kind: 'template',
    variables: ['load_id', 'vehicle_no', 'payment_head', 'net_amount', 'tds_amount', 'utr'],
    body: 'Payment sent for load {{load_id}}, truck {{vehicle_no}}. {{payment_head}}: ₹{{net_amount}} after ₹{{tds_amount}} TDS. UTR {{utr}}. The payment proof is attached.',
    headerDocument: true,
  },
  LS_N_0126: {
    audience: TRANSPORTER,
    intent: 'update',
    category: 'UTILITY',
    kind: 'template',
    variables: ['shipper_name', 'amount', 'vehicle_no', 'utr'],
    body: 'Payment recorded by {{shipper_name}}: ₹{{amount}} for truck {{vehicle_no}}, UTR {{utr}}. The proof is attached.',
    headerDocument: true,
  },
  LS_N_0115: {
    audience: BROKER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['load_id', 'pod_due_date'],
    body: 'Load {{load_id}} is delivered. Send the original POD to Loadsmart, Mohali by {{pod_due_date}}. After that, ₹100 a day comes off your balance.',
    buttons: [{ title: 'Sent by courier' }, { title: 'Bringing it' }],
  },
  LS_N_0116: {
    audience: BROKER,
    intent: 'action',
    category: 'UTILITY',
    kind: 'template',
    variables: ['load_id', 'penalty_amount'],
    body: 'The original POD for load {{load_id}} is late. ₹100 a day now comes off your balance, ₹{{penalty_amount}} so far. Please send it today.',
    buttons: [{ title: 'Sent by courier' }],
  },
  LS_N_0117: {
    audience: BROKER,
    intent: 'update',
    category: 'UTILITY',
    kind: 'template',
    variables: ['load_id'],
    body: "We've received the original POD for load {{load_id}}. Your balance payment is in process.",
  },
  LS_N_0124: {
    audience: TRANSPORTER,
    intent: 'update',
    category: 'UTILITY',
    kind: 'template',
    variables: ['vehicle_no', 'origin', 'destination', 'shipper_name'],
    body: 'The POD for truck {{vehicle_no}}, {{origin}} to {{destination}}, is received by {{shipper_name}}. Thank you.',
  },
  LS_N_0122: {
    audience: TRANSPORTER,
    intent: 'update',
    category: 'UTILITY',
    kind: 'template',
    variables: ['shipper_name', 'origin', 'destination'],
    body: 'The load from {{shipper_name}}, {{origin}} to {{destination}}, is now closed. Thanks for your rate.',
  },
  LS_N_0109: {
    audience: BROKER,
    intent: 'update',
    category: 'UTILITY',
    kind: 'template',
    variables: ['from_area', 'to_area'],
    body: "The load {{from_area}} to {{to_area}} is now filled. Thanks for your rate. We'll send you more loads on this route.",
  },
  LS_N_0114: {
    audience: BROKER,
    intent: 'update',
    category: 'UTILITY',
    kind: 'template',
    variables: ['load_id', 'issue_type'],
    body: "Load {{load_id}} was delivered with {{issue_type}} noted on the POD. Your balance is on hold until it's settled. Our team will call you.",
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof TEMPLATE_REGISTRY;

export function getTemplateDefinition(templateKey: TemplateKey): TemplateDefinition {
  return TEMPLATE_REGISTRY[templateKey];
}

export function isTemplateKey(value: string | null | undefined): value is TemplateKey {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(TEMPLATE_REGISTRY, value as string);
}

/** Body variables in template order; a missing value is a programming error, not a send failure. */
export function orderTemplateVariables(
  templateKey: TemplateKey,
  values: Record<string, string>,
): string[] {
  return getTemplateDefinition(templateKey).variables.map((variableName) => {
    const value = values[variableName];
    if (value === undefined || value === '') {
      throw new Error(`Template ${templateKey} needs variable "${variableName}"`);
    }
    return value;
  });
}

/** The quick-reply actions a template offers, in button order. */
export function offerActionsOf(templateKey: TemplateKey): OfferAction[] {
  return (getTemplateDefinition(templateKey).buttons ?? []).flatMap((button) =>
    button.action ? [button.action] : [],
  );
}

/** The dynamic part of each URL button that has one, by its 1-based place in the template; a
 *  button whose value is missing is left out (its template URL is then expected to be static). */
export function urlButtonsOf(
  templateKey: TemplateKey,
  values: Record<string, string>,
): { position: number; value: string }[] {
  return (getTemplateDefinition(templateKey).buttons ?? []).flatMap((button, index) =>
    button.url && button.urlVariable && values[button.urlVariable]
      ? [{ position: index + 1, value: values[button.urlVariable] }]
      : [],
  );
}

/** The action of a tapped quick-reply button, from its text (MSG91 returns the button text). */
export function actionOfButtonTitle(
  templateKey: TemplateKey,
  title: string | null,
): OfferAction | null {
  if (!title) return null;
  const wanted = title.trim().toLowerCase();
  const button = (getTemplateDefinition(templateKey).buttons ?? []).find(
    (candidate) => candidate.title.toLowerCase() === wanted,
  );
  return button?.action ?? null;
}

/** The message text as sent, for the sent-log (message_log.rendered_text). */
export function renderTemplateBody(
  templateKey: TemplateKey,
  values: Record<string, string>,
): string {
  return getTemplateDefinition(templateKey).body.replace(
    /\{\{(\w+)\}\}/g,
    (_match, token: string) => values[token] ?? `{{${token}}}`,
  );
}

/** The approved template's placeholder names in `variables` order: var1, var2…, or the catalog
 *  tokens for a template marked `catalogParameterNames`. */
export function msg91ParameterNamesOf(templateKey: TemplateKey): string[] {
  const { variables, catalogParameterNames } = getTemplateDefinition(templateKey);
  return variables.map((token, index) => (catalogParameterNames ? token : `var${index + 1}`));
}

/** The body as it must be created in MSG91: catalog tokens replaced by the template's placeholder
 *  names (msg91ParameterNamesOf) — what MSG91 fills from body_<name>. */
export function msg91BodyOf(templateKey: TemplateKey): string {
  const { body, variables } = getTemplateDefinition(templateKey);
  const names = msg91ParameterNamesOf(templateKey);
  return body.replace(
    /\{\{(\w+)\}\}/g,
    (_match, token: string) => `{{${names[variables.indexOf(token)]}}}`,
  );
}
