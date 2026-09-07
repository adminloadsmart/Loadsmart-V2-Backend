import { Msg91Client } from '../../../adapters/msg91.client';
import { NotificationEntity } from '../notifications.entity';
import { NotificationChannel } from './notification-channel.interface';

export class SmsChannel implements NotificationChannel {
  constructor(private readonly msg91Client: Msg91Client) {}

  async send(notification: NotificationEntity, destination: string): Promise<void> {
    await this.msg91Client.sendTransactional(destination, {
      title: notification.title,
      body: notification.body,
    });
  }
}
