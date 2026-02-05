import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import FormData from 'form-data';
import axios, { AxiosInstance } from 'axios';

interface ConversionResponse {
  status: string;
  markdown?: string;
  json?: any;
  filename?: string;
  char_count?: number;
  page_count?: number;
  error?: string;
}

@Injectable()
export class DoclingService {
  private readonly logger = new Logger(DoclingService.name);
  private doclingUrl: string;
  private axiosInstance: AxiosInstance;
  private maxRetries = 3;
  private retryDelay = 1000; // ms

  constructor(private configService: ConfigService) {
    this.doclingUrl = this.configService.get<string>(
      'DOCLING_SERVICE_URL',
      'http://localhost:5000',
    );

    this.axiosInstance = axios.create({
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
  async convertPdfToMarkdown(filePath: string): Promise<string> {
    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`PDF file not found: ${filePath}`);
      }

      // Get file size
      const fileStats = fs.statSync(filePath);
      this.logger.log(
        `Converting PDF to markdown: ${filePath} (${fileStats.size} bytes)`,
      );

      // Retry logic
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const formData = this.createFormData(filePath);
          const response = await this.axiosInstance.post<ConversionResponse>(
            '/convert-pdf',
            formData,
            {
              headers: formData.getHeaders(),
            },
          );

          if (response.data.status === 'success' && response.data.markdown) {
            this.logger.log(
              `Successfully converted PDF to ${response.data.char_count} characters`,
            );
            return response.data.markdown;
          } else {
            throw new Error(
              response.data.error || 'Unknown conversion error',
            );
          }
        } catch (error) {
          lastError = error as Error;
          if (attempt < this.maxRetries) {
            const delay = this.retryDelay * attempt;
            this.logger.warn(
              `Conversion attempt ${attempt} failed. Retrying in ${delay}ms: ${lastError.message}`,
            );
            await this.delay(delay);
          }
        }
      }

      throw lastError || new Error('Failed to convert PDF after max retries');
    } catch (error) {
      this.logger.error(
        `Docling conversion failed for ${filePath}: ${(error as Error).message}`,
      );
      throw new Error(
        `PDF conversion failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Convert PDF and return markdown + structured JSON (figures, math, tables)
   */
  async convertPdfRich(filePath: string): Promise<{
    markdown: string;
    json?: any;
    charCount?: number;
    pageCount?: number;
  }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }

    return this.convertFileRich(filePath, '/convert-pdf');
  }

  /**
   * Convert image (PNG, JPG, JPEG, WEBP) to text using OCR.
   */
  async convertImageToText(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }

    const fileStats = fs.statSync(filePath);
    this.logger.log(
      `Converting image to text via OCR: ${filePath} (${fileStats.size} bytes)`,
    );

    const formData = this.createFormData(filePath);
    const response = await this.axiosInstance.post<ConversionResponse>(
      '/convert-image',
      formData,
      { headers: formData.getHeaders() },
    );

    if (response.data.status === 'success' && response.data.markdown) {
      this.logger.log(
        `OCR extraction successful: ${response.data.char_count} characters`,
      );
      return response.data.markdown;
    }

    throw new Error(
      response.data.error || 'Unknown image conversion error',
    );
  }

  /**
   * Convert DOCX or PDF with endpoint selection.
   */
  async convertFileRich(
    filePath: string,
    endpoint: '/convert-pdf' | '/convert-docx' | '/convert-image' = '/convert-pdf',
  ): Promise<{
    markdown: string;
    json?: any;
    charCount?: number;
    pageCount?: number;
  }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStats = fs.statSync(filePath);
    this.logger.log(
      `Converting (${endpoint}) to markdown/json: ${filePath} (${fileStats.size} bytes)`,
    );

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const formData = this.createFormData(filePath);
        const response = await this.axiosInstance.post<ConversionResponse>(
          endpoint,
          formData,
          { headers: formData.getHeaders() },
        );

        if (response.data.status === 'success' && response.data.markdown) {
          return {
            markdown: response.data.markdown,
            json: response.data.json,
            charCount: response.data.char_count,
            pageCount: response.data.page_count,
          };
        }

        throw new Error(response.data.error || 'Unknown conversion error');
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt;
          this.logger.warn(
            `Rich conversion attempt ${attempt} failed. Retrying in ${delay}ms: ${lastError.message}`,
          );
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
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get('/health', {
        timeout: 5000,
      });
      const isHealthy = response.data?.status === 'ok';
      if (isHealthy) {
        this.logger.debug('Docling service health check passed');
      } else {
        this.logger.warn('Docling service health check returned unexpected status');
      }
      return isHealthy;
    } catch (error) {
      this.logger.error(
        `Docling health check failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Get service info
   */
  async getServiceInfo(): Promise<any> {
    try {
      const response = await this.axiosInstance.get('/info');
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get service info: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create form data for a file (fresh stream per attempt)
   */
  private createFormData(filePath: string): FormData {
    const formData = new FormData();
    const fileStream = fs.createReadStream(filePath);
    formData.append('file', fileStream, { filename: filePath });
    return formData;
  }
}