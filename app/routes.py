from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.database import get_driver
from app.schema import get_schema

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@router.get("/api/schema")
async def schema():
    return get_schema()


@router.get("/api/nodes")
async def get_nodes(label: str, limit: int = Query(default=25, le=200)):
    """Fetch nodes by label."""
    driver = get_driver()
    nodes = []
    with driver.session() as session:
        result = session.run(
            f"MATCH (n:`{label}`) RETURN n, elementId(n) AS id LIMIT $limit",
            limit=limit,
        )
        for record in result:
            node = record["n"]
            nodes.append({
                "id": record["id"],
                "labels": list(node.labels),
                "properties": dict(node),
            })
    return {"nodes": nodes}


@router.get("/api/node/{node_id:path}")
async def get_node(node_id: str):
    """Get a single node with all properties."""
    driver = get_driver()
    with driver.session() as session:
        result = session.run(
            "MATCH (n) WHERE elementId(n) = $id RETURN n, elementId(n) AS id",
            id=node_id,
        )
        record = result.single()
        if not record:
            return {"error": "Node not found"}
        node = record["n"]
        return {
            "id": record["id"],
            "labels": list(node.labels),
            "properties": dict(node),
        }


@router.get("/api/neighbors/{node_id:path}")
async def get_neighbors(node_id: str, limit: int = Query(default=50, le=200)):
    """Get neighbors of a node with connecting relationships."""
    driver = get_driver()
    nodes = []
    links = []
    seen_nodes = set()
    seen_links = set()

    with driver.session() as session:
        result = session.run(
            """
            MATCH (n)-[r]-(m)
            WHERE elementId(n) = $id
            RETURN n, elementId(n) AS nid, r, elementId(r) AS rid,
                   m, elementId(m) AS mid,
                   startNode(r) = n AS outgoing,
                   type(r) AS rel_type
            LIMIT $limit
            """,
            id=node_id,
            limit=limit,
        )
        for record in result:
            mid = record["mid"]
            rid = record["rid"]
            m = record["m"]
            r = record["r"]

            if mid not in seen_nodes:
                seen_nodes.add(mid)
                nodes.append({
                    "id": mid,
                    "labels": list(m.labels),
                    "properties": dict(m),
                })

            if rid not in seen_links:
                seen_links.add(rid)
                if record["outgoing"]:
                    source, target = node_id, mid
                else:
                    source, target = mid, node_id
                links.append({
                    "id": rid,
                    "source": source,
                    "target": target,
                    "type": record["rel_type"],
                    "properties": dict(r),
                })

    return {"nodes": nodes, "links": links}


@router.get("/api/search")
async def search_nodes(
    q: str,
    label: str | None = None,
    limit: int = Query(default=25, le=100),
):
    """Search nodes by property values containing the query string."""
    driver = get_driver()
    nodes = []

    with driver.session() as session:
        if label:
            query = f"""
                MATCH (n:`{label}`)
                WHERE any(key IN keys(n) WHERE toString(n[key]) CONTAINS $q)
                RETURN n, elementId(n) AS id
                LIMIT $limit
            """
        else:
            query = """
                MATCH (n)
                WHERE any(key IN keys(n) WHERE toString(n[key]) CONTAINS $q)
                RETURN n, elementId(n) AS id
                LIMIT $limit
            """
        result = session.run(query, q=q, limit=limit)
        for record in result:
            node = record["n"]
            nodes.append({
                "id": record["id"],
                "labels": list(node.labels),
                "properties": dict(node),
            })

    return {"nodes": nodes}
