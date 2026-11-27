# Production Dockerfile for StudyGAI RAG Processing, Embedding & Reranking Worker
FROM python:3.11-slim

WORKDIR /app

ARG INSTALL_DOCLING=false

ENV PIP_DEFAULT_TIMEOUT=10000 \
    PIP_RETRIES=5 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=5000 \
    RAG_PROFILE=cpu

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    libgl1 \
    libglib2.0-0 \
    poppler-utils \
    tesseract-ocr \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY requirements.txt requirements-docling.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    if [ "$INSTALL_DOCLING" = "true" ]; then pip install --no-cache-dir -r requirements-docling.txt; fi

COPY chunker.py parsers.py embeddings.py main.py ./

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
