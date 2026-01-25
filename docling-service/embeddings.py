"""
Embeddings module for Qdrant vector database integration.
Handles PDF chunking, embedding generation, and Qdrant operations.
"""

import os
import logging
from typing import List, Dict, Any
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
import uuid

logger = logging.getLogger(__name__)

class EmbeddingsManager:
    """Manages document embeddings and Qdrant interactions"""
    
    def __init__(self):
        self.qdrant_url = os.getenv('QDRANT_URL', 'http://localhost:6333')
        self.api_key = os.getenv('QDRANT_API_KEY', '')
        self.model_name = 'all-MiniLM-L6-v2'  # Fast, efficient embeddings (384 dims)
        
        try:
            self.client = QdrantClient(
                url=self.qdrant_url,
                api_key=self.api_key if self.api_key else None
            )
            self.model = SentenceTransformer(self.model_name)
            logger.info(f"Initialized Qdrant client: {self.qdrant_url}")
            logger.info(f"Embedding model: {self.model_name} (384 dimensions)")
        except Exception as e:
            logger.error(f"Failed to initialize embeddings: {str(e)}")
            raise

    def chunk_text(self, text: str, chunk_size: int = 512, overlap: int = 100) -> List[str]:
        """
        Split text into overlapping chunks for better context preservation.
        
        Args:
            text: Input text to chunk
            chunk_size: Target size of each chunk (in characters)
            overlap: Character overlap between chunks
            
        Returns:
            List of text chunks
        """
        if len(text) <= chunk_size:
            return [text]
        
        chunks = []
        start = 0
        
        while start < len(text):
            end = min(start + chunk_size, len(text))
            chunk = text[start:end].strip()
            
            if chunk:
                chunks.append(chunk)
            
            start = end - overlap
            if start <= 0:
                break
        
        return chunks if chunks else [text]

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for a list of texts.
        
        Args:
            texts: List of text strings
            
        Returns:
            List of embedding vectors
        """
        try:
            embeddings = self.model.encode(texts, convert_to_tensor=False)
            return embeddings.tolist() if hasattr(embeddings, 'tolist') else embeddings
        except Exception as e:
            logger.error(f"Failed to generate embeddings: {str(e)}")
            raise

    def ensure_collection(self, collection_name: str, vector_size: int = 384):
        """
        Ensure a collection exists in Qdrant. Create if it doesn't.
        
        Args:
            collection_name: Name of the collection
            vector_size: Dimension of vectors (default 384 for all-MiniLM-L6-v2)
        """
        try:
            # Check if collection exists
            logger.info(f"Attempting to get collections for: {collection_name}")
            collections = self.client.get_collections()
            collection_names = [col.name for col in collections.collections]
            logger.info(f"Found {len(collection_names)} existing collections: {collection_names}")
            
            if collection_name not in collection_names:
                logger.info(f"Creating collection: {collection_name}")
                self.client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(
                        size=vector_size,
                        distance=Distance.COSINE
                    )
                )
                logger.info(f"✓ Collection {collection_name} created successfully with {vector_size}-dim COSINE vectors")
            else:
                logger.info(f"✓ Collection {collection_name} already exists")
                
        except Exception as e:
            logger.error(f"✗ Failed to ensure collection {collection_name}: {str(e)}", exc_info=True)
            raise

    def store_pdf_chunks(
        self,
        pdf_content: str,
        course_id: str,
        collection_name: str = "pdf_chunks"
    ) -> Dict[str, Any]:
        """
        Extract, chunk, embed and store PDF content in Qdrant.
        
        Args:
            pdf_content: Extracted text from PDF
            course_id: ID of the course
            collection_name: Name of Qdrant collection
            
        Returns:
            Dictionary with chunking and storage stats
        """
        try:
            # Ensure collection exists
            self.ensure_collection(collection_name)
            
            # Chunk the content
            chunks = self.chunk_text(pdf_content)
            logger.info(f"Created {len(chunks)} chunks from PDF")
            
            # Generate embeddings
            embeddings = self.generate_embeddings(chunks)
            logger.info(f"Generated embeddings for {len(chunks)} chunks")
            
            # Prepare points for Qdrant
            points = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                point_id = str(uuid.uuid4())
                point = PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        "course_id": course_id,
                        "chunk_index": i,
                        "text": chunk,
                        "chunk_count": len(chunks),
                        "metadata": {
                            "source": "pdf",
                            "course_id": course_id
                        }
                    }
                )
                points.append(point)
            
            # Upsert points into Qdrant
            self.client.upsert(
                collection_name=collection_name,
                points=points
            )
            logger.info(f"Stored {len(points)} points in Qdrant for course {course_id}")
            
            return {
                "status": "success",
                "chunks_created": len(chunks),
                "embeddings_generated": len(embeddings),
                "points_stored": len(points),
                "collection_name": collection_name
            }
            
        except Exception as e:
            logger.error(f"Failed to store PDF chunks: {str(e)}")
            raise

    def search_similar_chunks(
        self,
        query: str,
        course_id: str,
        collection_name: str = "pdf_chunks",
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Search for similar chunks based on a query.
        
        Args:
            query: Query text
            course_id: Filter results by course ID
            collection_name: Name of Qdrant collection
            limit: Maximum number of results
            
        Returns:
            List of similar chunks with scores
        """
        try:
            # Generate query embedding
            query_embedding = self.generate_embeddings([query])[0]
            
            # Search in Qdrant
            results = self.client.search(
                collection_name=collection_name,
                query_vector=query_embedding,
                query_filter={
                    "must": [
                        {
                            "key": "payload.course_id",
                            "match": {"value": course_id}
                        }
                    ]
                },
                limit=limit
            )
            
            # Format results
            formatted_results = []
            for result in results:
                formatted_results.append({
                    "score": result.score,
                    "text": result.payload.get("text", ""),
                    "chunk_index": result.payload.get("chunk_index", -1),
                    "metadata": result.payload.get("metadata", {})
                })
            
            logger.info(f"Found {len(formatted_results)} similar chunks for query in course {course_id}")
            return formatted_results
            
        except Exception as e:
            logger.error(f"Failed to search similar chunks: {str(e)}")
            raise

    def delete_course_chunks(self, course_id: str, collection_name: str = "pdf_chunks"):
        """
        Delete all chunks associated with a course.
        
        Args:
            course_id: ID of the course
            collection_name: Name of Qdrant collection
        """
        try:
            self.client.delete(
                collection_name=collection_name,
                points_selector={
                    "filter": {
                        "must": [
                            {
                                "key": "payload.course_id",
                                "match": {"value": course_id}
                            }
                        ]
                    }
                }
            )
            logger.info(f"Deleted all chunks for course {course_id}")
        except Exception as e:
            logger.error(f"Failed to delete course chunks: {str(e)}")
            raise


# Initialize globally
embeddings_manager = None


def get_embeddings_manager():
    """Get or create the embeddings manager instance"""
    global embeddings_manager
    if embeddings_manager is None:
        embeddings_manager = EmbeddingsManager()
    return embeddings_manager
