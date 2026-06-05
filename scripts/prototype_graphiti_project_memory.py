#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Probe Graphiti + Kuzu for Guildhall project memory.")
    parser.add_argument("--out", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--fixture", action="append", default=[])
    parser.add_argument("--skip-quality", action="store_true")
    parser.add_argument("--reuse-db", action="store_true")
    return parser.parse_args()


def read_text(path: Path):
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def task_queue_summary(project_root: Path):
    raw = read_text(project_root / ".guildhall" / "TASKS.json")
    if raw is None:
        return {"exists": False}
    parsed = json.loads(raw)
    tasks = parsed if isinstance(parsed, list) else parsed.get("tasks", [])
    field_bytes = {}
    largest = []
    status_counts = {}
    active = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        status = task.get("status", "unknown")
        title = task.get("title", "Untitled task")
        task_id = task.get("id", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        if status not in ["done", "completed", "merged", "cancelled", "archived"]:
            active.append({
                "id": task_id,
                "title": title,
                "status": status,
                "bytes": len(json.dumps(task)),
            })
        largest.append({
            "id": task_id,
            "title": title,
            "status": status,
            "bytes": len(json.dumps(task)),
        })
        for key, value in task.items():
            field_bytes[key] = field_bytes.get(key, 0) + len(json.dumps(value))
    return {
        "exists": True,
        "bytes": len(raw.encode("utf-8")),
        "taskCount": len(tasks),
        "statusCounts": status_counts,
        "activeTasks": sorted(active, key=lambda item: item["bytes"], reverse=True)[:8],
        "topFieldBytes": [
            {"field": key, "bytes": value}
            for key, value in sorted(field_bytes.items(), key=lambda item: item[1], reverse=True)[:8]
        ],
        "largestTasks": sorted(largest, key=lambda item: item["bytes"], reverse=True)[:5],
    }


def progress_summary(project_root: Path):
    raw = read_text(project_root / ".guildhall" / "PROGRESS.md")
    if raw is None:
        return {"exists": False}
    blocks = [block for block in raw.split("\n### ") if block.strip()]
    escalations = sum(1 for block in blocks if "ESCALATION" in block.upper())
    milestones = sum(1 for block in blocks if "MILESTONE" in block.upper())
    return {
        "exists": True,
        "bytes": len(raw.encode("utf-8")),
        "blocks": len(blocks),
        "escalations": escalations,
        "milestones": milestones,
        "tailPreview": ["### " + block.strip().split("\n", 1)[0] for block in blocks[-5:]],
    }


def build_episode(fixture_id: str, project_root: Path):
    tasks = task_queue_summary(project_root)
    progress = progress_summary(project_root)
    active_tasks = tasks.get("activeTasks", []) if tasks.get("exists") else []
    current_blockers = [
        f"{task['title']} ({task['id']}) remains status {task['status']} and carries {task['bytes']} bytes of local task state"
        for task in active_tasks[:5]
    ]
    next_context = [
        f"Include {task['title']} ({task['id']}) status {task['status']} only as a compact task summary with source provenance"
        for task in active_tasks[:3]
    ]
    stale_evidence = []
    if progress.get("exists"):
        stale_evidence.append(
            f"{fixture_id} PROGRESS.md has {progress['blocks']} progress blocks, {progress['escalations']} escalations, and should be compacted into current decisions plus recent evidence only"
        )
    if tasks.get("exists"):
        stale_evidence.append(
            f"{fixture_id} TASKS.json is {tasks['bytes']} bytes; heavy task history should not be copied into project-local durable task state"
        )
    body = {
        "fixture": fixture_id,
        "projectRoot": str(project_root),
        "taskQueue": tasks,
        "progress": progress,
        "currentBlockers": current_blockers,
        "staleEvidence": stale_evidence,
        "nextWorkerContext": next_context,
        "observations": [
            "Project-local Guildhall state should stay off or thin by default.",
            "Quality gate: retrieve current blockers, stale evidence, repeated churn, and related tasks.",
            f"Current blockers for {fixture_id}: " + ("; ".join(current_blockers) if current_blockers else "none found in active task statuses"),
            f"Stale or superseded evidence for {fixture_id}: " + "; ".join(stale_evidence),
            f"Next worker context for {fixture_id}: " + ("; ".join(next_context) if next_context else "compact project summary only"),
        ],
    }
    return json.dumps(body, indent=2)


def fixture_entries(raw_fixtures):
    entries = []
    for raw in raw_fixtures:
        if "=" not in raw:
            raise ValueError(f"Invalid fixture {raw!r}; expected id=/path")
        fixture_id, root = raw.split("=", 1)
        entries.append({"id": fixture_id, "projectRoot": Path(root)})
    return entries


def quality_queries():
    return [
        {
            "query": "Which project blockers are still current?",
            "expandedQueries": [
                "status blocked status exploring current blockers active tasks",
                "remains status exploring remains status blocked",
                "task status ready blocked exploring",
            ],
        },
        {
            "query": "Which evidence appears stale or superseded?",
            "expandedQueries": [
                "PROGRESS.md escalations compacted stale superseded evidence",
                "heavy task history should not be copied into project-local durable task state",
                "progress blocks escalations current decisions recent evidence only",
            ],
        },
        {
            "query": "What should enter the next worker context?",
            "expandedQueries": [
                "next worker context compact task summary source provenance",
                "include status compact task summary",
                "Project-local Guildhall state should stay off or thin by default",
            ],
        },
    ]


def query_context_packet(kuzu_db):
    import kuzu

    conn = kuzu.Connection(kuzu_db)
    try:
        context_queries = [
            {
                "label": "active-blockers",
                "query": "status exploring blocked task current blockers",
            },
            {
                "label": "stale-evidence",
                "query": "stale evidence progress logs task history compacted",
            },
            {
                "label": "next-worker-context",
                "query": "worker context compact summary source provenance",
            },
        ]
        sections = []
        for item in context_queries:
            result = conn.execute(
                "CALL QUERY_FTS_INDEX('Entity', 'node_name_and_summary', $query, TOP := 5) "
                "YIELD node, score "
                "RETURN node.name AS name, node.summary AS summary, score "
                "ORDER BY score DESC LIMIT 5",
                parameters={"query": item["query"]},
            )
            rows = list(result.rows_as_dict())
            sections.append({
                "label": item["label"],
                "query": item["query"],
                "resultCount": len(rows),
                "summaries": rows,
            })
        return {
            "strategy": "Graphiti extracted entity summaries queried with Kuzu FTS; Guildhall still owns final context-packet assembly.",
            "sections": sections,
        }
    finally:
        conn.close()


def provider_status():
    provider_keys = {
        "OPENAI_API_KEY": bool(os.environ.get("OPENAI_API_KEY")),
        "OPENAI_BASE_URL": bool(os.environ.get("OPENAI_BASE_URL")),
        "GUILDHALL_GRAPHITI_MODEL": bool(os.environ.get("GUILDHALL_GRAPHITI_MODEL")),
        "GUILDHALL_GRAPHITI_EMBEDDING_MODEL": bool(os.environ.get("GUILDHALL_GRAPHITI_EMBEDDING_MODEL")),
        "ANTHROPIC_API_KEY": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "OPENROUTER_API_KEY": bool(os.environ.get("OPENROUTER_API_KEY")),
    }
    return {
        "keys": provider_keys,
        "qualityRunnable": provider_keys["OPENAI_API_KEY"],
    }


async def probe_graphiti(db_path: str, fixtures, skip_quality: bool, reuse_db: bool):
    import graphiti_core
    import kuzu
    from graphiti_core.driver.kuzu_driver import KuzuDriver

    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    if not reuse_db and Path(db_path).exists():
        if Path(db_path).is_dir():
            shutil.rmtree(db_path)
        else:
            Path(db_path).unlink()
    kuzu_db = kuzu.Database(db_path)
    kuzu.Connection(kuzu_db)

    result = {
        "imports": {
            "graphiti_core": getattr(graphiti_core, "__version__", "unknown"),
            "kuzu": getattr(kuzu, "__version__", "unknown"),
        },
        "backend": {
            "driver": "KuzuDriver",
            "db": db_path,
            "kuzuOpened": True,
            "graphitiInitialized": False,
            "ftsIndexesCreated": False,
        },
        "quality": {
            "attempted": False,
            "blockedReason": None,
            "queries": [],
        },
    }

    status = provider_status()
    if skip_quality:
        result["quality"]["blockedReason"] = "quality run skipped by --skip-quality"
        return result
    if not status["qualityRunnable"]:
        result["quality"]["blockedReason"] = "missing OpenAI-compatible provider credentials for Graphiti LLM/embedding extraction"
        return result

    from graphiti_core import Graphiti
    from graphiti_core.driver.driver import GraphProvider
    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
    from graphiti_core.graph_queries import get_fulltext_indices
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

    driver = KuzuDriver(db=db_path)
    schema_connection = kuzu.Connection(driver.db)
    try:
        for query in get_fulltext_indices(GraphProvider.KUZU):
            schema_connection.execute(query)
        result["backend"]["ftsIndexesCreated"] = True
    finally:
        schema_connection.close()

    llm_config = LLMConfig(
        api_key=os.environ.get("OPENAI_API_KEY"),
        base_url=os.environ.get("OPENAI_BASE_URL"),
        model=os.environ.get("GUILDHALL_GRAPHITI_MODEL"),
        small_model=os.environ.get("GUILDHALL_GRAPHITI_MODEL"),
    )
    embedder_config = OpenAIEmbedderConfig(
        api_key=os.environ.get("OPENAI_API_KEY"),
        base_url=os.environ.get("OPENAI_BASE_URL"),
        embedding_model=os.environ.get("GUILDHALL_GRAPHITI_EMBEDDING_MODEL") or "BAAI/bge-m3",
        embedding_dim=1024,
    )
    graphiti = Graphiti(
        graph_driver=driver,
        llm_client=OpenAIGenericClient(config=llm_config, max_tokens=8192),
        embedder=OpenAIEmbedder(config=embedder_config),
    )
    try:
        await graphiti.build_indices_and_constraints()
        result["backend"]["graphitiInitialized"] = True
        result["quality"]["attempted"] = True
        from graphiti_core.nodes import EpisodeType

        for fixture in fixtures:
            await graphiti.add_episode(
                name=f"guildhall-{fixture['id']}-state",
                episode_body=build_episode(fixture["id"], fixture["projectRoot"]),
                source_description=f"Guildhall project-memory prototype fixture {fixture['id']}",
                source=EpisodeType.json,
                reference_time=datetime.now(timezone.utc),
            )
        for query_spec in quality_queries():
            seen = set()
            merged_results = []
            expanded_results = []
            for query in [query_spec["query"], *query_spec["expandedQueries"]]:
                search_results = await graphiti.search(query=query, num_results=5)
                normalized = [
                    {
                        "name": getattr(item, "name", None),
                        "fact": getattr(item, "fact", None),
                        "sourceNodeName": getattr(item, "source_node_name", None),
                        "targetNodeName": getattr(item, "target_node_name", None),
                    }
                    for item in search_results
                ]
                expanded_results.append({
                    "query": query,
                    "resultCount": len(normalized),
                    "results": normalized,
                })
                for item in normalized:
                    key = (item["name"], item["fact"])
                    if key in seen:
                        continue
                    seen.add(key)
                    merged_results.append(item)
            result["quality"]["queries"].append({
                "query": query_spec["query"],
                "expandedQueries": query_spec["expandedQueries"],
                "resultCount": len(merged_results),
                "results": merged_results[:10],
                "expandedResults": expanded_results,
            })
        result["quality"]["contextPacket"] = query_context_packet(driver.db)
    finally:
        await graphiti.close()
    return result


async def main():
    args = parse_args()
    fixtures = fixture_entries(args.fixture)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "python": sys.version,
        "providerStatus": provider_status(),
        "fixtures": [
            {
                "id": fixture["id"],
                "projectRoot": str(fixture["projectRoot"]),
                "taskQueue": task_queue_summary(fixture["projectRoot"]),
                "progress": progress_summary(fixture["projectRoot"]),
            }
            for fixture in fixtures
        ],
        "graphiti": None,
    }
    try:
        report["graphiti"] = await probe_graphiti(args.db, fixtures, args.skip_quality, args.reuse_db)
    except Exception as exc:
        report["graphiti"] = {
            "error": str(exc),
            "errorType": exc.__class__.__name__,
        }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"graphiti-project-memory: wrote {args.out}")
    if report["graphiti"] and "error" in report["graphiti"]:
        print(f"graphiti-project-memory: graphiti probe failed: {report['graphiti']['error']}")
        return 2
    blocked = report["graphiti"]["quality"].get("blockedReason")
    if blocked:
        print(f"graphiti-project-memory: quality blocked: {blocked}")
    else:
        print("graphiti-project-memory: quality run completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
