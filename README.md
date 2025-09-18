#  RAG-Powered Chatbot Backend

This is the backend service for the **RAG-Powered Chatbot for News Websites** assignment at **Voosh**.  
It provides REST APIs to handle chat sessions, retrieve answers from the RAG pipeline, and manage session history.

---

##  Tech Stack

- Backend: Node.js + Express  
- Embeddings: Jina AI (jina-embeddings-v2-base-en)  
- Vector DB: Qdrant  
- LLM: Google Gemini API 
- Cache & Sessions: Redis (local Docker / Upstash)  
- Database (optional): MYSQL DB 

---

##  Project Structure
Backend/
├── src/
│ ├── routes/chat.js # API routes
│ ├── services/embedding.js # Jina embeddings
│ ├── services/qdrant.js # Qdrant client
│ ├── services/retriever.js # RAG retriever logic
│ ├── scripts/
│ │ ├── ingestion.js # Embed & store news docs
│ │ └── testRetriever.js # Test RAG retrieval
│ └── index.js # Server entry point
└── package.json

