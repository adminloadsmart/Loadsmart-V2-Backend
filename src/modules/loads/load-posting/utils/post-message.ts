import { PostAddress, PostMode } from './load-posting.types';

export interface PostMessageInput {
  mode: PostMode;
  loadCodes: string[];
  pickup: PostAddress;
  drop: PostAddress;
  pickupAt: Date;
  deliverByAt: Date | null;
  commodityName: string;
  packaging: string;
  weightTonnes: string | null;
  truckCount: number;
  truckLabels: string[];
  advancePercentage: string | null;
  note: string | null;
}

const IST_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function place(address: PostAddress): string {
  return [address.label, address.city].filter(Boolean).join(', ');
}

/**
 * The exact text that goes out to transporters (and shows under "See message"). Deliberately has
 * no target price or contract rate field — the shipper's price is never in the message
 * (PL-06 note 5, field rules "Price"); transporters answer with their own quote.
 */
export function buildPostMessage(input: PostMessageInput): string {
  const lines = [
    input.mode === 'indent' ? 'Loadsmart indent' : 'New load on Loadsmart',
    input.loadCodes.length === 1
      ? `Load: ${input.loadCodes[0]}`
      : `Loads: ${input.loadCodes.join(', ')}`,
    `Pickup: ${place(input.pickup)} - ${IST_FORMAT.format(input.pickupAt)}`,
    `Drop: ${place(input.drop)}`,
  ];
  if (input.deliverByAt) lines.push(`Deliver by: ${IST_FORMAT.format(input.deliverByAt)}`);
  lines.push(`Truck: ${input.truckLabels.join(' / ')} x ${input.truckCount}`);
  const cargo = [input.commodityName, input.packaging];
  if (input.weightTonnes) cargo.push(`${Number(input.weightTonnes)} T`);
  lines.push(`Cargo: ${cargo.join(', ')}`);
  if (input.advancePercentage)
    lines.push(`Advance: ${Number(input.advancePercentage)}% before loading`);
  if (input.note) lines.push(`Note: ${input.note}`);
  lines.push(
    input.mode === 'indent'
      ? 'Reply to accept and send the truck number.'
      : 'Reply with your best rate and truck number.',
  );
  return lines.join('\n');
}
