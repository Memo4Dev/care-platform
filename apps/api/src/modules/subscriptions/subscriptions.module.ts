import { Module } from '@nestjs/common';
import {
  SUBSCRIPTION_STATUS,
  type SubscriptionStatusContract,
} from '../../common/contracts/subscription-status';
import { DatabaseModule } from '../database/database.module';
import { DATABASE } from '../database/database.tokens';
import { SubscriptionService } from './application/subscription.service';
import { SubscriptionRepository } from './infrastructure/subscription.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    SubscriptionRepository,
    SubscriptionService,
    {
      provide: SUBSCRIPTION_STATUS,
      useFactory: (
        repository: SubscriptionRepository,
        db: import('@commerce-platform/database').DatabaseClient,
      ): SubscriptionStatusContract => ({
        getActiveSubscription: async (organizationId) =>
          repository.findBusinessAccess(db, organizationId),
      }),
      inject: [SubscriptionRepository, DATABASE],
    },
  ],
  exports: [SubscriptionService, SUBSCRIPTION_STATUS],
})
export class SubscriptionsModule {}
