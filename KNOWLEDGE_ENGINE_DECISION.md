# Knowledge Engine Decision

## Decision
Deskchat should stop treating the current keyword chunk search as the long-term knowledge base. Keep it only as a fallback while integrating a real RAG engine behind a small adapter.

## Recommended Route
- Primary: RAGFlow for document-heavy knowledge bases, OCR, tables, and parsing quality.
- Alternative: AnythingLLM if the goal is a ready local knowledge app with API integration.
- Lightweight local option: LanceDB or sqlite-vec if Deskchat keeps owning parsing, embeddings, and retrieval.

## Adapter Contract
- `ingestFile(baseId, filePath, metadata)`
- `reindexFile(baseId, fileId)`
- `search(baseId, query, limit)`
- `getFileStatus(baseId, fileId)`
- `deleteFile(baseId, fileId)`

## Current Fallback
The built-in engine now reports explicit states:
- `ready`
- `empty_text`
- `source_missing`

If a file has no chunks, Deskchat must show the reason and ask for reimport or OCR instead of pretending retrieval succeeded.
