"""Embed and append the collected scripture/PMG chunks without deleting talks.

Usage: python scripts/07_embed_import_library.py [--stage embed|import|both]
Apply 20261024000200_add_library_sources.sql before importing.
Embeddings are cached atomically per batch; stable UUIDs make upserts repeatable.
"""
import argparse
import hashlib
import json
import math
import time
import uuid
from collections import Counter
from pathlib import Path

from openai import OpenAI
from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "scripts/output/library"
MODEL = "text-embedding-3-small"
DIMENSIONS = 1536
BATCH_SIZE = 100


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def prepare_rows(chunks, documents):
    docs = {d["url"]: d for d in documents}
    rows = []
    positions = Counter()
    for chunk in chunks:
        assert chunk["source_type"] in ("scripture", "pmg")
        document = docs[chunk["url"]]
        positions[chunk["url"]] += 1
        digest = hashlib.sha256(chunk["embedding_text"].encode()).hexdigest()
        anchor = chunk.get("anchor")
        url = chunk["url"] + ("#" + anchor if anchor else "")
        title = chunk["document_title"]
        if "verse_start" in chunk:
            title += f":{chunk['verse_start']}–{chunk['verse_end']}"
        metadata = {key: chunk[key] for key in
                    ("collection", "document_title", "headings", "verse_start", "verse_end", "anchor") if key in chunk}
        metadata.update({"document_url": chunk["url"], "retrieved_at": document["retrieved_at"],
                         "embedding_model": MODEL, "embedding_input_sha256": digest})
        if document["summary"]:
            metadata["editorial_summary"] = document["summary"]
        rows.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"library:{chunk['url']}:{anchor}:{digest}")),
            "talk_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "library:" + chunk["url"])),
            "title": title, "speaker": "Preach My Gospel" if chunk["source_type"] == "pmg" else "Scriptures",
            "text": chunk["embedding_text"], "url": url,
            "sentence_num": positions[chunk["url"]], "source_type": chunk["source_type"],
            "source_metadata": metadata,
        })
    assert len({row["id"] for row in rows}) == len(rows), "Duplicate chunk IDs"
    return rows


def batches(rows):
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start:start + BATCH_SIZE]
        digest = hashlib.sha256((MODEL + ":" + ":".join(r["id"] for r in batch)).encode()).hexdigest()
        yield batch, DATA / "embedding_batches" / (digest + ".json")


def validate_batch(batch, cached):
    assert [r["id"] for r in cached] == [r["id"] for r in batch], "Cache IDs mismatch"
    for row in cached:
        vector = row.get("embedding")
        assert isinstance(vector, list) and len(vector) == DIMENSIONS
        assert all(isinstance(v, (int, float)) and math.isfinite(v) for v in vector)


def embed(rows, secrets):
    client = OpenAI(api_key=secrets["OPENAI_API_KEY"], max_retries=5, timeout=60)
    tokens = 0
    for index, (batch, cache) in enumerate(batches(rows), 1):
        if cache.exists():
            validate_batch(batch, read(cache))
        else:
            response = client.embeddings.create(model=MODEL, dimensions=DIMENSIONS,
                                                input=[r["text"] for r in batch])
            items = sorted(response.data, key=lambda item: item.index)
            assert [item.index for item in items] == list(range(len(batch)))
            cached = [{**row, "embedding": item.embedding} for row, item in zip(batch, items)]
            validate_batch(batch, cached)
            save(cache, cached)
            tokens += response.usage.total_tokens
        if index % 5 == 0 or index * BATCH_SIZE >= len(rows):
            print(f"Embeddings saved: {min(index * BATCH_SIZE, len(rows)):,}/{len(rows):,}", flush=True)
    print(f"Embedding stage complete. New API input tokens this run: {tokens:,}", flush=True)


def import_rows(rows, public, secrets):
    # Validate every batch before any database writes.
    for batch, cache in batches(rows):
        if not cache.exists():
            raise ValueError("Missing embedding batch; run embedding stage first")
        validate_batch(batch, read(cache))
    client = create_client(public["SUPABASE_URL"], secrets["SUPABASE_SERVICE_KEY"])
    for index, (batch, cache) in enumerate(batches(rows), 1):
        cached = read(cache)
        for attempt in range(4):
            try:
                client.table("sentence_embeddings").upsert(cached, on_conflict="id").execute()
                break
            except Exception:
                if attempt == 3:
                    raise RuntimeError(f"Import failed at batch {index}; saved embeddings can be reused") from None
                time.sleep(2 ** attempt)
        if index % 5 == 0 or index * BATCH_SIZE >= len(rows):
            print(f"Rows imported: {min(index * BATCH_SIZE, len(rows)):,}/{len(rows):,}", flush=True)
    # Verify exact imported IDs, not merely a count that could include duplicates.
    actual = set()
    offset = 0
    while True:
        data = client.table("sentence_embeddings").select("id").in_("source_type", ["scripture", "pmg"]) \
            .order("id").range(offset, offset + 999).execute().data
        actual.update(row["id"] for row in data)
        if len(data) < 1000:
            break
        offset += 1000
    expected = {r["id"] for r in rows}
    assert expected == actual, "Database library IDs do not match the local chunk inventory"
    print("Verified every library chunk ID in the database.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=["embed", "import", "both"], default="both")
    args = parser.parse_args()
    rows = prepare_rows(read(DATA / "chunks.json"), read(DATA / "documents.json"))
    secrets = read(ROOT / "config.secret.json")
    print(f"Library chunks: {len(rows):,}; sources: {dict(Counter(r['source_type'] for r in rows))}", flush=True)
    if args.stage in ("embed", "both"):
        embed(rows, secrets)
    if args.stage in ("import", "both"):
        import_rows(rows, read(ROOT / "config.public.json"), secrets)


if __name__ == "__main__":
    main()
