# Manhua creative-advisor sidecar

Python HTTP process that vendors HKUDS/ViMax `agent_runtime` (MIT) for session /
compaction / tool loop and Idea/Script **text planning** only.

Image and video generation must go through `HOST_BRIDGE_URL` (Node). Local
`RenderBackend` is not used.

## Run (dev)

```bash
cd services/vimax-agent
uv sync
export MANHUA_AGENT_WORKSPACE="$(pwd)/data/workspace"
export HOST_BRIDGE_URL="http://127.0.0.1:3000"
export HOST_BRIDGE_TOKEN="dev-bridge-token"
export MANHUA_AGENT_SIDECAR_TOKEN="dev-bridge-token"
# OpenAI-compatible LLM for the agent loop:
export VIMAX_LLM_API_KEY="..."
export VIMAX_LLM_BASE_URL="..."
export VIMAX_LLM_MODEL="..."
uv run python -m app.server
```

Endpoints: `GET /health`, `POST /session`, `GET /session/:id`, `POST /chat`,
`POST /run-idea2video-plan`.

See `NOTICE` and `docs/2026Jul21/manhua-agent-loop-vimax-hybrid.md`.
