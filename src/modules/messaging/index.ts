import { Router } from 'express';
import { Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { env } from '../../config/env';
import { redisManager } from '../../db/redis';
import { createJobQueue } from '../../jobs/queue-registry';
import {
  BIDS_ROLLUP_JOB,
  BIDS_ROLLUP_JOB_ID_PREFIX,
  MESSAGING_QUEUES,
} from './messaging.constants';
import { WhatsappProviderName } from './messaging.types';
import { WhatsappProvider } from './providers/whatsapp-provider.interface';
import { Msg91WhatsappProvider } from './providers/msg91/msg91-whatsapp.provider';
import { Msg91WebhookParser } from './providers/msg91/msg91-webhook.parser';
import { Msg91Client } from '../../adapters/msg91.client';
import { OutboundMessageService } from './outbound/outbound-message.service';
import { RepositoryOutboundMessageStore } from './outbound/outbound-message-store';
import { WhatsappReplySender } from './outbound/whatsapp-reply-sender';
import { createInterimContactConsent } from './outbound/contact-consent';
import { TypeormLoadChannelFacts } from './load-channel-facts';
import { MessageLogNotificationSentLog } from './sent-log/notification-sent-log';
import { MessageLogQueryService } from './sent-log/message-log-query.service';
import { RepositorySentLogStore, TypeormSentLogLoadLookup } from './sent-log/sent-log.store';
import { SentLogController } from './sent-log/sent-log.controller';
import { createOpsSentLogRoutes, createShipperSentLogRoutes } from './sent-log/sent-log.routes';
import { createWhatsappOutboundWorker } from './workers/whatsapp-outbound.worker';
import { MessageLogRepository } from './repositories/message-log.repository';
import { WhatsappInboundRepository } from './repositories/whatsapp-inbound.repository';
import { InboundPipelineService, routerNotWiredHandler } from './inbound/inbound-pipeline.service';
import { RedisSenderLock } from './inbound/redis-sender-lock';
import { WebhookBodyListener, WhatsappWebhookController } from './whatsapp-webhook.controller';
import { createWhatsappWebhookRoutes } from './messaging.routes';
import { createWhatsappInboundWorker } from './workers/whatsapp-inbound.worker';
import { WhatsappReplyRouter } from './router/whatsapp-reply.router';
import { RepositoryRouterMessageStore } from './router/router-message-store';
import { ReplyActions, ReplySender } from './router/reply-router.ports';
import { WhatsappDispatchNotifier } from './integration/whatsapp-dispatch-notifier';
import { TypeormShipperNames } from './integration/shipper-names';
import {
  TransporterBidWriter,
  TransporterDriverWriter,
  TransporterReplyActions,
} from './integration/transporter-reply-actions';
import { TypeormTransporterOfferStore } from './integration/transporter-load-store';
import { CompositeReplyActions } from './integration/composite-reply-actions';
import { PartnerBoardGateway, PartnerReplyActions } from './integration/partner-reply-actions';
import { PartnerBoardNotifier } from './integration/partner-board-notifier';
import { LoadRecipientStatusListener } from './integration/load-recipient-status.listener';
import { LoadPartyWhatsapp } from './integration/load-party-whatsapp';
import { FileLinker, MemoGateway, ShipperBidGateway } from './integration/load-notices.interface';
import { TypeormLoadNoticeStore } from './integration/load-notice-store';
import { ShipperReplyActions, TypeormShipperLoadStore } from './integration/shipper-reply-actions';
import {
  createWhatsappScheduleWorker,
  scheduleWhatsappFollowUps,
} from './workers/whatsapp-schedule.worker';
import { LoadEventNotifier } from '../notifications/notifications.interface';
import { LoadPartyNotifier } from '../loads/utils/load-party-notifier.interface';
import { SettingsReader } from '../settings/settings.types';

export interface MessagingModule {
  provider: WhatsappProviderName;
  /** POST /v1/webhooks/msg91/whatsapp?token=… — MSG91's inbound messages and delivery reports. */
  webhookRouter: Router;
  /** Another consumer of every MSG91 WhatsApp webhook body (the driver invite's reports). */
  addWebhookBodyListener(listener: WebhookBodyListener): void;
  inboundWorker: Worker;
  outboundWorker: Worker;
  pipeline: InboundPipelineService;
  /** Sends templates / session messages / offers (logged in message_log first). */
  outbound: OutboundMessageService;
  /** The router's sender (replies, next questions, "Load chunein"). */
  replySender: WhatsappReplySender;
  /** Load notifications to shipper users, mirrored into message_log (notify-by-type's sentLog). */
  notificationSentLog: MessageLogNotificationSentLog;
  /** GET /loads/:loadId/messages for the shipper — mount inside the loads router. */
  shipperSentLogRouter: Router;
  /** GET /loads/:loadId/messages and /whatsapp for Loadsmart's teams — mount at /loadsmart-ops. */
  opsSentLogRouter: Router;
  /** Posts loads to transporters on WhatsApp (replaces LoggingLoadDispatchNotifier). */
  dispatchNotifier: WhatsappDispatchNotifier;
  /** Turns the reply router on, over the transporter bid / indent services, Loadsmart's board and
   *  the load memo (Accept memo on WhatsApp). */
  connectReplies(services: {
    transporterBids: TransporterBidWriter;
    /** Names the driver from a transporter's reply to LS_N_0121 (LoadMemoService). */
    transporterDrivers: TransporterDriverWriter;
    partnerBoard: PartnerBoardGateway;
    memos: MemoGateway;
    shipperBids: ShipperBidGateway;
  }): void;
  /** The load-flow WhatsApp notices (memo, confirmations, papers, payments, original POD). */
  createLoadNotices(deps: { settings: SettingsReader; linkFile: FileLinker }): LoadNotices;
  /** Sends loads posted on Loadsmart's board to the partners on their lane
   *  (LsSourcingService.setLoadBoardNotifier). */
  createPartnerBoardNotifier(): PartnerBoardNotifier;
}

/** MSG91 sends when MSG91_AUTH_KEY and MSG91_WHATSAPP_INTEGRATED_NUMBER are set; otherwise every
 *  message is still logged, as suppressed (provider_not_configured). */
function createProvider(): WhatsappProvider | null {
  if (env.msg91AuthKey && env.msg91WhatsappIntegratedNumber) {
    return new Msg91WhatsappProvider(new Msg91Client());
  }
  console.warn(
    '[messaging] MSG91_AUTH_KEY / MSG91_WHATSAPP_INTEGRATED_NUMBER unset — WhatsApp messages will be logged as suppressed',
  );
  return null;
}

/**
 * The reply router over the messaging tables. It replaces routerNotWiredHandler once the outbound
 * side (ReplySender, Part 4) and the business side (ReplyActions, Part 5) exist.
 */
export function createWhatsappReplyRouter(
  dataSource: DataSource,
  actions: ReplyActions,
  sender: ReplySender,
): WhatsappReplyRouter {
  const store = new RepositoryRouterMessageStore(
    new MessageLogRepository(dataSource),
    new WhatsappInboundRepository(dataSource),
  );
  return new WhatsappReplyRouter(store, actions, sender, {});
}

/** What the load notices plug into: the load-event notifier, the services' party notifier, and
 *  the daily original POD follow-up (its worker and schedule). */
export interface LoadNotices {
  onLoadEvent: LoadEventNotifier;
  notify: LoadPartyNotifier;
  worker: Worker;
  /** Registers the daily follow-up schedule (idempotent). */
  schedule(): Promise<void>;
}

export function createMessagingModule(dataSource: DataSource): MessagingModule {
  const provider: WhatsappProviderName = 'msg91';
  if (!env.msg91WebhookToken) {
    console.warn(
      '[messaging] MSG91_WEBHOOK_TOKEN unset — MSG91 WhatsApp webhook calls will be rejected',
    );
  }
  const pipeline = new InboundPipelineService(
    new WhatsappInboundRepository(dataSource),
    new MessageLogRepository(dataSource),
    createJobQueue(MESSAGING_QUEUES.inbound),
    new RedisSenderLock(redisManager),
    routerNotWiredHandler,
  );
  pipeline.addStatusListener(new LoadRecipientStatusListener(dataSource));
  const messageLogRepository = new MessageLogRepository(dataSource);
  const inboundRepository = new WhatsappInboundRepository(dataSource);
  const outbound = new OutboundMessageService(
    new RepositoryOutboundMessageStore(messageLogRepository, inboundRepository),
    createJobQueue(MESSAGING_QUEUES.outbound),
    createInterimContactConsent(),
    {
      provider: createProvider(),
      providerName: provider,
      templateNames: env.msg91WhatsappLoadTemplateNames,
      templateLanguage: env.whatsappTemplateLanguage,
      loadFacts: new TypeormLoadChannelFacts(dataSource),
    },
  );
  const replySender = new WhatsappReplySender(outbound);
  const webhookController = new WhatsappWebhookController(
    new Msg91WebhookParser({ token: env.msg91WebhookToken }),
    pipeline,
  );
  const sentLogController = new SentLogController(
    new MessageLogQueryService(
      new RepositorySentLogStore(messageLogRepository, inboundRepository),
      new TypeormSentLogLoadLookup(dataSource),
    ),
  );
  return {
    provider,
    webhookRouter: createWhatsappWebhookRoutes(webhookController),
    addWebhookBodyListener: (listener) => webhookController.addBodyListener(listener),
    notificationSentLog: new MessageLogNotificationSentLog(messageLogRepository),
    shipperSentLogRouter: createShipperSentLogRoutes(sentLogController),
    opsSentLogRouter: createOpsSentLogRoutes(sentLogController),
    dispatchNotifier: new WhatsappDispatchNotifier(outbound, new TypeormShipperNames(dataSource)),
    connectReplies({ transporterBids, transporterDrivers, partnerBoard, memos, shipperBids }) {
      const actions = new CompositeReplyActions({
        transporter: new TransporterReplyActions(
          new TypeormTransporterOfferStore(dataSource, inboundRepository),
          transporterBids,
          transporterDrivers,
        ),
        partner: new PartnerReplyActions(partnerBoard, {
          latestOfferAnswer: (loadId, partnerId) =>
            inboundRepository.findLatestOfferAnswer(loadId, partnerId),
        }),
        shipper_user: new ShipperReplyActions(
          new TypeormShipperLoadStore(dataSource),
          memos,
          shipperBids,
        ),
      });
      pipeline.useHandler(createWhatsappReplyRouter(dataSource, actions, replySender));
    },
    createPartnerBoardNotifier() {
      return new PartnerBoardNotifier(outbound);
    },
    createLoadNotices({ settings, linkFile }) {
      const schedules = createJobQueue(MESSAGING_QUEUES.schedules);
      const notices = new LoadPartyWhatsapp(
        new TypeormLoadNoticeStore(dataSource),
        outbound,
        settings,
        linkFile,
        (job, delayMs) =>
          schedules.enqueue(BIDS_ROLLUP_JOB, job, {
            delay: delayMs,
            jobId: `${BIDS_ROLLUP_JOB_ID_PREFIX}${job.loadId}`,
          }),
      );
      return {
        onLoadEvent: notices.onLoadEvent,
        notify: notices.notify,
        worker: createWhatsappScheduleWorker(notices),
        schedule: () => scheduleWhatsappFollowUps(schedules),
      };
    },
    inboundWorker: createWhatsappInboundWorker(pipeline),
    outboundWorker: createWhatsappOutboundWorker(outbound),
    pipeline,
    outbound,
    replySender,
  };
}
