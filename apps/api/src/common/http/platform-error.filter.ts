import { Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { isPlatformError, PlatformError } from '@commerce-platform/contracts';
import { ZodError } from 'zod';
import { correlationIdFor, type RequestWithCorrelation } from './correlation';

@Catch()
export class PlatformErrorFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithCorrelation>();
    const reply = context.getResponse<{ code(status: number): { send(body: unknown): void } }>();
    const correlationId = correlationIdFor(request);
    const error = isPlatformError(exception)
      ? exception
      : exception instanceof HttpException || exception instanceof ZodError
        ? PlatformError.validationFailed('Request validation failed.')
        : PlatformError.of('OPERATION_NOT_ALLOWED', 'An unexpected error occurred.');
    reply.code(error.httpStatus).send({ error: { ...error.toApiError(), correlationId } });
  }
}
