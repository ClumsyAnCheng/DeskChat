# RAGFlow Windows Setup

## Current State
- RAGFlow source is ready at `D:\RAGFlow\ragflow`.
- Docker CLI and Compose are installed.
- `docker compose -f docker-compose.yml config --services` passes.
- Docker Linux Engine is not running: `docker run --rm hello-world` returns 500.
- Windows reports `HyperVisorPresent: False`, so Linux containers cannot start yet.

## Fix Docker First
Run PowerShell as Administrator:

```powershell
dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
bcdedit /set hypervisorlaunchtype auto
wsl --update
shutdown /r /t 0
```

After reboot, open Docker Desktop and confirm:
- Engine is running.
- Settings > Resources > Advanced > Disk image location points to `D:\Docker\wsl\DockerDesktopWSL` or another D drive path.

Then verify in a new PowerShell:

```powershell
docker context use desktop-linux
docker run --rm hello-world
docker info
```

## Start RAGFlow
```powershell
cd D:\RAGFlow\ragflow\docker
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps
```

Expected services:
- `es01`
- `mysql`
- `minio`
- `redis`
- `ragflow-cpu`

Open:
- Web UI: `http://localhost`
- API: `http://localhost:9380`

## Connect Deskchat
In Deskchat Settings:
- Enable RAGFlow.
- Base URL: `http://localhost:9380`
- API Key: create in RAGFlow.
- Dataset ID: copy from the RAGFlow dataset.

Graph output depends on RAGFlow parsing and GraphRAG completion, so first results may need a few minutes after upload.
