import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PricingContractProvider } from './application/pricing-contracts.provider';
import { PricingService } from './application/pricing.service';
import { PRICING_CONTRACTS } from './contracts';
import { PricingRepository } from './infrastructure/pricing.repository';

/**
 * Nest wiring of the Pricing bounded context.
 *
 * Other context modules consume the exported {@link PRICING_CONTRACTS} provider
 * (docs/architecture/60-module-contracts.md) — never this module's
 * repository or tables.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    PricingRepository,
    PricingService,
    PricingContractProvider,
    {
      provide: PRICING_CONTRACTS,
      useExisting: PricingContractProvider,
    },
  ],
  exports: [PRICING_CONTRACTS, PricingService, PricingRepository],
})
export class PricingModule {}
