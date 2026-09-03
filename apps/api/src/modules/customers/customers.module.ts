import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { DatabaseModule } from '../database/database.module';
import { CustomerService } from './application/customer.service';
import { CustomersContractProvider } from './application/customers-contracts.provider';
import { CUSTOMERS_CONTRACTS } from './contracts';
import { CustomersAdminController } from './customers-admin.controller';
import { CustomerRepository } from './infrastructure/customer.repository';

@Module({
  imports: [AuthModule, DatabaseModule, IdentityModule],
  controllers: [CustomersAdminController],
  providers: [
    CustomerRepository,
    CustomerService,
    CustomersContractProvider,
    { provide: CUSTOMERS_CONTRACTS, useExisting: CustomersContractProvider },
  ],
  exports: [CUSTOMERS_CONTRACTS],
})
export class CustomersModule {}
