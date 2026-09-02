import { Inject, Injectable } from '@nestjs/common';

import type { SalesContracts } from '../contracts';
import { SalesService } from './sales.service';

@Injectable()
export class SalesContractsProvider implements SalesContracts {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  createSale(input: Parameters<SalesService['createSale']>[0]) {
    return this.sales.createSale(input);
  }

  getSale(organizationId: string, saleId: string) {
    return this.sales.getSale(organizationId, saleId);
  }

  cancelSale(input: Parameters<SalesService['cancelSale']>[0]) {
    return this.sales.cancelSale(input);
  }

  completeSaleAfterPayment(input: Parameters<SalesService['completeSaleAfterPayment']>[0]) {
    return this.sales.completeSaleAfterPayment(input);
  }
}
