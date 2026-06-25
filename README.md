# neo4j-viz

Visualize a Neo4j graph database in your browser. `neo4j-viz` is a small
[FastAPI](https://fastapi.tiangolo.com/) backend that reads nodes and
relationships from a running Neo4j instance and renders them as an interactive,
force-directed graph using [D3.js](https://d3js.org/).

## Features

- **Interactive graph explorer** — pan, drag nodes, and watch the force-directed
  layout settle in real time.
- **Adjustable node limit** — fetch between 1 and 1000 nodes directly from the UI.
- **REST API** — `GET /api/graph` returns normalized `nodes` and `links` payloads
  that you can consume from your own tooling.
- **Single-file backend** — everything lives in `main.py`, so it is easy to read
  and extend.

## Requirements

- Python 3.12 or newer (the version is pinned in `.python-version`).
- A reachable Neo4j database (local Docker container, Neo4j Desktop, or Aura).

## Installation

Clone the repository and install the project (this pulls in `fastapi`, `neo4j`,
and `uvicorn`):

```bash
git clone https://github.com/pratik-gokhale-dnv/neo4j-viz.git
cd neo4j-viz
pip install -e .
```

> Prefer [uv](https://docs.astral.sh/uv/)? Run `uv sync` instead of `pip install -e .`.

## Configuration

The app reads its Neo4j connection details from environment variables:

| Variable          | Required | Description                                            |
| ----------------- | -------- | ------------------------------------------------------ |
| `NEO4J_URI`       | Yes      | Bolt/Neo4j connection URI, e.g. `bolt://localhost:7687`. |
| `NEO4J_USERNAME`  | Yes      | Database username, e.g. `neo4j`.                       |
| `NEO4J_PASSWORD`  | Yes      | Database password.                                     |
| `NEO4J_DATABASE`  | No       | Target database name (defaults to the server default). |

Export them in your shell:

```bash
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USERNAME="neo4j"
export NEO4J_PASSWORD="your-password"
# Optional:
# export NEO4J_DATABASE="neo4j"
```

### Need a Neo4j instance?

Spin one up quickly with Docker:

```bash
docker run --rm \
  --name neo4j-viz-db \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your-password \
  neo4j:5
```

The Neo4j Browser will be available at `http://localhost:7474`, and the Bolt
endpoint (used by this app) at `bolt://localhost:7687`.

## How to run it

1. Make sure your Neo4j database is running and the environment variables above
   are set.
2. Start the app:

   ```bash
   python main.py
   ```

   This launches Uvicorn on `http://0.0.0.0:8000`.

3. Open [`http://localhost:8000`](http://localhost:8000) in your browser.

Use the **Node limit** field and **Reload** button in the toolbar to control how
many nodes are fetched and re-render the graph.

## API

### `GET /`

Serves the interactive D3.js graph explorer (HTML page).

### `GET /api/graph`

Returns the graph data as JSON.

| Query param | Type | Default | Range  | Description                       |
| ----------- | ---- | ------- | ------ | --------------------------------- |
| `limit`     | int  | `200`   | 1–1000 | Maximum number of nodes to fetch. |

Example response:

```json
{
  "nodes": [
    { "id": "1", "label": "Person", "labels": ["Person"], "properties": { "name": "Ada" } }
  ],
  "links": [
    { "source": "1", "target": "2", "type": "KNOWS" }
  ]
}
```

If Neo4j is unreachable or misconfigured, the endpoint responds with HTTP `503`
and a descriptive `detail` message.

## Project structure

```
.
├── .github/workflows/copilot-setup-steps.yml  # Copilot cloud session setup
├── .python-version                            # Pinned Python version (3.12)
├── main.py                                     # FastAPI backend + D3.js frontend
├── pyproject.toml                              # Project metadata and dependencies
└── README.md
```

## Development & cloud sessions

The repository ships with a
[`copilot-setup-steps.yml`](.github/workflows/copilot-setup-steps.yml) workflow
that prepares a deterministic environment for GitHub Copilot cloud sessions. It
checks out the code, installs the Python version from `.python-version`, and
verifies the interpreter is available. The workflow can also be triggered
manually from the Actions tab via **workflow_dispatch**.

## Troubleshooting

- **`Unable to read graph from Neo4j` / HTTP 503** — verify the database is
  running and the `NEO4J_*` environment variables point to it.
- **Empty graph** — confirm the target database actually contains nodes, or
  increase the node limit in the toolbar.
- **Authentication errors** — double-check `NEO4J_USERNAME` and
  `NEO4J_PASSWORD`.
