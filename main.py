from __future__ import annotations

import os
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from neo4j import GraphDatabase
from starlette.requests import Request

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "app" / "templates"


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    if _driver.cache_info().currsize:
        _driver().close()
        _driver.cache_clear()


app = FastAPI(title="Neo4j Viz", lifespan=lifespan)

# Mount the templates directory to serve static JS files
app.mount("/static", StaticFiles(directory=str(TEMPLATES_DIR)), name="static")

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Include routes from app module (neighbors, search, schema endpoints)
from app.routes import router as app_router  # noqa: E402

app.include_router(app_router)


def _neo4j_settings() -> tuple[str, str, str, str | None]:
    uri = os.getenv("NEO4J_URI")
    username = os.getenv("NEO4J_USERNAME")
    password = os.getenv("NEO4J_PASSWORD")
    database = os.getenv("NEO4J_DATABASE")

    if not uri or not username or not password:
        raise ValueError(
            "Missing Neo4j settings. Please set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD."
        )

    return uri, username, password, database


@lru_cache(maxsize=1)
def _driver():
    uri, username, password, _ = _neo4j_settings()
    return GraphDatabase.driver(uri, auth=(username, password))


def _node_to_payload(node: Any) -> dict[str, Any]:
    labels = list(node.labels)
    return {
        "id": str(node.id),
        "label": labels[0] if labels else "Node",
        "labels": labels,
        "properties": dict(node.items()),
    }


def fetch_graph(limit: int = 200) -> dict[str, list[dict[str, Any]]]:
    _, _, _, database = _neo4j_settings()

    query = """
    MATCH (n)
    WITH n LIMIT $limit
    OPTIONAL MATCH (n)-[r]->(m)
    RETURN n, r, m
    """

    nodes: dict[str, dict[str, Any]] = {}
    links: dict[tuple[str, str, str], dict[str, str]] = {}

    with _driver().session(database=database) as session:
        for record in session.run(query, limit=limit):
            for key in ("n", "m"):
                node = record.get(key)
                if node is None:
                    continue
                node_id = str(node.id)
                nodes.setdefault(node_id, _node_to_payload(node))

            rel = record.get("r")
            if rel is None:
                continue

            source_id = str(rel.start_node.id)
            target_id = str(rel.end_node.id)
            link_key = (source_id, target_id, rel.type)
            links.setdefault(
                link_key,
                {"source": source_id, "target": target_id, "type": rel.type},
            )

    return {"nodes": list(nodes.values()), "links": list(links.values())}


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/graph")
def graph(
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict[str, list[dict[str, Any]]]:
    try:
        return fetch_graph(limit=limit)
    except (
        Exception
    ) as exc:  # pragma: no cover - defensive error handling for runtime failures
        raise HTTPException(
            status_code=503,
            detail="Unable to read graph from Neo4j. Check connection settings and database availability.",
        ) from exc


def main() -> None:
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
