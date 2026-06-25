from __future__ import annotations

from functools import lru_cache
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from neo4j import GraphDatabase
import uvicorn


app = FastAPI(title="Neo4j Viz")


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
def index() -> str:
    return """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Neo4j Viz</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; }
      .toolbar { padding: 0.75rem; border-bottom: 1px solid #ddd; display: flex; gap: 0.5rem; align-items: center; }
      #graph { width: 100vw; height: calc(100vh - 58px); display: block; }
      .link { stroke: #999; stroke-opacity: 0.65; }
      .node { stroke: #fff; stroke-width: 1.5px; }
      .label { font-size: 10px; pointer-events: none; }
      #status { color: #555; }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <label for="limit">Node limit:</label>
      <input id="limit" type="number" min="1" max="1000" value="200" />
      <button id="reload">Reload</button>
      <span id="status"></span>
    </div>
    <svg id="graph"></svg>

    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script>
      const svg = d3.select('#graph');
      const width = window.innerWidth;
      const height = window.innerHeight - 58;
      svg.attr('viewBox', [0, 0, width, height]);

      async function loadGraph() {
        const status = document.getElementById('status');
        status.textContent = 'Loading…';

        const limit = Number(document.getElementById('limit').value || 200);
        const response = await fetch(`/api/graph?limit=${encodeURIComponent(limit)}`);

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          status.textContent = payload.detail || 'Could not load graph data';
          return;
        }

        const data = await response.json();
        status.textContent = `Loaded ${data.nodes.length} nodes and ${data.links.length} relationships`;
        renderGraph(data);
      }

      function renderGraph(data) {
        svg.selectAll('*').remove();

        const color = d3.scaleOrdinal(d3.schemeTableau10);

        const link = svg.append('g')
          .attr('stroke', '#999')
          .attr('stroke-opacity', 0.6)
          .selectAll('line')
          .data(data.links)
          .join('line')
          .attr('class', 'link')
          .attr('stroke-width', 1.5);

        const node = svg.append('g')
          .selectAll('circle')
          .data(data.nodes)
          .join('circle')
          .attr('class', 'node')
          .attr('r', 8)
          .attr('fill', d => color(d.label));

        node.append('title').text(d => `${d.label} (${d.id})`);

        const labels = svg.append('g')
          .selectAll('text')
          .data(data.nodes)
          .join('text')
          .attr('class', 'label')
          .text(d => d.label);

        const simulation = d3.forceSimulation(data.nodes)
          .force('link', d3.forceLink(data.links).id(d => d.id).distance(65))
          .force('charge', d3.forceManyBody().strength(-230))
          .force('center', d3.forceCenter(width / 2, height / 2));

        node.call(d3.drag()
          .on('start', (event) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
          })
          .on('drag', (event) => {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
          })
          .on('end', (event) => {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
          }));

        simulation.on('tick', () => {
          link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

          node
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);

          labels
            .attr('x', d => d.x + 10)
            .attr('y', d => d.y + 4);
        });
      }

      document.getElementById('reload').addEventListener('click', loadGraph);
      loadGraph();
    </script>
  </body>
</html>
"""


@app.get("/api/graph")
def graph(limit: int = Query(default=200, ge=1, le=1000)) -> dict[str, list[dict[str, Any]]]:
    try:
        return fetch_graph(limit=limit)
    except Exception as exc:  # pragma: no cover - defensive error handling for runtime failures
        raise HTTPException(
            status_code=503,
            detail="Unable to read graph from Neo4j. Check connection settings and database availability.",
        ) from exc


@app.on_event("shutdown")
def close_driver() -> None:
    if _driver.cache_info().currsize:
        _driver().close()
        _driver.cache_clear()


def main() -> None:
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
