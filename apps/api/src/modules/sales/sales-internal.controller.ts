import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformError } from '@commerce-platform/contracts';
import { z } from 'zod';

import { type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import { SalesService } from './application/sales.service';
import { InternalSalesCompletionGuard } from './internal-sales-completion.guard';

const completeSale = z
  .object({
    completionReferenceType: z.string().trim().min(1).max(100),
    completionReferenceId: z.string().trim().min(1).max(255),
  })
  .strict();

@ApiTags('Internal Sales')
@ApiBearerAuth('internal-bearer')
@Controller('/api/v1/internal/sales')
export class SalesInternalController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Post(':saleId/complete')
  @UseGuards(InternalSalesCompletionGuard)
  @ApiOperation({ summary: 'Trusted sale completion boundary for internal/payment callers' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async complete(
    @Req() request: AuthenticatedRequest,
    @Param('saleId') saleId: string,
    @Body() body: unknown,
  ) {
    const input = completeSale.parse(body);
    const organizationId = this.requireOrganizationId(request);
    const existing = await this.sales.getSale(organizationId, saleId);
    if (!existing) throw PlatformError.notFound('Sale not found.');
    const sale = await this.sales.completeSaleAfterPayment({
      organizationId,
      saleId,
      completionReferenceType: input.completionReferenceType,
      completionReferenceId: input.completionReferenceId,
      idempotencyKey: this.requireIdempotencyKey(request),
      actorId: 'SYSTEM:sales-internal-completion',
      correlationId: request.correlationId ?? this.requireIdempotencyKey(request),
      causationId: this.requireIdempotencyKey(request),
    });
    return { data: sale };
  }

  private requireIdempotencyKey(request: AuthenticatedRequest): string {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim()) {
      throw PlatformError.validationFailed('Idempotency-Key is required.');
    }
    return key.trim();
  }

  private requireOrganizationId(request: AuthenticatedRequest): string {
    if (
      typeof request.internalOrganizationId === 'string' &&
      request.internalOrganizationId.length > 0
    ) {
      return request.internalOrganizationId;
    }
    throw PlatformError.authenticationRequired();
  }
}
