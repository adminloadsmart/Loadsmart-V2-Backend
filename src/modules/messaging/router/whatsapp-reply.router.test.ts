import { beforeEach, describe, expect, it } from 'vitest';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import { OfferAction, RecipientLoadStage, ReplyPrompt } from '../messaging.types';
import { InboundResolutionPatch } from '../repositories/whatsapp-inbound.repository';
import { isInboundRetry } from '../inbound/inbound-pipeline.service';
import { TAPPED_MESSAGE_WAIT } from '../messaging.constants';
import { WhatsappReplyRouter } from './whatsapp-reply.router';
import {
  ActionOutcome,
  InfoAbout,
  OpenRecipientLoad,
  RecipientLoadContext,
  ReplyActions,
  ReplySender,
  RouterMessageStore,
  SenderIdentity,
} from './reply-router.ports';

const PHONE_A = '919000000001';
const PHONE_B = '919000000002';
const NOW = new Date(Date.UTC(2026, 10, 14, 12, 0, 0));

// ---------------------------------------------------------------- fakes

class FakeStore implements RouterMessageStore {
  messageLogs: MessageLogEntity[] = [];
  inbound: WhatsappInboundEntity[] = [];
  async findMessageLogByProviderMessageId(providerMessageId: string) {
    return this.messageLogs.find((log) => log.providerMessageId === providerMessageId) ?? null;
  }
  async findMessageLogById(messageLogId: string) {
    return this.messageLogs.find((log) => log.id === messageLogId) ?? null;
  }
  async findAwaitingPick(pickerMessageLogId: string) {
    return (
      this.inbound.find(
        (row) =>
          row.pickerMessageLogId === pickerMessageLogId && row.resolution === 'awaiting_load_pick',
      ) ?? null
    );
  }
  async findLatestAwaitingPickFrom(phone: string, since: Date) {
    return (
      this.inbound
        .filter(
          (row) =>
            row.fromPhone === phone &&
            row.resolution === 'awaiting_load_pick' &&
            row.receivedAt >= since,
        )
        .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0] ?? null
    );
  }
  async findRecentLoadMessagesTo(phone: string, since: Date) {
    return this.messageLogs
      .filter(
        (log) => log.address === phone && log.loadRef !== null && (log.createdAt ?? NOW) >= since,
      )
      .sort((a, b) => (b.createdAt ?? NOW).getTime() - (a.createdAt ?? NOW).getTime());
  }
  async findFirstDecision(messageLogId: string, excludeInboundId: string) {
    return (
      this.inbound.find(
        (row) =>
          row.matchedMessageLogId === messageLogId &&
          row.id !== excludeInboundId &&
          ['accepted', 'negotiating', 'rejected', 'bid_recorded'].includes(row.resolution),
      ) ?? null
    );
  }
  async recordResolution(inboundId: string, patch: InboundResolutionPatch) {
    Object.assign(
      this.inbound.find((row) => row.id === inboundId)!,
      patch,
    );
  }
}

class FakeActions implements ReplyActions {
  stages = new Map<string, RecipientLoadStage>();
  lanes = new Map<string, string>();
  owners = new Map<string, string>();
  calls: string[] = [];
  key = (context: Pick<RecipientLoadContext, 'loadRef' | 'recipientRefId'>) =>
    `${context.loadRef}/${context.recipientRefId}`;
  addLoad(loadRef: string, recipientRefId: string, phone: string, stage: RecipientLoadStage) {
    this.stages.set(`${loadRef}/${recipientRefId}`, stage);
    this.owners.set(`${loadRef}/${recipientRefId}`, phone);
  }
  async findOpenLoadsForSender(sender: SenderIdentity): Promise<OpenRecipientLoad[]> {
    return [...this.stages.entries()]
      .filter(([key, stage]) => this.owners.get(key) === sender.phone && stage !== 'closed')
      .map(([key, stage]) => {
        const [loadRef, recipientRefId] = key.split('/');
        return {
          tenantId: null,
          loadId: `id-${loadRef}`,
          loadRef,
          recipientKind: 'partner',
          recipientRefId,
          messageLogId: null,
          stage,
          laneLabel: 'Delhi → Jaipur',
        };
      });
  }
  async stageOf(context: RecipientLoadContext) {
    return this.stages.get(this.key(context)) ?? 'closed';
  }
  async applyOfferAction(
    context: RecipientLoadContext,
    action: OfferAction,
  ): Promise<ActionOutcome> {
    this.calls.push(`${action} ${this.key(context)}`);
    if (action === 'accept') {
      this.stages.set(this.key(context), 'awaiting_dispatch');
      return { resolution: 'accepted', nextPrompt: 'dispatch_request' };
    }
    if (action === 'negotiate') {
      this.stages.set(this.key(context), 'awaiting_rate');
      return { resolution: 'negotiating', nextPrompt: 'rate_request' };
    }
    this.stages.set(this.key(context), 'closed');
    return { resolution: 'rejected' };
  }
  async applyRate(
    context: RecipientLoadContext,
    rate: number,
    truckNumber: string | null,
  ): Promise<ActionOutcome> {
    this.calls.push(
      `rate ${rate}${truckNumber ? ` truck ${truckNumber}` : ''} ${this.key(context)}`,
    );
    this.stages.set(this.key(context), 'awaiting_dispatch');
    return { resolution: 'bid_recorded', confirmationText: `₹${rate} ${context.loadRef}` };
  }
  async applyTruck(context: RecipientLoadContext, truckNumber: string): Promise<ActionOutcome> {
    this.calls.push(`truck ${truckNumber} ${this.key(context)}`);
    this.stages.set(this.key(context), 'offered');
    return { resolution: 'details_received' };
  }
  async applyDispatch(
    context: RecipientLoadContext,
    details: { truckNumber: string | null },
  ): Promise<ActionOutcome> {
    this.calls.push(`dispatch ${details.truckNumber} ${this.key(context)}`);
    this.stages.set(this.key(context), 'awaiting_slip');
    return { resolution: 'details_received', nextPrompt: 'slip_request' };
  }
  async applySlip(context: RecipientLoadContext, media: { ref: string }): Promise<ActionOutcome> {
    this.calls.push(`slip ${media.ref} ${this.key(context)}`);
    this.stages.set(this.key(context), 'closed');
    return { resolution: 'slip_received' };
  }
}

class FakeSender implements ReplySender {
  infos: string[] = [];
  prompts: string[] = [];
  pickers: { candidates: string[]; messageLogId: string }[] = [];
  constructor(private readonly store: FakeStore) {}
  infoLogs: MessageLogEntity[] = [];
  async sendInfo(sender: SenderIdentity, text: string, _replyTo: string, about?: InfoAbout) {
    this.infos.push(text);
    if (!about) return;
    // Like WhatsappReplySender: a reply about a load is logged on it (with what it asks for).
    const log = {
      id: `log-info-${this.infoLogs.length + 1}`,
      providerMessageId: `wamid.info.${this.infoLogs.length + 1}`,
      address: sender.phone,
      kind: 'info',
      loadRef: about.context.loadRef,
      loadId: about.context.loadId,
      recipientRefId: about.context.recipientRefId,
      recipientKind: about.context.recipientKind,
      tenantId: null,
      variables: about.asksFor ? { asksFor: about.asksFor } : null,
      createdAt: NOW,
    } as MessageLogEntity;
    this.infoLogs.push(log);
    this.store.messageLogs.push(log);
  }
  async sendPrompt(context: RecipientLoadContext, _sender: SenderIdentity, prompt: ReplyPrompt) {
    this.prompts.push(`${prompt} ${context.loadRef}`);
  }
  async sendLoadPicker(sender: SenderIdentity, candidates: OpenRecipientLoad[]) {
    const messageLogId = `log-picker-${this.pickers.length + 1}`;
    this.store.messageLogs.push({
      id: messageLogId,
      providerMessageId: `wamid.${messageLogId}`,
      address: sender.phone,
      kind: 'picker',
      loadRef: null,
      recipientRefId: null,
    } as MessageLogEntity);
    this.pickers.push({ candidates: candidates.map((load) => load.loadRef), messageLogId });
    return messageLogId;
  }
}

// ---------------------------------------------------------------- helpers

let store: FakeStore;
let actions: FakeActions;
let sender: FakeSender;
let router: WhatsappReplyRouter;
let inboundCounter = 0;

function offerLog(
  loadRef: string,
  recipientRefId: string,
  phone: string,
  kind: MessageLogEntity['kind'] = 'offer',
): MessageLogEntity {
  const log = {
    id: `log-${kind}-${loadRef}-${recipientRefId}`,
    providerMessageId: `wamid.${kind}.${loadRef}.${recipientRefId}`,
    address: phone,
    kind,
    loadRef,
    loadId: `id-${loadRef}`,
    recipientRefId,
    recipientKind: 'partner',
    tenantId: null,
  } as MessageLogEntity;
  store.messageLogs.push(log);
  return log;
}

function inbound(fields: Partial<WhatsappInboundEntity>): WhatsappInboundEntity {
  inboundCounter += 1;
  const row = {
    id: `in-${inboundCounter}`,
    fromPhone: PHONE_A,
    fromUserId: null,
    type: 'text',
    providerType: 'text',
    body: null,
    buttonId: null,
    listRowId: null,
    flowResponse: null,
    media: null,
    contextMessageId: null,
    receivedAt: NOW,
    resolution: 'pending',
    parsedValues: null,
    pickerMessageLogId: null,
    matchedMessageLogId: null,
    ...fields,
  } as WhatsappInboundEntity;
  store.inbound.push(row);
  return row;
}

async function route(row: WhatsappInboundEntity): Promise<InboundResolutionPatch> {
  const result = await router.handle(row);
  if (isInboundRetry(result)) throw new Error(`unexpected retry: ${result.note}`);
  Object.assign(row, result);
  return result;
}

const tap = (
  log: MessageLogEntity,
  action: OfferAction,
  phone = PHONE_A,
  buttonId = `${action}:${log.loadRef}:${log.recipientRefId}`,
) =>
  inbound({
    type: 'button',
    providerType: 'interactive',
    fromPhone: phone,
    contextMessageId: log.providerMessageId,
    buttonId,
  });

beforeEach(() => {
  store = new FakeStore();
  actions = new FakeActions();
  sender = new FakeSender(store);
  router = new WhatsappReplyRouter(store, actions, sender, { now: () => NOW });
  inboundCounter = 0;
});

// ---------------------------------------------------------------- tests

describe('offer taps', () => {
  it('routes a tap by context.id, cross-checked by the button id, and asks the next question', async () => {
    actions.addLoad('LS-2001', 'partner_A', PHONE_A, 'offered');
    const result = await route(tap(offerLog('LS-2001', 'partner_A', PHONE_A), 'accept'));
    expect(result).toMatchObject({
      resolution: 'accepted',
      routingMethod: 'context_id',
      loadRef: 'LS-2001',
      recipientRefId: 'partner_A',
      matchedMessageLogId: 'log-offer-LS-2001-partner_A',
    });
    expect(actions.calls).toEqual(['accept LS-2001/partner_A']);
    expect(sender.prompts).toEqual(['dispatch_request LS-2001']);
  });

  it('flags a button id that disagrees with the message it answers', async () => {
    actions.addLoad('LS-2001', 'partner_A', PHONE_A, 'offered');
    const result = await route(
      tap(offerLog('LS-2001', 'partner_A', PHONE_A), 'accept', PHONE_A, 'accept:LS-9999:partner_A'),
    );
    expect(result.resolution).toBe('needs_review');
    expect(actions.calls).toEqual([]);
  });

  it("never applies a tap on another user's message", async () => {
    actions.addLoad('LS-2001', 'partner_A', PHONE_A, 'offered');
    const result = await route(tap(offerLog('LS-2001', 'partner_A', PHONE_A), 'accept', PHONE_B));
    expect(result.resolution).toBe('needs_review');
    expect(actions.calls).toEqual([]);
  });

  it('keeps the first answer: same button again = repeat, a different one = changed_answer (L14)', async () => {
    actions.addLoad('LS-2004', 'partner_B', PHONE_B, 'offered');
    const log = offerLog('LS-2004', 'partner_B', PHONE_B);
    expect((await route(tap(log, 'negotiate', PHONE_B))).resolution).toBe('negotiating');
    expect((await route(tap(log, 'negotiate', PHONE_B))).resolution).toBe('repeat_tap');
    expect(sender.infos.at(-1)).toBe('LS-2004: Already noted: "negotiate".');
    expect((await route(tap(log, 'accept', PHONE_B))).resolution).toBe('changed_answer');
    expect(actions.calls).toEqual(['negotiate LS-2004/partner_B']);
    expect(sender.infos.at(-1)).toContain('first answer "negotiate"');
  });

  it('MSG91 template quick reply: no id of ours, only the text — read against the tapped template', async () => {
    actions.addLoad('LS-2001', 'partner_A', PHONE_A, 'offered');
    const log = offerLog('LS-2001', 'partner_A', PHONE_A);
    log.templateKey = 'LS_N_0105';
    const result = await route(
      inbound({
        type: 'button',
        providerType: 'button',
        contextMessageId: log.providerMessageId,
        buttonId: 'Negotiate',
        buttonText: 'Negotiate',
      }),
    );
    expect(result).toMatchObject({
      resolution: 'negotiating',
      routingMethod: 'context_id',
      loadRef: 'LS-2001',
    });
    expect(actions.calls).toEqual(['negotiate LS-2001/partner_A']);
    // A second, different tap on the same template is a changed answer.
    const again = await route(
      inbound({
        type: 'button',
        providerType: 'button',
        contextMessageId: log.providerMessageId,
        buttonId: 'Accept',
        buttonText: 'Accept',
      }),
    );
    expect(again.resolution).toBe('changed_answer');
  });

  it('a template button with no action yet (e.g. "Sent by courier") goes to review', async () => {
    const log = offerLog('LS-2001', 'partner_A', PHONE_A, 'template');
    log.templateKey = 'LS_N_0115';
    const result = await route(
      inbound({
        type: 'button',
        providerType: 'button',
        contextMessageId: log.providerMessageId,
        buttonId: 'Sent by courier',
        buttonText: 'Sent by courier',
      }),
    );
    expect(result.resolution).toBe('needs_review');
    expect(actions.calls).toEqual([]);
    expect(sender.infos).toEqual(['LS-2001: Our team will check it.']);
  });

  it("matches a tap without context by its button id among the sender's open loads", async () => {
    actions.addLoad('LS-1042', 'partner_77', PHONE_A, 'offered');
    const result = await route(
      inbound({ type: 'button', providerType: 'button', buttonId: 'reject:LS-1042:partner_77' }),
    );
    expect(result).toMatchObject({
      resolution: 'rejected',
      routingMethod: 'button_id',
      loadRef: 'LS-1042',
    });
  });
});

describe('typed rates and the load picker', () => {
  it('a rate with the truck number in one message, and a truck number on its own', async () => {
    actions.addLoad('LS-2003', 'partner_A', PHONE_A, 'awaiting_rate');
    expect((await route(inbound({ body: '42k PB10AB1234' }))).resolution).toBe('bid_recorded');
    actions.addLoad('LS-2005', 'partner_A', PHONE_A, 'awaiting_truck');
    expect((await route(inbound({ body: 'hr 26 ab 4321' }))).resolution).toBe('details_received');
    expect(actions.calls).toEqual([
      'rate 42000 truck PB10AB1234 LS-2003/partner_A',
      'truck HR26AB4321 LS-2005/partner_A',
    ]);
  });

  it('sends a plain rate to the only load that asked for one (only_pending)', async () => {
    actions.addLoad('LS-2001', 'partner_A', PHONE_A, 'awaiting_dispatch');
    actions.addLoad('LS-2003', 'partner_A', PHONE_A, 'awaiting_rate');
    const result = await route(inbound({ body: '42k' }));
    expect(result).toMatchObject({
      resolution: 'bid_recorded',
      routingMethod: 'only_pending',
      loadRef: 'LS-2003',
    });
    expect(actions.calls).toEqual(['rate 42000 LS-2003/partner_A']);
  });

  it('asks "Load chunein" when two loads wait, then applies the kept rate to the picked load (R5)', async () => {
    actions.addLoad('LS-2002', 'partner_B', PHONE_B, 'awaiting_rate');
    actions.addLoad('LS-2004', 'partner_B', PHONE_B, 'awaiting_rate');
    const typed = inbound({ fromPhone: PHONE_B, body: '37k' });
    expect(await route(typed)).toMatchObject({
      resolution: 'awaiting_load_pick',
      pickerMessageLogId: 'log-picker-1',
    });
    expect(sender.pickers[0].candidates).toEqual(['LS-2002', 'LS-2004']);

    const pick = inbound({
      fromPhone: PHONE_B,
      type: 'list_pick',
      providerType: 'interactive',
      contextMessageId: 'wamid.log-picker-1',
      listRowId: 'load:LS-2004',
    });
    expect(await route(pick)).toMatchObject({
      resolution: 'bid_recorded',
      routingMethod: 'load_picker',
      loadRef: 'LS-2004',
    });
    expect(actions.calls).toEqual(['rate 37000 LS-2004/partner_B']);
    expect(typed).toMatchObject({
      resolution: 'bid_recorded',
      loadRef: 'LS-2004',
      pickerMessageLogId: 'log-picker-1',
    });
  });

  it('ignores a pick that arrives after the kept value expired (G4)', async () => {
    actions.addLoad('LS-2002', 'partner_B', PHONE_B, 'awaiting_rate');
    actions.addLoad('LS-2004', 'partner_B', PHONE_B, 'awaiting_rate');
    const typed = inbound({
      fromPhone: PHONE_B,
      body: '37k',
      receivedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    });
    await route(typed);
    const pick = inbound({
      fromPhone: PHONE_B,
      type: 'list_pick',
      providerType: 'interactive',
      contextMessageId: 'wamid.log-picker-1',
      listRowId: 'load:LS-2004',
    });
    expect((await route(pick)).resolution).toBe('needs_review');
    expect(typed.resolution).toBe('needs_review');
    expect(actions.calls).toEqual([]);
  });

  it('routes a swiped rate by context.id even when other loads are open (R6)', async () => {
    actions.addLoad('LS-2001', 'partner_A', PHONE_A, 'awaiting_rate');
    actions.addLoad('LS-2003', 'partner_A', PHONE_A, 'awaiting_rate');
    const rateRequest = offerLog('LS-2003', 'partner_A', PHONE_A, 'rate_request');
    const result = await route(
      inbound({ body: '50,000', contextMessageId: rateRequest.providerMessageId }),
    );
    expect(result).toMatchObject({
      resolution: 'bid_recorded',
      routingMethod: 'context_id',
      loadRef: 'LS-2003',
    });
  });

  it('flags a value for a load in the wrong stage and does not write it', async () => {
    actions.addLoad('LS-2001', 'partner_A', PHONE_A, 'awaiting_slip');
    const dispatchRequest = offerLog('LS-2001', 'partner_A', PHONE_A, 'dispatch_request');
    const result = await route(
      inbound({ body: '45k', contextMessageId: dispatchRequest.providerMessageId }),
    );
    expect(result.resolution).toBe('needs_review');
    expect(actions.calls).toEqual([]);
  });

  it('answers unknown text with help and needs_review', async () => {
    expect((await route(inbound({ body: 'kuch bhi' }))).resolution).toBe('needs_review');
    expect(sender.infos[0]).toContain("couldn't read that");
  });

  it('flags a rate when nothing of this sender is waiting', async () => {
    expect((await route(inbound({ body: '45k' }))).resolution).toBe('needs_review');
  });
});

describe('truck/driver details and loading slips', () => {
  it('a truck number without a driver mobile is a truck value; with the mobile it is truck/driver details', async () => {
    actions.addLoad('LS-2004', 'partner_B', PHONE_B, 'awaiting_dispatch');
    // No load of B is waiting for a truck number on its own → review, nothing applied.
    expect(
      (await route(inbound({ fromPhone: PHONE_B, body: 'MH12XY9999 Suresh' }))).resolution,
    ).toBe('needs_review');
    const result = await route(
      inbound({ fromPhone: PHONE_B, body: 'MH12XY9999 Suresh 9123456780' }),
    );
    expect(result).toMatchObject({ resolution: 'details_received', loadRef: 'LS-2004' });
    expect(actions.calls).toEqual(['dispatch MH12XY9999 LS-2004/partner_B']);
    expect(sender.prompts).toEqual(['slip_request LS-2004']);
  });

  it('puts a loading slip on the only load waiting for one', async () => {
    actions.addLoad('LS-2001', 'partner_A', PHONE_A, 'awaiting_slip');
    const result = await route(
      inbound({
        type: 'image',
        providerType: 'image',
        media: { ref: 'media1', mimeType: 'image/jpeg', filename: null },
      }),
    );
    expect(result).toMatchObject({ resolution: 'slip_received', routingMethod: 'only_pending' });
    expect(actions.calls).toEqual(['slip media1 LS-2001/partner_A']);
    // The outcome had no wording of its own: it still gets a closing reply.
    expect(sender.infos).toEqual(['LS-2001: Noted.']);
  });

  // 23 Nov: the bot had asked for LOAD-1027's driver earlier ("please also send…"); then LS_N_0107
  // asked for LOAD-1029's. Plain details went to 1027 because the template didn't count as an ask.
  it('counts LS_N_0107 as an ask: two asked loads → the list, never a guess', async () => {
    actions.addLoad('LS-2007', 'partner_B', PHONE_B, 'awaiting_dispatch');
    actions.addLoad('LS-2009', 'partner_B', PHONE_B, 'awaiting_dispatch');
    offerLog('LS-2007', 'partner_B', PHONE_B, 'info').variables = { asksFor: 'dispatch' };
    offerLog('LS-2009', 'partner_B', PHONE_B, 'template').templateKey = 'LS_N_0107';

    const result = await route(
      inbound({
        fromPhone: PHONE_B,
        body: 'RJ11GC9628\nRAJIV\n6284333505\nHR3120210000616\n19 may 2000',
      }),
    );
    expect(result.resolution).toBe('awaiting_load_pick');
    expect(actions.calls).toEqual([]);
  });

  it('LS_N_0121 names the transporter by its own id: the ask is matched on the load', async () => {
    actions.addLoad('LS-2007', 'recipient_7', PHONE_B, 'awaiting_dispatch');
    actions.addLoad('LS-2009', 'recipient_9', PHONE_B, 'awaiting_dispatch');
    offerLog('LS-2009', 'transporter_master', PHONE_B, 'template').templateKey = 'LS_N_0121';

    const result = await route(
      inbound({ fromPhone: PHONE_B, body: 'RJ11GC9628 RAJIV 6284333505' }),
    );
    expect(result).toMatchObject({
      resolution: 'details_received',
      routingMethod: 'last_ask',
      loadRef: 'LS-2009',
    });
    expect(actions.calls).toEqual(['dispatch RJ11GC9628 LS-2009/recipient_9']);
  });
});

describe('Flow replies', () => {
  it('are stored but not applied yet — review', async () => {
    actions.addLoad('LS-2004', 'partner_B', PHONE_B, 'awaiting_rate');
    const result = await route(
      inbound({
        fromPhone: PHONE_B,
        type: 'flow_reply',
        providerType: 'interactive',
        flowResponse: { flow_token: 'LS-2004|partner_B|x', rate: '42000' },
      }),
    );
    expect(result.resolution).toBe('needs_review');
    expect(actions.calls).toEqual([]);
    expect(sender.infos).toEqual(['Our team will check it.']);
  });
});

it('ignores unsupported message types: a reaction silently, a voice note with a reply', async () => {
  expect((await route(inbound({ type: 'other', providerType: 'reaction' }))).resolution).toBe(
    'ignored',
  );
  expect(sender.infos).toEqual([]);
  expect((await route(inbound({ type: 'other', providerType: 'audio' }))).resolution).toBe(
    'ignored',
  );
  expect(sender.infos).toEqual(['Sorry, we can only read text and photos here.']);
});

it('answers a tap on a message sent to someone else', async () => {
  const log = offerLog('LS-2001', 'partner_A', PHONE_A);
  const result = await route(tap(log, 'accept', PHONE_B));
  expect(result.resolution).toBe('needs_review');
  expect(sender.infos).toEqual(["We couldn't match this to your loads. Our team will check it."]);
});
