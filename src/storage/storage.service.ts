import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

export type StorageDriver = 's3' | 'local';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private driver: StorageDriver;
  private localRoot: string;
  private s3Client: S3Client | null = null;
  private bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.driver = (
      this.configService.get<string>('STORAGE_DRIVER', 'local') || 'local'
    ).toLowerCase() as StorageDriver;
    this.localRoot = path.resolve(
      this.configService.get<string>('LOCAL_STORAGE_DIR', './uploads/object-store'),
    );
    this.bucket = this.configService.get<string>('S3_BUCKET', 'studygai-sources');

    if (this.driver === 's3') {
      const endpoint = this.configService.get<string>('S3_ENDPOINT');
      const region = this.configService.get<string>('S3_REGION', 'us-east-1');
      const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY_ID', 'minioadmin');
      const secretAccessKey = this.configService.get<string>('S3_SECRET_ACCESS_KEY', 'minioadmin');
      const forcePathStyle =
        this.configService.get<string>('S3_FORCE_PATH_STYLE', 'true').toLowerCase() !== 'false';

      this.s3Client = new S3Client({
        region,
        ...(endpoint ? { endpoint } : {}),
        forcePathStyle,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.driver === 's3' && this.s3Client) {
      try {
        await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`S3 bucket "${this.bucket}" verified`);
      } catch (err: any) {
        if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
          try {
            await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
            this.logger.log(`Created S3 bucket "${this.bucket}"`);
          } catch (createErr: any) {
            this.logger.warn(
              `Could not create S3 bucket "${this.bucket}" (${createErr.message}); falling back to local storage`,
            );
            this.driver = 'local';
          }
        } else {
          this.logger.warn(
            `S3 unreachable at startup (${err.message}); falling back to local storage`,
          );
          this.driver = 'local';
        }
      }
    }

    if (this.driver === 'local') {
      fs.mkdirSync(this.localRoot, { recursive: true });
      this.logger.log(`Local content-sharded storage active at ${this.localRoot}`);
    }
  }

  getDriver(): StorageDriver {
    return this.driver;
  }

  /** Compute deterministic SHA-256 hex digest of a Buffer or string */
  sha256(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /** Build a 2-level content-sharded key to avoid filesystem/prefix hotspots at 100M+ scale */
  buildBlobKey(sha256: string, kind: 'raw' | 'markdown' | 'vectors', ext = ''): string {
    const p1 = sha256.slice(0, 2);
    const p2 = sha256.slice(2, 4);
    const cleanExt = ext ? (ext.startsWith('.') ? ext : `.${ext}`) : '';
    if (kind === 'raw') return `blobs/raw/${p1}/${p2}/${sha256}${cleanExt}`;
    if (kind === 'vectors') return `blobs/vectors/${p1}/${p2}/${sha256}.jsonl.gz`;
    return `blobs/md/${p1}/${p2}/${sha256}.md`;
  }

  async putObject(key: string, body: Buffer | string, contentType = 'application/octet-stream'): Promise<string> {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');

    if (this.driver === 's3' && this.s3Client) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buf,
          ContentType: contentType,
        }),
      );
      return key;
    }

    const fullPath = this.resolveLocalPath(key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buf);
    return key;
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    if (this.driver === 's3' && this.s3Client) {
      const resp = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = resp.Body;
      if (!body) throw new Error(`Empty object body for key ${key}`);
      if (typeof (body as any).transformToByteArray === 'function') {
        const bytes = await (body as any).transformToByteArray();
        return Buffer.from(bytes);
      }
      return this.streamToBuffer(body as Readable);
    }

    const fullPath = this.resolveLocalPath(key);
    return fs.promises.readFile(fullPath);
  }

  async getObjectText(key: string): Promise<string> {
    const buf = await this.getObjectBuffer(key);
    return buf.toString('utf8');
  }

  async exists(key: string): Promise<boolean> {
    if (this.driver === 's3' && this.s3Client) {
      try {
        await this.s3Client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    }
    return fs.existsSync(this.resolveLocalPath(key));
  }

  async deleteObject(key: string): Promise<void> {
    if (!key) return;
    if (this.driver === 's3' && this.s3Client) {
      try {
        await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      } catch (err: any) {
        this.logger.warn(`S3 delete warning for ${key}: ${err.message}`);
      }
      return;
    }

    const fullPath = this.resolveLocalPath(key);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath).catch(() => undefined);
    }
  }

  /**
   * Generate a presigned S3/R2/MinIO PUT URL so clients upload directly to object storage
   * without buffering large textbooks through stateless NestJS API pods.
   */
  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 900,
  ): Promise<{ url: string; method: 'PUT'; headers: Record<string, string>; driver: StorageDriver }> {
    if (this.driver === 's3' && this.s3Client) {
      const cmd = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      });
      const url = await getSignedUrl(this.s3Client, cmd, { expiresIn: expiresInSeconds });
      return {
        url,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        driver: 's3',
      };
    }

    // In local dev without S3, callers should use multipart /api/v1/sources/course/:courseId/upload
    return {
      url: '',
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      driver: 'local',
    };
  }

  private resolveLocalPath(key: string): string {
    // Prevent path traversal
    const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = path.resolve(this.localRoot, normalized);
    if (!full.startsWith(this.localRoot)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}
