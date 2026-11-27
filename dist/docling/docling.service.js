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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var DoclingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoclingService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const fs = __importStar(require("fs"));
const form_data_1 = __importDefault(require("form-data"));
const axios_1 = __importDefault(require("axios"));
let DoclingService = DoclingService_1 = class DoclingService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(DoclingService_1.name);
        this.maxRetries = 3;
        this.retryDelay = 1000; // ms
        this.doclingUrl = this.configService.get('DOCLING_SERVICE_URL', 'http://localhost:5000');
        this.axiosInstance = axios_1.default.create({
            baseURL: this.doclingUrl,
            timeout: 120000, // 2 minute timeout for large PDFs
        });
        this.logger.log(`Docling service configured at: ${this.doclingUrl}`);
    }
    /**
     * Convert PDF file to markdown using Docling service
     * @param filePath - Path to the PDF file
     * @returns Markdown string
     */
    async convertPdfToMarkdown(filePath) {
        try {
            // Validate file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`PDF file not found: ${filePath}`);
            }
            // Get file size
            const fileStats = fs.statSync(filePath);
            this.logger.log(`Converting PDF to markdown: ${filePath} (${fileStats.size} bytes)`);
            // Retry logic
            let lastError = null;
            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    const formData = this.createFormData(filePath);
                    const response = await this.axiosInstance.post('/convert-pdf', formData, {
                        headers: formData.getHeaders(),
                    });
                    if (response.data.status === 'success' && response.data.markdown) {
                        this.logger.log(`Successfully converted PDF to ${response.data.char_count} characters`);
                        return response.data.markdown;
                    }
                    else {
                        throw new Error(response.data.error || 'Unknown conversion error');
                    }
                }
                catch (error) {
                    lastError = error;
                    if (attempt < this.maxRetries) {
                        const delay = this.retryDelay * attempt;
                        this.logger.warn(`Conversion attempt ${attempt} failed. Retrying in ${delay}ms: ${lastError.message}`);
                        await this.delay(delay);
                    }
                }
            }
            throw lastError || new Error('Failed to convert PDF after max retries');
        }
        catch (error) {
            this.logger.error(`Docling conversion failed for ${filePath}: ${error.message}`);
            throw new Error(`PDF conversion failed: ${error.message}`);
        }
    }
    /**
     * Convert PDF and return markdown + structured JSON (figures, math, tables)
     */
    async convertPdfRich(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`PDF file not found: ${filePath}`);
        }
        return this.convertFileRich(filePath, '/convert-pdf');
    }
    /**
     * Convert image (PNG, JPG, JPEG, WEBP) to text using OCR.
     */
    async convertImageToText(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Image file not found: ${filePath}`);
        }
        const fileStats = fs.statSync(filePath);
        this.logger.log(`Converting image to text via OCR: ${filePath} (${fileStats.size} bytes)`);
        const formData = this.createFormData(filePath);
        const response = await this.axiosInstance.post('/convert-image', formData, { headers: formData.getHeaders() });
        if (response.data.status === 'success' && response.data.markdown) {
            this.logger.log(`OCR extraction successful: ${response.data.char_count} characters`);
            return response.data.markdown;
        }
        throw new Error(response.data.error || 'Unknown image conversion error');
    }
    /**
     * Convert DOCX or PDF with endpoint selection.
     */
    async convertFileRich(filePath, endpoint = '/convert-pdf') {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const fileStats = fs.statSync(filePath);
        this.logger.log(`Converting (${endpoint}) to markdown/json: ${filePath} (${fileStats.size} bytes)`);
        let lastError = null;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const formData = this.createFormData(filePath);
                const response = await this.axiosInstance.post(endpoint, formData, { headers: formData.getHeaders() });
                if (response.data.status === 'success' && response.data.markdown) {
                    return {
                        markdown: response.data.markdown,
                        json: response.data.json,
                        charCount: response.data.char_count,
                        pageCount: response.data.page_count,
                    };
                }
                throw new Error(response.data.error || 'Unknown conversion error');
            }
            catch (error) {
                lastError = error;
                if (attempt < this.maxRetries) {
                    const delay = this.retryDelay * attempt;
                    this.logger.warn(`Rich conversion attempt ${attempt} failed. Retrying in ${delay}ms: ${lastError.message}`);
                    await this.delay(delay);
                }
            }
        }
        throw lastError || new Error('Failed to convert file after max retries');
    }
    /**
     * Health check for Docling service
     * @returns true if service is healthy
     */
    async healthCheck() {
        try {
            const response = await this.axiosInstance.get('/health', {
                timeout: 5000,
            });
            const isHealthy = response.data?.status === 'ok';
            if (isHealthy) {
                this.logger.debug('Docling service health check passed');
            }
            else {
                this.logger.warn('Docling service health check returned unexpected status');
            }
            return isHealthy;
        }
        catch (error) {
            this.logger.error(`Docling health check failed: ${error.message}`);
            return false;
        }
    }
    /**
     * Get service info
     */
    async getServiceInfo() {
        try {
            const response = await this.axiosInstance.get('/info');
            return response.data;
        }
        catch (error) {
            this.logger.error(`Failed to get service info: ${error.message}`);
            throw error;
        }
    }
    /**
     * Delay helper for retries
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Create form data for a file (fresh stream per attempt)
     */
    createFormData(filePath) {
        const formData = new form_data_1.default();
        const fileStream = fs.createReadStream(filePath);
        formData.append('file', fileStream, { filename: filePath });
        return formData;
    }
};
exports.DoclingService = DoclingService;
exports.DoclingService = DoclingService = DoclingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], DoclingService);
//# sourceMappingURL=docling.service.js.map