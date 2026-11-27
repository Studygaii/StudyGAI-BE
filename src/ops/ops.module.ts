import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { OpsController } from './ops.controller';
import { QdrantModule } from '../qdrant/qdrant.module';
import { RagModule } from '../rag/rag.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    forwardRef(() => QdrantModule),
    forwardRef(() => RagModule),
  ],
  controllers: [OpsController],
  providers: [MetricsService, MetricsInterceptor, RateLimitMiddleware],
  exports: [MetricsService, MetricsInterceptor, RateLimitMiddleware],
})
export class OpsModule {}
