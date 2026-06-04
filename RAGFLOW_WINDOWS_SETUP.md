# RAGFlow Windows Setup

## Current State
- RAGFlow source: `D:\RAGFlow\ragflow`
- Compose folder: `D:\RAGFlow\ragflow\docker`
- Web UI: `http://localhost`
- REST API: `http://localhost:9380`
- Docker services are expected to run on D-drive backed Docker storage.

## Start / Verify
```powershell
cd D:\RAGFlow\ragflow\docker
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail 80 ragflow-cpu
```

## Required RAGFlow Setup
In RAGFlow Web UI:
1. Configure a model provider.
2. Set a chat model and embedding model.
3. Create a dataset using that embedding model.
4. Create an API key.

In Deskchat Settings:
- Enable RAGFlow knowledge graph engine.
- Base URL: `http://localhost:9380`
- API Key: copy from RAGFlow.
- Dataset ID: copy from the RAGFlow dataset.

## Notes
- Knowledge graph depends on successful PDF parsing and GraphRAG indexing.
- If the graph panel says model setup is incomplete, fix RAGFlow model/provider settings first.
- If Docker was recreated, keep images/data on D drive, not C drive.
