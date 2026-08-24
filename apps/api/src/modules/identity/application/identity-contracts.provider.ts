import { Injectable } from '@nestjs/common';

import type { AuthorizationDecision, AuthorizeCommand, IdentityContracts } from '../contracts';
import { AuthorizationService } from './authorization.service';

/**
 * Read-model implementation of the Identity module contract
 * (docs/architecture/60-module-contracts.md "Identity & Access").
 *
 * Delegates to {@link AuthorizationService}, which composes the pure evaluator
 * with organization-scoped read models. ValidatePOSDevice is deliberately not
 * exposed: POS device identities arrive with M8 (see contracts.ts).
 */
@Injectable()
export class IdentityContractProvider implements IdentityContracts {
  constructor(private readonly authorizationService: AuthorizationService) {}

  authorize(command: AuthorizeCommand): Promise<AuthorizationDecision> {
    return this.authorizationService.authorize(command);
  }

  getEffectivePermissions(
    userId: string,
    organizationId: string,
    branchId?: string,
  ): Promise<string[]> {
    return this.authorizationService.getEffectivePermissions(userId, organizationId, branchId);
  }
}
