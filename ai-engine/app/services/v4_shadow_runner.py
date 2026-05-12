"""V4 Shadow Runner — orchestrates the FULL V4 pipeline for a repo.

Extracted so both the diagnostic endpoint and the /import shadow-run path
can share the same orchestration. Never raises — returns a structured
payload with `errors: []` on partial failures, `succeeded: bool` overall.

Phase 1 stages (graph + importance + patterns + ownership) populate the
top-level ``graph_stats / importance / patterns / ownership`` fields for
backward compatibility. When ``run_full_pipeline=True`` (default), Phase 2
(tagger + map) and Phase 3 (reduce + optional verify) also run, and the
full :class:`V4Output` lands under ``v4_output``.

Designed to be safe to call from a FastAPI BackgroundTasks job: all
exceptions are caught, logged, and surfaced in the output dict.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import asdict
from typing import Any, Optional

from devproof_ranking_algo import (
    GithubIngestor,
    TarballFetcher,
    build_complexity_map,
)
from devproof_ranking_algo.v4.graph_builder import build_graph
from devproof_ranking_algo.v4.importance import compute as compute_importance
from devproof_ranking_algo.v4.ownership import compute as compute_ownership
from devproof_ranking_algo.v4.pattern_detectors import detect_all as detect_patterns

from app.config import get_settings

log = logging.getLogger(__name__)

_README_CANDIDATES = (
    "README.md", "readme.md", "Readme.md", "README.MD",
    "README.rst", "readme.rst",
    "README", "readme",
    "README.txt", "readme.txt",
)

_OWNERSHIP_TOP_N = 20

# Default: verify only claims below this confidence. Mirrors verify_phase default.
_VERIFY_CONFIDENCE_THRESHOLD = 0.70


def _parse_owner_repo(repo_url: str) -> Optional[tuple[str, str]]:
    """Extract (owner, repo). Returns None on invalid input."""
    match = re.search(r"github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$", repo_url)
    return (match.group(1), match.group(2)) if match else None


def _find_readme(file_map: dict[str, str]) -> str:
    for name in _README_CANDIDATES:
        if name in file_map:
            return file_map[name]
    for path, content in file_map.items():
        if "/" not in path and path.lower().startswith("readme"):
            return content
    return ""


def _pattern_to_dict(p: Any) -> dict[str, Any]:
    d = asdict(p)
    kind = d.get("kind")
    if hasattr(kind, "value"):
        d["kind"] = kind.value
    elif not isinstance(kind, str):
        d["kind"] = str(kind)
    return d


def _ownership_to_dict(o: Any) -> dict[str, Any]:
    return {
        "score": o.score,
        "signals": asdict(o.signals),
        "weights_used": dict(o.weights_used),
        "evidence": dict(o.evidence),
    }


def _graph_stats(graph: Any) -> dict[str, Any]:
    return {
        "files": len(graph.file_list),
        "symbols": len(graph.symbols),
        "reference_edges": graph.references.number_of_edges(),
        "import_edges": graph.imports.number_of_edges(),
        "coverage": graph.coverage_stats(),
    }


def _build_gemini_client() -> Any:
    """Construct a google.genai Client from settings. Returns None on failure.

    Imports are lazy so unit tests that patch ``run_v4`` never need the real
    ``google.genai`` package installed.
    """
    try:
        from google import genai  # type: ignore
    except Exception as e:  # noqa: BLE001
        log.warning("[v4-shadow] google.genai import failed: %s", e)
        return None
    try:
        api_key = get_settings().gemini_api_key
    except Exception as e:  # noqa: BLE001
        log.warning("[v4-shadow] gemini_api_key missing in settings: %s", e)
        return None
    if not api_key:
        return None
    try:
        return genai.Client(api_key=api_key)
    except Exception as e:  # noqa: BLE001
        log.warning("[v4-shadow] genai.Client init failed: %s", e)
        return None


async def run_v4(
    repo_url: str,
    github_username: Optional[str] = None,
    *,
    run_full_pipeline: bool = True,
    enable_verify: bool = True,
    cached_tagger_result: Any = None,
    cached_map_result: Any = None,
    return_intermediates: bool = False,
    hackathon_mode: bool = False,
) -> dict[str, Any]:
    """Run the V4 pipeline on a repo and return a structured payload.

    Never raises. Tarball fetch failure yields a payload with ``succeeded=False``
    and the error in ``errors[]``. Per-stage failures are collected similarly.

    Args:
        repo_url: GitHub URL, e.g. ``https://github.com/owner/repo``.
        github_username: if provided, compute ownership score for this author.
        run_full_pipeline: when True (default), runs tag + map + reduce (and
            verify if ``enable_verify``). When False, only Phase 1 runs — the
            legacy behaviour — and ``v4_output`` stays ``None``.
        enable_verify: gate the tool-calling verify phase. More expensive than
            reduce, so shadow mode keeps it off; diagnostic mode turns it on.
        cached_tagger_result: if provided, skip the tagger stage and use this
            instead. Saves ~20s of Flash calls. Must be paired with
            ``cached_map_result`` — if only one is provided, both stages re-run.
        cached_map_result: if provided alongside ``cached_tagger_result``, skip
            the map stage. Saves ~100s of parallel Flash calls.
        return_intermediates: when True, the result dict includes an
            ``_intermediates`` key with the raw (non-JSON-serializable)
            ``TaggerResult`` and ``MapPhaseResult`` objects so a caller can
            persist them to a tier-1 cache. Callers MUST strip this key
            before JSON-serializing the result.

    Returns:
        Dict with keys: repo_url, commit_sha, pipeline_version, latency_ms,
        graph_stats, importance, patterns, ownership, v4_output, errors,
        succeeded, cache_reused (dict of which stages came from cache).
    """
    pipeline_version = "v4-phase3" if run_full_pipeline else "v4-phase1"
    # Only honour caches when BOTH are supplied — a partial resume would
    # mean tagger and map ran on different sources-of-truth.
    have_cached_intermediates = (
        cached_tagger_result is not None and cached_map_result is not None
    )

    result: dict[str, Any] = {
        "repo_url": repo_url,
        "commit_sha": None,
        "pipeline_version": pipeline_version,
        "latency_ms": {},
        "graph_stats": None,
        "importance": None,
        "patterns": [],
        "ownership": None,
        "v4_output": None,
        "errors": [],
        "succeeded": False,
        "cache_reused": {
            "tagger": have_cached_intermediates,
            "map": have_cached_intermediates,
        },
    }
    errors: list[str] = result["errors"]
    latency: dict[str, int] = result["latency_ms"]
    t_total = time.perf_counter()

    # Hoisted so ``return_intermediates`` handling always sees bound names
    # regardless of which branches executed.
    tagger_result: Any = None
    map_result: Any = None

    # 1. Parse owner/repo
    parsed = _parse_owner_repo(repo_url)
    if parsed is None:
        errors.append("invalid_repo_url")
        return result
    owner, repo_name = parsed

    # 2. GitHub client
    try:
        ingestor = GithubIngestor()
    except Exception as e:  # noqa: BLE001
        errors.append(f"github_client_init: {e}")
        log.warning("[v4-shadow] GithubIngestor init failed: %s", e)
        return result

    # 3. Tarball fetch — required
    t0 = time.perf_counter()
    file_map: dict[str, str] = {}
    try:
        fetcher = TarballFetcher(github_token=ingestor.token)
        with fetcher.fetch(owner, repo_name) as repo_files:
            file_map = dict(repo_files.file_map)
    except Exception as e:  # noqa: BLE001
        errors.append(f"tarball_fetch: {e}")
        log.warning("[v4-shadow] tarball fetch failed %s/%s: %s", owner, repo_name, e)
        latency["tarball_fetch"] = int((time.perf_counter() - t0) * 1000)
        return result
    latency["tarball_fetch"] = int((time.perf_counter() - t0) * 1000)

    # 4. HEAD commit SHA — best-effort
    repo_obj = None
    try:
        repo_obj = ingestor.get_repo(f"{owner}/{repo_name}")
        result["commit_sha"] = repo_obj.get_commits()[0].sha
    except Exception as e:  # noqa: BLE001
        errors.append(f"commit_sha_resolve: {e}")
        log.warning("[v4-shadow] HEAD sha resolve failed: %s", e)

    # 5. Complexity map — feeds importance
    t0 = time.perf_counter()
    complexity_map: list[dict] = []
    try:
        complexity_map = build_complexity_map(file_map)
    except Exception as e:  # noqa: BLE001
        errors.append(f"complexity_map: {e}")
        log.warning("[v4-shadow] complexity map failed: %s", e)
    complexity_ms = int((time.perf_counter() - t0) * 1000)

    # 6. Graph build
    t0 = time.perf_counter()
    graph = None
    try:
        graph = build_graph(file_map)
        result["graph_stats"] = _graph_stats(graph)
    except Exception as e:  # noqa: BLE001
        errors.append(f"graph_build: {e}")
        log.error("[v4-shadow] graph build failed: %s", e)
    latency["graph_build"] = int((time.perf_counter() - t0) * 1000) + complexity_ms

    # 7. Importance
    t0 = time.perf_counter()
    top_20_paths: list[str] = []
    imp = None
    readme_content = _find_readme(file_map)
    if graph is not None:
        try:
            imp = compute_importance(graph, file_map, readme_content, complexity_map)
            top_20 = imp.ranked[:20]
            top_20_paths = [r.file for r in top_20]
            result["importance"] = {
                "top_20": [asdict(rf) for rf in top_20],
                "core_set_size": len(imp.core_set),
                "periphery_size": len(imp.periphery),
                "guaranteed_inclusions": list(imp.guaranteed_inclusions),
                "weights_used": dict(imp.weights_used),
            }
        except Exception as e:  # noqa: BLE001
            errors.append(f"importance: {e}")
            log.warning("[v4-shadow] importance failed: %s", e)
    latency["importance"] = int((time.perf_counter() - t0) * 1000)

    # 8. Patterns
    t0 = time.perf_counter()
    detected_patterns: list = []
    if graph is not None:
        try:
            detected_patterns = list(detect_patterns(graph, file_map))
            result["patterns"] = [_pattern_to_dict(p) for p in detected_patterns]
        except Exception as e:  # noqa: BLE001
            errors.append(f"patterns: {e}")
            log.warning("[v4-shadow] patterns failed: %s", e)
    latency["patterns"] = int((time.perf_counter() - t0) * 1000)

    # 9. Ownership (optional)
    ownership_result = None
    if github_username and repo_obj is not None:
        t0 = time.perf_counter()
        try:
            ownership_result = compute_ownership(
                repo_obj,
                github_username,
                importance_ranked_files=top_20_paths[:_OWNERSHIP_TOP_N] or None,
            )
            result["ownership"] = _ownership_to_dict(ownership_result)
        except Exception as e:  # noqa: BLE001
            errors.append(f"ownership: {e}")
            log.warning("[v4-shadow] ownership failed: %s", e)
        latency["ownership"] = int((time.perf_counter() - t0) * 1000)

    # 10. Full pipeline (tagger + map + reduce + optional verify)
    phase1_ok = result["graph_stats"] is not None and result["importance"] is not None

    if run_full_pipeline and phase1_ok and graph is not None and imp is not None:
        # Import V4 phase modules lazily so Phase-1-only paths don't need them.
        from devproof_ranking_algo.v4 import map_phase, reduce_phase, tagger, verify_phase

        client = _build_gemini_client()
        if client is None:
            errors.append("gemini_client_init: no client available (missing key or SDK)")
            log.warning("[v4-shadow] skipping Phase 2/3 — no Gemini client")
        else:
            # 10a. Tagger — skip if cached intermediates supplied
            t0 = time.perf_counter()
            tagger_result = None
            if have_cached_intermediates:
                tagger_result = cached_tagger_result
                log.info("[v4-shadow] tagger: reusing cached result (%d tags)",
                         len(tagger_result.tags))
            else:
                try:
                    tagger_result = await tagger.tag_all(file_map, graph, client)
                except Exception as e:  # noqa: BLE001
                    errors.append(f"tag: {e}")
                    log.warning("[v4-shadow] tagger failed: %s", e)
            latency["tag"] = int((time.perf_counter() - t0) * 1000)

            # 10b. Map phase — skip if cached intermediates supplied
            t0 = time.perf_counter()
            map_result = None
            if have_cached_intermediates:
                map_result = cached_map_result
                log.info("[v4-shadow] map: reusing cached result (%d chunks)",
                         len(map_result.chunks))
            elif tagger_result is not None:
                try:
                    file_tags = {t.file_path: t for t in tagger_result.tags}
                    map_result = await map_phase.run(
                        imp.core_set,
                        file_map,
                        graph,
                        client,
                        file_tags=file_tags,
                    )
                except Exception as e:  # noqa: BLE001
                    errors.append(f"map: {e}")
                    log.warning("[v4-shadow] map failed: %s", e)
            latency["map"] = int((time.perf_counter() - t0) * 1000)

            # 10c. Reduce
            t0 = time.perf_counter()
            v4_output = None
            if tagger_result is not None and map_result is not None:
                try:
                    v4_output = await reduce_phase.reduce(
                        repo_url=repo_url,
                        commit_sha=result.get("commit_sha"),
                        applicant_username=github_username,
                        file_map=file_map,
                        graph=graph,
                        importance=imp,
                        patterns=detected_patterns,
                        ownership=ownership_result,
                        tagger_result=tagger_result,
                        map_phase_result=map_result,
                        gemini_client=client,
                        hackathon_mode=hackathon_mode,
                    )
                except Exception as e:  # noqa: BLE001
                    # reduce_phase has its own fallback; this guards truly
                    # uncaught exceptions (e.g. import-time bugs).
                    errors.append(f"reduce: {e}")
                    log.error("[v4-shadow] reduce raised uncaught: %s", e)
            latency["reduce"] = int((time.perf_counter() - t0) * 1000)

            # 10d. Verify — gated by flag AND low-confidence claims present.
            t0 = time.perf_counter()
            if v4_output is not None and enable_verify:
                low_conf = any(
                    c.confidence < _VERIFY_CONFIDENCE_THRESHOLD
                    for c in v4_output.claims
                )
                if low_conf:
                    try:
                        v4_output = await verify_phase.verify(
                            v4_output,
                            file_map,
                            graph,
                            client,
                            confidence_threshold=_VERIFY_CONFIDENCE_THRESHOLD,
                        )
                    except Exception as e:  # noqa: BLE001
                        errors.append(f"verify: {e}")
                        log.warning("[v4-shadow] verify failed: %s", e)
            latency["verify"] = int((time.perf_counter() - t0) * 1000)

            if v4_output is not None:
                try:
                    result["v4_output"] = v4_output.model_dump(mode="json")
                except Exception as e:  # noqa: BLE001
                    errors.append(f"v4_output_serialize: {e}")
                    log.warning("[v4-shadow] v4_output serialize failed: %s", e)

    # Overall success:
    # - Phase-1-only mode: graph + importance both landed.
    # - Full pipeline: also require a v4_output (which reduce's fallback
    #   guarantees when all upstream inputs existed).
    if run_full_pipeline:
        result["succeeded"] = phase1_ok and result["v4_output"] is not None
    else:
        result["succeeded"] = phase1_ok

    latency["total"] = int((time.perf_counter() - t_total) * 1000)

    # Optionally surface raw intermediates for cache persistence. Not
    # JSON-serializable — callers must strip this key before serialization.
    if return_intermediates:
        result["_intermediates"] = {
            "tagger_result": tagger_result if run_full_pipeline and not have_cached_intermediates else None,
            "map_result": map_result if run_full_pipeline and not have_cached_intermediates else None,
        }

    log.info(
        "[v4-shadow] %s/%s -> succeeded=%s, total=%dms, errors=%d, full=%s, cache=%s",
        owner, repo_name, result["succeeded"], latency["total"],
        len(errors), run_full_pipeline, result["cache_reused"],
    )
    return result


# ─── Cache-aware wrapper ─────────────────────────────────────────────────────

async def run_v4_cached(
    repo_url: str,
    github_username: Optional[str],
    db_session_factory,
    *,
    run_full_pipeline: bool = True,
    enable_verify: bool = True,
    hackathon_mode: bool = False,
) -> dict[str, Any]:
    """Run the V4 pipeline with two-tier cache support.

    Flow:
    1. Compute ``code_hash`` via the Trees API (applicant-agnostic fingerprint).
    2. Tier-2 check: ``(repo_url, code_hash, applicant_username)`` — if hit,
       return a synthetic result with ``v4_output`` populated and
       ``cache_reused.tier2 = True``. No pipeline work.
    3. Tier-1 check: ``(repo_url, code_hash)`` — if hit, pass cached
       ``tagger_result`` + ``map_result`` to ``run_v4`` to skip LLM stages.
    4. After a successful fresh run, write both tiers.

    If ``code_hash`` can't be computed (rate limits, permission errors) the
    whole caching layer is bypassed and a fresh run_v4 executes.

    Args:
        db_session_factory: zero-arg callable returning a SQLAlchemy session.
            Accepts a factory (not a session directly) because cache reads
            and writes may span long-running pipeline work; taking a fresh
            session per DB interaction avoids holding connections idle.

    Returns:
        Same shape as ``run_v4``. Adds ``cache_reused.tier2`` bool and
        ``code_hash`` to the top-level dict for observability.
    """
    # Lazy imports so unit tests can patch run_v4 without pulling in the
    # full SQLAlchemy stack.
    from app.services.cache_service import get_repo_code_hash
    from app.services.v4_cache_service import V4CacheService, V4CodeCacheService

    code_hash: Optional[str] = None
    try:
        ingestor = GithubIngestor()
        code_hash = get_repo_code_hash(ingestor, repo_url)
    except Exception as e:  # noqa: BLE001
        log.warning("[v4-shadow] code_hash compute failed, bypassing cache: %s", e)

    # Tier-2 check — instant return on hit. Skipped entirely in hackathon
    # mode: hackathon-mode rescales the score (drops forensics, scales to 100),
    # so reusing or writing tier-2 entries would mix incompatible scores
    # across hackathon and standalone audits of the same (repo, applicant).
    if code_hash and github_username and not hackathon_mode:
        try:
            with db_session_factory() as db:
                cached_output = V4CacheService.get(
                    db, repo_url, code_hash, github_username,
                )
        except Exception as e:  # noqa: BLE001
            log.warning("[v4-shadow] tier2 read failed: %s", e)
            cached_output = None

        if cached_output is not None:
            log.info("[v4-shadow] tier2 HIT for %s / %s", repo_url, github_username)
            return {
                "repo_url": repo_url,
                "commit_sha": None,
                "pipeline_version": "v4-phase3-cached",
                "latency_ms": {"total": 0, "cache_lookup": 0},
                "graph_stats": None,
                "importance": None,
                "patterns": [],
                "ownership": None,
                "v4_output": cached_output,
                "errors": [],
                "succeeded": True,
                "cache_reused": {"tagger": True, "map": True, "tier2": True},
                "code_hash": code_hash,
            }

    # Tier-1 check — fetch cached LLM intermediates if available
    cached_tagger, cached_map = None, None
    if code_hash:
        try:
            with db_session_factory() as db:
                tier1_hit = V4CodeCacheService.get(db, repo_url, code_hash)
        except Exception as e:  # noqa: BLE001
            log.warning("[v4-shadow] tier1 read failed: %s", e)
            tier1_hit = None

        if tier1_hit is not None:
            cached_tagger, cached_map = tier1_hit
            log.info("[v4-shadow] tier1 HIT for %s", repo_url)

    # Full run — passes cached intermediates when available, asks for raw
    # intermediates back so we can write them to the cache afterwards.
    result = await run_v4(
        repo_url,
        github_username,
        run_full_pipeline=run_full_pipeline,
        enable_verify=enable_verify,
        cached_tagger_result=cached_tagger,
        cached_map_result=cached_map,
        return_intermediates=True,
        hackathon_mode=hackathon_mode,
    )
    result["code_hash"] = code_hash
    result["cache_reused"]["tier2"] = False

    # Cache writes — best-effort, never fail the request
    if code_hash and result.get("succeeded"):
        intermediates = result.pop("_intermediates", None) or {}
        fresh_tagger = intermediates.get("tagger_result")
        fresh_map = intermediates.get("map_result")
        v4_output = result.get("v4_output")

        # Tier-1: only write when we freshly computed both (not on cache resume)
        if fresh_tagger is not None and fresh_map is not None:
            try:
                with db_session_factory() as db:
                    V4CodeCacheService.put(
                        db, repo_url, code_hash, fresh_tagger, fresh_map,
                    )
            except Exception as e:  # noqa: BLE001
                log.warning("[v4-shadow] tier1 write failed: %s", e)

        # Tier-2: write any successful per-applicant output. Skipped in
        # hackathon mode for the same collision reason as the read path.
        if github_username and v4_output and not hackathon_mode:
            try:
                with db_session_factory() as db:
                    V4CacheService.put(
                        db, repo_url, code_hash, github_username, v4_output,
                    )
            except Exception as e:  # noqa: BLE001
                log.warning("[v4-shadow] tier2 write failed: %s", e)
    else:
        # Strip intermediates even on failure so callers never see the
        # non-JSON-serializable objects.
        result.pop("_intermediates", None)

    return result
