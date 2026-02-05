"""
Docling Document Processing Service
Advanced PDF processing with:
- Mathematical formula extraction (LaTeX preservation)
- Image extraction and storage
- Table detection and extraction
- Vector embeddings for semantic search
- Image OCR (pytesseract) for PNG, JPG, JPEG, WEBP
"""

from fastapi import FastAPI, File, UploadFile, Query
from fastapi.responses import JSONResponse
import os
import tempfile
import logging
from pathlib import Path
from typing import Dict, Any

try:
    from docling.document_converter import DocumentConverter
    from docling.datastructures import ConvertedDocument
except ImportError:
    DocumentConverter = None
    ConvertedDocument = None

try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False
    pytesseract = None
    Image = None

from embeddings import get_embeddings_manager

# Image extensions supported for OCR
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}

logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO'))
logger = logging.getLogger(__name__)

app = FastAPI(title="Docling Service", version="2.0.0")

# Initialize embeddings manager
try:
    logger.info("========== Initializing Embeddings Manager ==========")
    embeddings_mgr = get_embeddings_manager()
    logger.info("✓ Embeddings manager initialized")
    logger.info("Ensuring 'pdf_chunks' collection exists...")
    embeddings_mgr.ensure_collection('pdf_chunks')
    logger.info("✓ pdf_chunks collection ensured")
    logger.info("========== Embeddings System Ready ==========")
except Exception as e:
    logger.error(f"✗ Failed to initialize embeddings manager: {str(e)}", exc_info=True)
    logger.warning("Continuing without vector support.")
    embeddings_mgr = None


@app.get('/health')
async def health_check():
    """Health check endpoint"""
    docling_available = DocumentConverter is not None
    return {
        "status": "ok",
        "service": "docling",
        "version": "2.0.0",
        "docling_available": docling_available,
    }


@app.get('/info')
async def info():
    """Service information"""
    caps = [
        "pdf_to_markdown",
        "image_extraction",
        "formula_extraction",
        "table_detection",
        "latex_preservation",
        "vector_embeddings",
    ]
    if OCR_AVAILABLE:
        caps.append("image_ocr")
    return {
        "service": "docling",
        "version": "2.0.0",
        "capabilities": caps,
        "ocr_available": OCR_AVAILABLE,
    }


async def _save_tmp(file: UploadFile) -> str:
    """Save uploaded file to temporary location"""
    suffix = os.path.splitext(file.filename)[1] or '.bin'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        contents = await file.read()
        f.write(contents)
        return f.name


def _extract_formulas_and_images(doc: ConvertedDocument) -> Dict[str, Any]:
    """
    Extract mathematical formulas and images from document.
    
    Returns:
        Dictionary with formulas and image metadata
    """
    formulas = []
    images = []
    
    try:
        # Extract from document structure
        if hasattr(doc, 'document') and hasattr(doc.document, 'blocks'):
            for block_idx, block in enumerate(doc.document.blocks):
                # Extract formulas (usually in MathBlock or similar)
                if hasattr(block, 'children'):
                    for child in block.children:
                        if hasattr(child, 'type') and 'math' in str(child.type).lower():
                            formula_data = {
                                'block_index': block_idx,
                                'latex': str(child) if hasattr(child, 'to_latex') else str(child),
                                'type': 'inline' if 'inline' in str(child.type).lower() else 'display'
                            }
                            formulas.append(formula_data)
                
                # Extract images (usually in ImageBlock or similar)
                if hasattr(block, 'type') and 'image' in str(block.type).lower():
                    image_data = {
                        'block_index': block_idx,
                        'description': getattr(block, 'alt_text', 'Image'),
                        'caption': getattr(block, 'caption', ''),
                        'id': f"img_{block_idx}"
                    }
                    images.append(image_data)
    
    except Exception as e:
        logger.warning(f"Error extracting formulas/images: {str(e)}")
    
    return {
        'formulas': formulas,
        'images': images,
    }


def _convert_document_with_docling(filepath: str) -> Dict[str, Any]:
    """
    Convert document using Docling library.
    Extracts text, formulas, images, tables, and metadata.
    
    Args:
        filepath: Path to PDF file
        
    Returns:
        Dictionary with extracted content
    """
    if DocumentConverter is None:
        raise Exception("Docling library not available. Install with: pip install docling")
    
    try:
        logger.info(f"Converting document with Docling: {filepath}")
        
        # Initialize converter
        converter = DocumentConverter()
        
        # Convert document
        doc = converter.convert(filepath)
        
        logger.info(f"Document converted successfully")
        
        # Extract markdown (preserves structure)
        markdown_content = doc.document.export_to_markdown() if hasattr(doc.document, 'export_to_markdown') else str(doc.document)
        
        # Extract formulas and images
        formula_image_data = _extract_formulas_and_images(doc)
        
        # Get page count
        page_count = len(doc.pages) if hasattr(doc, 'pages') else 1
        
        # Get metadata
        metadata = {
            'title': getattr(doc.document, 'title', 'Document'),
            'author': getattr(doc.document, 'author', None),
            'creation_date': getattr(doc.document, 'creation_date', None),
            'page_count': page_count,
        }
        
        return {
            'status': 'success',
            'markdown': markdown_content,
            'char_count': len(markdown_content),
            'page_count': page_count,
            'metadata': metadata,
            'formulas': formula_image_data['formulas'],
            'images': formula_image_data['images'],
            'extraction_method': 'docling'
        }
    
    except Exception as e:
        logger.error(f"Docling conversion error: {str(e)}")
        raise


def _ocr_image_to_text(filepath: str) -> Dict[str, Any]:
    """
    Extract text from image file using OCR (pytesseract).
    
    Args:
        filepath: Path to image file (PNG, JPG, JPEG, WEBP)
        
    Returns:
        Dictionary with extracted text and metadata
    """
    if not OCR_AVAILABLE:
        raise Exception("OCR not available. Install: pip install pytesseract Pillow. Also install Tesseract: https://github.com/tesseract-ocr/tesseract")
    
    try:
        logger.info(f"OCR extracting text from image: {filepath}")
        img = Image.open(filepath)
        text = pytesseract.image_to_string(img)
        text = (text or "").strip()
        char_count = len(text)
        logger.info(f"OCR extracted {char_count} characters from image")
        return {
            "status": "success",
            "markdown": text if text else "# Image\n\nNo text could be extracted from this image.",
            "char_count": char_count,
            "page_count": 1,
            "extraction_method": "pytesseract_ocr",
        }
    except Exception as e:
        logger.error(f"OCR extraction error: {str(e)}")
        raise


@app.post('/convert-image')
async def convert_image(file: UploadFile = File(...)):
    """
    Extract text from image file (PNG, JPG, JPEG, WEBP) using OCR.
    """
    if not OCR_AVAILABLE:
        return JSONResponse({
            "status": "error",
            "error": "OCR not available. Install pytesseract and Pillow, and ensure Tesseract OCR is installed on the system.",
        }, status_code=503)
    
    tmp = None
    try:
        logger.info(f"Received image for OCR: {file.filename}")
        tmp = await _save_tmp(file)
        result = _ocr_image_to_text(tmp)
        markdown = f"# {file.filename}\n\n{result['markdown']}"
        return JSONResponse({
            "status": "success",
            "filename": file.filename,
            "markdown": markdown,
            "char_count": len(markdown),
            "page_count": 1,
            "extraction_method": "pytesseract_ocr",
        })
    except Exception as e:
        logger.error(f"Error converting image: {str(e)}")
        return JSONResponse({
            "status": "error",
            "filename": file.filename,
            "error": str(e),
        }, status_code=500)
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except Exception as e:
                logger.warning(f"Failed to delete temp file: {str(e)}")


@app.post('/convert-pdf')
async def convert_pdf(file: UploadFile = File(...)):
    """
    Convert PDF to structured markdown format.
    Includes formula extraction (LaTeX) and image detection.
    """
    tmp = None
    try:
        logger.info(f"Received file: {file.filename}")
        tmp = await _save_tmp(file)
        
        # Convert using Docling
        result = _convert_document_with_docling(tmp)
        
        # Format response
        markdown = f"# {file.filename}\n\n{result['markdown']}"
        
        return JSONResponse({
            "status": "success",
            "filename": file.filename,
            "markdown": markdown,
            "char_count": len(markdown),
            "page_count": result['page_count'],
            "extraction_method": result['extraction_method'],
            "metadata": result['metadata'],
            "formulas_found": len(result['formulas']),
            "images_found": len(result['images']),
            "formulas": result['formulas'][:10] if result['formulas'] else [],
            "images_metadata": result['images'],
        })
    
    except Exception as e:
        logger.error(f"Error converting PDF: {str(e)}")
        return JSONResponse({
            "status": "error",
            "filename": file.filename,
            "error": str(e),
        }, status_code=500)
    
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
                logger.info(f"Cleaned up temp file: {tmp}")
            except Exception as e:
                logger.warning(f"Failed to delete temp file: {str(e)}")


@app.post('/embed-pdf')
async def embed_pdf(file: UploadFile = File(...), course_id: str = Query(None)):
    """
    Convert PDF or image to embeddings and store in Qdrant vector database.
    Supports PDF, DOCX, and images (PNG, JPG, JPEG, WEBP) via OCR.
    Includes formula and image context.
    """
    if not course_id:
        return JSONResponse({
            "status": "error",
            "error": "course_id is required as a query parameter"
        }, status_code=400)
    
    tmp = None
    try:
        logger.info(f"Received file for embedding: {file.filename} (course: {course_id})")
        tmp = await _save_tmp(file)
        
        # Check if file is an image - use OCR instead of Docling
        ext = os.path.splitext(file.filename)[1].lower() if file.filename else ''
        if ext in IMAGE_EXTENSIONS and OCR_AVAILABLE:
            result = _ocr_image_to_text(tmp)
            text_content = result['markdown']
            page_count = 1
            formulas_count = 0
            images_count = 0
            extraction_method = "pytesseract_ocr"
        else:
            # Convert using Docling (PDF/DOCX)
            result = _convert_document_with_docling(tmp)
            text_content = result['markdown']
            page_count = result.get('page_count', 1)
            formulas_count = len(result.get('formulas', []))
            images_count = len(result.get('images', []))
            extraction_method = result.get('extraction_method', 'docling')
        
        # Add formula descriptions to text for better semantic search (PDF/DOCX only)
        if extraction_method == 'docling' and result.get('formulas'):
            formula_text = "\n\n### Formulas Found:\n"
            for i, formula in enumerate(result['formulas']):
                formula_text += f"- Formula {i+1}: {formula.get('latex', 'Unknown')}\n"
            text_content = text_content + formula_text
        
        # Add image descriptions (PDF/DOCX only)
        if extraction_method == 'docling' and result.get('images'):
            image_text = "\n\n### Images Referenced:\n"
            for img in result['images']:
                image_text += f"- {img.get('description', 'Image')}"
                if img.get('caption'):
                    image_text += f": {img['caption']}"
                image_text += "\n"
            text_content = text_content + image_text
        
        # Store embeddings in Qdrant
        try:
            embedding_result = embeddings_mgr.store_pdf_chunks(text_content, course_id)
            
            logger.info(f"Successfully embedded {file.filename} for course {course_id}")
            return JSONResponse({
                "status": "success",
                "filename": file.filename,
                "course_id": course_id,
                "page_count": page_count,
                "extraction_method": extraction_method,
                "formulas_found": formulas_count,
                "images_found": images_count,
                "embedding_stats": embedding_result,
                "metadata": result.get('metadata', {}),
            })
        
        except Exception as e:
            logger.error(f"Failed to store embeddings: {str(e)}")
            return JSONResponse({
                "status": "error",
                "filename": file.filename,
                "error": f"Embedding storage failed: {str(e)}"
            }, status_code=500)
    
    except Exception as e:
        logger.error(f"Error in embed_pdf: {str(e)}")
        return JSONResponse({
            "status": "error",
            "filename": file.filename,
            "error": str(e)
        }, status_code=500)
    
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except Exception as e:
                logger.warning(f"Failed to delete temp file: {str(e)}")


@app.post('/extract-formulas')
async def extract_formulas(file: UploadFile = File(...)):
    """
    Extract only mathematical formulas from PDF.
    Returns LaTeX representation and locations.
    """
    tmp = None
    try:
        logger.info(f"Extracting formulas from: {file.filename}")
        tmp = await _save_tmp(file)
        
        result = _convert_document_with_docling(tmp)
        
        return JSONResponse({
            "status": "success",
            "filename": file.filename,
            "formulas_count": len(result['formulas']),
            "formulas": result['formulas'],
            "page_count": result['page_count'],
        })
    
    except Exception as e:
        logger.error(f"Error extracting formulas: {str(e)}")
        return JSONResponse({
            "status": "error",
            "filename": file.filename,
            "error": str(e)
        }, status_code=500)
    
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except Exception as e:
                logger.warning(f"Failed to delete temp file: {str(e)}")


@app.post('/extract-images')
async def extract_images(file: UploadFile = File(...)):
    """
    Extract image metadata and descriptions from PDF.
    """
    tmp = None
    try:
        logger.info(f"Extracting images from: {file.filename}")
        tmp = await _save_tmp(file)
        
        result = _convert_document_with_docling(tmp)
        
        return JSONResponse({
            "status": "success",
            "filename": file.filename,
            "images_count": len(result['images']),
            "images": result['images'],
            "page_count": result['page_count'],
        })
    
    except Exception as e:
        logger.error(f"Error extracting images: {str(e)}")
        return JSONResponse({
            "status": "error",
            "filename": file.filename,
            "error": str(e)
        }, status_code=500)
    
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except Exception as e:
                logger.warning(f"Failed to delete temp file: {str(e)}")


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', 5000))
    uvicorn.run(app, host='0.0.0.0', port=port)
