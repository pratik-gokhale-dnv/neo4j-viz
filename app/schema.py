from app.database import get_driver

_schema = None


def analyze_schema():
    """Discover graph schema: node labels, relationship types, and properties per label."""
    global _schema
    driver = get_driver()

    labels = []
    relationship_types = []
    label_properties = {}
    rel_properties = {}
    label_counts = {}
    rel_counts = {}

    with driver.session() as session:
        # Get all node labels
        result = session.run("CALL db.labels()")
        labels = [record["label"] for record in result]

        # Get all relationship types
        result = session.run("CALL db.relationshipTypes()")
        relationship_types = [record["relationshipType"] for record in result]

        # Get property keys per label (sample up to 100 nodes per label)
        for label in labels:
            props = set()
            result = session.run(
                f"MATCH (n:`{label}`) RETURN keys(n) AS keys LIMIT 100"
            )
            for record in result:
                props.update(record["keys"])
            label_properties[label] = sorted(props)

        # Get property keys per relationship type
        for rel_type in relationship_types:
            props = set()
            result = session.run(
                f"MATCH ()-[r:`{rel_type}`]->() RETURN keys(r) AS keys LIMIT 100"
            )
            for record in result:
                props.update(record["keys"])
            rel_properties[rel_type] = sorted(props)

        # Get node counts per label
        for label in labels:
            result = session.run(
                f"MATCH (n:`{label}`) RETURN count(n) AS cnt"
            )
            label_counts[label] = result.single()["cnt"]

        # Get relationship counts per type
        for rel_type in relationship_types:
            result = session.run(
                f"MATCH ()-[r:`{rel_type}`]->() RETURN count(r) AS cnt"
            )
            rel_counts[rel_type] = result.single()["cnt"]

    _schema = {
        "labels": labels,
        "relationship_types": relationship_types,
        "label_properties": label_properties,
        "rel_properties": rel_properties,
        "label_counts": label_counts,
        "rel_counts": rel_counts,
    }
    return _schema


def get_schema():
    return _schema
