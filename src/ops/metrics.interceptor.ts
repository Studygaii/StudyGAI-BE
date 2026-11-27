import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as crypto from 'crypto';
import { MetricsService } from './metrics.service';

/**
 * Attaches a correlation `X-Request-Id` header to every response and records
 * Prometheus request count & latency histograms automatically.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const requestId = req.headers?.['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();
    const method = req.method || 'GET';
    const rawRoute = req.route?.path || req.baseUrl || req.path || 'unknown';
    // Collapse ObjectIds/UUIDs to prevent high-cardinality Prometheus label explosion
    const route = String(rawRoute)
      .replace(/[0-9a-f]{24}/gi, ':id')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':uuid');

    const record = (statusCode: number) => {
      if (route === '/metrics' || route === '/healthz') return;
      const durationMs = Date.now() - start;
      this.metrics.incCounter('studygai_http_requests_total', {
        method,
        route,
        status: String(statusCode),
      });
      this.metrics.observeHistogram('studygai_http_request_duration_ms', durationMs, {
        method,
        route,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode || 200),
        error: (err) => record(err?.status || err?.getStatus?.() || 500),
      }),
    );
  }
}
