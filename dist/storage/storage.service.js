"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var StorageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let StorageService = StorageService_1 = class StorageService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(StorageService_1.name);
        this.s3Client = null;
        this.driver = (this.configService.get('STORAGE_DRIVER', 'local') || 'local').toLowerCase();
        this.localRoot = path.resolve(this.configService.get('LOCAL_STORAGE_DIR', './uploads/object-store'));
        this.bucket = this.configService.get('S3_BUCKET', 'studygai-sources');
        if (this.driver === 's3') {
            const endpoint = this.configService.get('S3_ENDPOINT');
            const region = this.configService.get('S3_REGION', 'us-east-1');
            const accessKeyId = this.configService.get('S3_ACCESS_KEY_ID', 'minioadmin');
            const secretAccessKey = this.configService.get('S3_SECRET_ACCESS_KEY', 'minioadmin');
            const forcePathStyle = this.configService.get('S3_FORCE_PATH_STYLE', 'true').toLowerCase() !== 'false';
            this.s3Client = new client_s3_1.S3Client({
                region,
                ...(endpoint ? { endpoint } : {}),
                forcePathStyle,
                credentials: { accessKeyId, secretAccessKey },
            });
        }
    }
    async onModuleInit() {
        if (this.driver === 's3' && this.s3Client) {
            try {
                await this.s3Client.send(new client_s3_1.HeadBucketCommand({ Bucket: this.bucket }));
                this.logger.log(`S3 bucket "${this.bucket}" verified`);
            }
            catch (err) {
                if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
                    try {
                        await this.s3Client.send(new client_s3_1.CreateBucketCommand({ Bucket: this.bucket }));
                        this.logger.log(`Created S3 bucket "${this.bucket}"`);
                    }
                    catch (createErr) {
                        this.logger.warn(`Could not create S3 bucket "${this.bucket}" (${createErr.message}); falling back to local storage`);
                        this.driver = 'local';
                    }
                }
                else {
                    this.logger.warn(`S3 unreachable at startup (${err.message}); falling back to local storage`);
                    this.driver = 'local';
                }
            }
        }
        if (this.driver === 'local') {
            fs.mkdirSync(this.localRoot, { recursive: true });
            this.logger.log(`Local content-sharded storage active at ${this.localRoot}`);
        }
    }
    getDriver() {
        return this.driver;
    }
    /** Compute deterministic SHA-256 hex digest of a Buffer or string */
    sha256(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
    /** Build a 2-level content-sharded key to avoid filesystem/prefix hotspots at 100M+ scale */
    buildBlobKey(sha256, kind, ext = '') {
        const p1 = sha256.slice(0, 2);
        const p2 = sha256.slice(2, 4);
        const cleanExt = ext ? (ext.startsWith('.') ? ext : `.${ext}`) : '';
        if (kind === 'raw')
            return `blobs/raw/${p1}/${p2}/${sha256}${cleanExt}`;
        if (kind === 'vectors')
            return `blobs/vectors/${p1}/${p2}/${sha256}.jsonl.gz`;
        return `blobs/md/${p1}/${p2}/${sha256}.md`;
    }
    async putObject(key, body, contentType = 'application/octet-stream') {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
        if (this.driver === 's3' && this.s3Client) {
            await this.s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buf,
                ContentType: contentType,
            }));
            return key;
        }
        const fullPath = this.resolveLocalPath(key);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, buf);
        return key;
    }
    async getObjectBuffer(key) {
        if (this.driver === 's3' && this.s3Client) {
            const resp = await this.s3Client.send(new client_s3_1.GetObjectCommand({ Bucket: this.bucket, Key: key }));
            const body = resp.Body;
            if (!body)
                throw new Error(`Empty object body for key ${key}`);
            if (typeof body.transformToByteArray === 'function') {
                const bytes = await body.transformToByteArray();
                return Buffer.from(bytes);
            }
            return this.streamToBuffer(body);
        }
        const fullPath = this.resolveLocalPath(key);
        return fs.promises.readFile(fullPath);
    }
    async getObjectText(key) {
        const buf = await this.getObjectBuffer(key);
        return buf.toString('utf8');
    }
    async exists(key) {
        if (this.driver === 's3' && this.s3Client) {
            try {
                await this.s3Client.send(new client_s3_1.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
                return true;
            }
            catch {
                return false;
            }
        }
        return fs.existsSync(this.resolveLocalPath(key));
    }
    async deleteObject(key) {
        if (!key)
            return;
        if (this.driver === 's3' && this.s3Client) {
            try {
                await this.s3Client.send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
            }
            catch (err) {
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
    async getPresignedUploadUrl(key, contentType, expiresInSeconds = 900) {
        if (this.driver === 's3' && this.s3Client) {
            const cmd = new client_s3_1.PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                ContentType: contentType,
            });
            const url = await (0, s3_request_presigner_1.getSignedUrl)(this.s3Client, cmd, { expiresIn: expiresInSeconds });
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
    resolveLocalPath(key) {
        // Prevent path traversal
        const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
        const full = path.resolve(this.localRoot, normalized);
        if (!full.startsWith(this.localRoot)) {
            throw new Error(`Invalid storage key: ${key}`);
        }
        return full;
    }
    streamToBuffer(stream) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    }
};
exports.StorageService = StorageService;
exports.StorageService = StorageService = StorageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], StorageService);
//# sourceMappingURL=storage.service.js.map