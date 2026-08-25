import { newCorrelationId } from '@commerce-platform/contracts';

export const CORRELATION_ID = 'correlationId';
export interface RequestWithCorrelation {
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
}

export function correlationIdFor(request: RequestWithCorrelation): string {
  return request.correlationId ?? newCorrelationId();
}
