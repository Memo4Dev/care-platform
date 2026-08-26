import {
  newId,
  type DatabaseClient,
  type PolicyType,
  type PolicyValue,
} from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import { Organization } from '../domain/organization';
import { isPolicyType } from '../domain/policy';
import { OrganizationRepository } from '../infrastructure/organization.repository';
import type { DbExecutor } from '../infrastructure/db-executor';

/**
 * Application service of the Organization context: one method per domain
 * command (docs/architecture/10-organization.md), each executed inside a
 * single database transaction that loads the aggregate, applies the command
 * and saves aggregate changes + domain events (transactional outbox).
 *
 * The eight SetXPolicy commands from the architecture doc map to the single
 * typed {@link setPolicy} command — see domain/policy.ts for the rationale.
 *
 * Authentication, authorization and entitlement checks are intentionally NOT
 * part of this service yet; they arrive with the HTTP/API layer tasks.
 */
@Injectable()
export class OrganizationService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(OrganizationRepository) private readonly repository: OrganizationRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Organization lifecycle
  // ---------------------------------------------------------------------------

  async createOrganization(command: {
    name: string;
    /** Optional client-supplied UUIDv7 id; a fresh one is generated otherwise. */
    organizationId?: string;
  }): Promise<OrganizationCommandResult> {
    const organizationId = command.organizationId ?? newId();
    const aggregate = Organization.create({ id: organizationId, name: command.name });

    return this.db.transaction(async (tx) => {
      const eventsPersisted = await this.repository.save(tx, aggregate);
      return toResult(aggregate, eventsPersisted);
    });
  }

  async activateOrganization(command: {
    organizationId: string;
  }): Promise<OrganizationCommandResult> {
    return this.execute(command.organizationId, (organization) => {
      organization.activate();
    });
  }

  async suspendOrganization(command: {
    organizationId: string;
  }): Promise<OrganizationCommandResult> {
    return this.execute(command.organizationId, (organization) => {
      organization.suspend();
    });
  }

  // ---------------------------------------------------------------------------
  // Branches
  // ---------------------------------------------------------------------------

  async createBranch(command: {
    organizationId: string;
    branchId?: string;
    code: string;
    name: string;
    priority?: number;
  }): Promise<OrganizationCommandResult> {
    return this.execute(command.organizationId, (organization) => {
      organization.createBranch({
        id: command.branchId ?? newId(),
        code: command.code,
        name: command.name,
        priority: command.priority,
      });
    });
  }

  /** Used only by the local HTTP command adapter's encompassing transaction. */
  async createBranchInTransaction(
    tx: DbExecutor,
    command: {
      organizationId: string;
      branchId?: string;
      code: string;
      name: string;
      priority?: number;
    },
  ): Promise<OrganizationCommandResult> {
    return this.executeInTransaction(tx, command.organizationId, (organization) => {
      organization.createBranch({
        id: command.branchId ?? newId(),
        code: command.code,
        name: command.name,
        priority: command.priority,
      });
    });
  }

  async changeBranchPriority(command: {
    organizationId: string;
    branchId: string;
    priority: number;
  }): Promise<OrganizationCommandResult> {
    return this.execute(command.organizationId, (organization) => {
      organization.changeBranchPriority({
        branchId: command.branchId,
        priority: command.priority,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Warehouses
  // ---------------------------------------------------------------------------

  async createWarehouse(command: {
    organizationId: string;
    warehouseId?: string;
    branchId: string;
    code: string;
    name: string;
  }): Promise<OrganizationCommandResult> {
    return this.execute(command.organizationId, (organization) => {
      organization.createWarehouse({
        id: command.warehouseId ?? newId(),
        branchId: command.branchId,
        code: command.code,
        name: command.name,
      });
    });
  }

  /** Used only by the local HTTP command adapter's encompassing transaction. */
  async createWarehouseInTransaction(
    tx: DbExecutor,
    command: {
      organizationId: string;
      warehouseId?: string;
      branchId: string;
      code: string;
      name: string;
    },
  ): Promise<OrganizationCommandResult> {
    return this.executeInTransaction(tx, command.organizationId, (organization) => {
      organization.createWarehouse({
        id: command.warehouseId ?? newId(),
        branchId: command.branchId,
        code: command.code,
        name: command.name,
      });
    });
  }

  async deactivateWarehouse(command: {
    organizationId: string;
    warehouseId: string;
  }): Promise<OrganizationCommandResult> {
    return this.execute(command.organizationId, (organization) => {
      organization.deactivateWarehouse({ warehouseId: command.warehouseId });
    });
  }

  // ---------------------------------------------------------------------------
  // Policies
  // ---------------------------------------------------------------------------

  /**
   * Unified SetPolicy command covering RETURN / REFUND / PURCHASE /
   * ORDER_APPROVAL / OFFLINE / CREDIT / DELIVERY / INVENTORY. Every call
   * appends one immutable policy-history row with the next per-organization
   * monotonic version.
   */
  async setPolicy(command: {
    organizationId: string;
    policyType: PolicyType;
    value: PolicyValue;
  }): Promise<OrganizationCommandResult> {
    if (!isPolicyType(command.policyType)) {
      throw PlatformError.validationFailed(
        `Unknown organization policy type "${String(command.policyType)}".`,
        { details: { field: 'policyType' } },
      );
    }

    return this.execute(command.organizationId, (organization) => {
      organization.setPolicy({ policyType: command.policyType, value: command.value });
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async execute(
    organizationId: string,
    command: (organization: Organization) => void,
  ): Promise<OrganizationCommandResult> {
    return this.db.transaction((tx) => this.executeInTransaction(tx, organizationId, command));
  }

  async executeInTransaction(
    tx: DbExecutor,
    organizationId: string,
    command: (organization: Organization) => void,
  ): Promise<OrganizationCommandResult> {
    const organization = await this.repository.findOrganization(tx, organizationId);
    if (!organization) {
      throw PlatformError.notFound(`Organization ${organizationId} was not found.`, {
        details: { organizationId },
      });
    }
    command(organization);
    const eventsPersisted = await this.repository.save(tx, organization);
    return toResult(organization, eventsPersisted);
  }
}

/** Plain snapshot of an organization after a command completed. */
export interface OrganizationSnapshot {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  /** Persisted version after the command's save. */
  version: number;
}

export interface OrganizationCommandResult {
  organization: OrganizationSnapshot;
  /** Number of domain events appended to the integration outbox. */
  eventsPersisted: number;
}

function toResult(organization: Organization, eventsPersisted: number): OrganizationCommandResult {
  return {
    organization: {
      id: organization.id,
      name: organization.name,
      status: organization.status,
      version: organization.version,
    },
    eventsPersisted,
  };
}
