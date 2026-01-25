# Dockerfile for Docling PDF Processing Service
FROM python:3.10-slim

WORKDIR /app

# Set pip environment variables for better download reliability
ENV PIP_DEFAULT_TIMEOUT=10000 \
    PIP_RETRIES=10 \
    PIP_NO_CACHE_DIR=1

# Install system dependencies: curl (health check), poppler (pdf2image), tesseract-ocr (pytesseract)
# Using --no-install-recommends to reduce memory footprint during build
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    poppler-utils \
    tesseract-ocr \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py embeddings.py .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/health || exit 1

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=5000

# Run the application
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]
