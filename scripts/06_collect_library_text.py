"""Collect official English scripture and PMG text locally. No API keys or DB writes.

Run from the repository root: python scripts/06_collect_library_text.py
Completed pages are cached; reruns retry failures without redownloading successes.
"""
import hashlib
import json
import re
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

BASE = "https://www.churchofjesuschrist.org"
OUT = Path("scripts/output/library")
COLLECTIONS = {
    "ot": "Old Testament",
    "nt": "New Testament",
    "bofm": "Book of Mormon",
    "dc-testament": "Doctrine and Covenants",
    "pgp": "Pearl of Great Price",
    "pmg": "Preach My Gospel (2023, second edition; current online text)",
}
EXPECTED_CHAPTERS = {"ot": 929, "nt": 260, "bofm": 239, "dc-testament": 140, "pgp": 16}
LOCAL = threading.local()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def fetch(url):
    if not hasattr(LOCAL, "session"):
        LOCAL.session = requests.Session()
        LOCAL.session.headers["User-Agent"] = "ConferenceRAG-EducationalTextCollector/1.0"
    for attempt in range(4):
        try:
            response = LOCAL.session.get(url, timeout=30)
            response.raise_for_status()
            time.sleep(0.1)
            return BeautifulSoup(response.content, "html.parser")
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def clean(node, remove_verse_number=False):
    fragment = BeautifulSoup(str(node), "html.parser")
    selector = "sup.marker, [data-pointer-type], button, svg, .page-break, script, style"
    if remove_verse_number:
        selector += ", .verse-number"
    for unwanted in fragment.select(selector):
        unwanted.decompose()
    for br in fragment.select("br"):
        br.replace_with(" ")
    return re.sub(r"\s+", " ", fragment.get_text()).strip()


def discover(collection):
    prefix = "/study/manual/preach-my-gospel-2023" if collection == "pmg" else f"/study/scriptures/{collection}"
    soup = fetch(BASE + prefix + "?lang=eng")
    paths = set()
    for link in soup.select("a[href]"):
        parsed = urlsplit(urljoin(BASE, link["href"]))
        if parsed.netloc != urlsplit(BASE).netloc:
            continue
        path = parsed.path.rstrip("/")
        if path.startswith(prefix + "/"):
            paths.add(path)
    # Volume TOCs include nested chapter links; exclude navigation-only ancestors.
    leaves = [p for p in paths if not p.endswith("/_contents") and
              not any(other.startswith(p + "/") for other in paths)]
    return [{"collection": collection, "url": BASE + p + "?lang=eng"} for p in sorted(leaves)]


def heading_path(node, body):
    headings = []
    for ancestor in reversed(list(node.parents)):
        if ancestor is body or ancestor.name not in ("section", "figure", "aside"):
            continue
        header = ancestor.find("header", recursive=False)
        if header:
            title = header.find(["h2", "h3", "h4", "h5", "h6", "p"])
            if title and clean(title):
                headings.append(clean(title))
    return headings


def collect(entry):
    cache = OUT / "pages" / (hashlib.sha256(entry["url"].encode()).hexdigest() + ".json")
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    soup = fetch(entry["url"])
    body = soup.select_one(".body-block")
    title_node = soup.find("title")
    title = clean(title_node) if title_node else entry["url"]
    doc = {**entry, "title": title, "retrieved_at": datetime.now(timezone.utc).isoformat(),
           "summary": [], "verses": [], "blocks": []}
    if not body:
        doc["status"] = "no_body"
        save(cache, doc)
        return doc
    header = body.find_previous_sibling("header")
    if header:
        doc["summary"] = [clean(p) for p in header.select(".study-summary, .intro")]
    for verse in body.select("p.verse"):
        number = verse.select_one(".verse-number")
        if not number:
            raise ValueError("Verse missing number: " + entry["url"])
        number_text = clean(number)
        match = re.search(r"\d+", number_text)
        if not match:
            raise ValueError("Unrecognized verse number: " + number_text)
        text = clean(verse, remove_verse_number=True)
        if not text:
            raise ValueError("Empty verse: " + entry["url"])
        doc["verses"].append({"number": int(match[0]), "anchor": verse.get("id"), "text": text})
    # Preserve paragraphs, lists, tables, captions, and headings in document order.
    for node in body.find_all(["p", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "figcaption"]):
        if node.find(["p", "li", "td", "th"]):
            continue  # Child blocks are collected individually, avoiding duplication.
        if "verse" in node.get("class", []):
            continue
        text = clean(node)
        if text:
            doc["blocks"].append({"kind": node.name, "anchor": node.get("id"),
                                  "headings": heading_path(node, body), "text": text})
    doc["status"] = "ok" if doc["verses"] or doc["blocks"] else "empty_body"
    save(cache, doc)
    return doc


def chunks_for(doc):
    base = {"source_type": "pmg" if doc["collection"] == "pmg" else "scripture",
            "collection": doc["collection"], "document_title": doc["title"], "url": doc["url"]}
    if doc["verses"]:
        # Three consecutive verses, without overlap or crossing chapter boundaries.
        for start in range(0, len(doc["verses"]), 3):
            group = doc["verses"][start:start + 3]
            yield {**base, "verse_start": group[0]["number"], "verse_end": group[-1]["number"],
                   "anchor": group[0]["anchor"],
                   "text": "\n".join(f"{v['number']} {v['text']}" for v in group),
                   "embedding_text": doc["title"] + "\n" + "\n".join(f"{v['number']} {v['text']}" for v in group)}
    else:
        pending, headings = [], None
        def pack():
            text = "\n\n".join(b["text"] for b in pending)
            return {**base, "headings": headings or [], "anchor": pending[0]["anchor"], "text": text,
                    "embedding_text": "\n".join([COLLECTIONS[doc["collection"]], doc["title"], *(headings or []), text])}
        for block in doc["blocks"]:
            if block["kind"].startswith("h"):
                if pending:
                    yield pack()
                    pending = []
                continue
            if pending and (block["headings"] != headings or
                            sum(len(b["text"]) for b in pending) + len(block["text"]) > 1500):
                yield pack()
                pending = []
            headings = block["headings"]
            pending.append(block)
        if pending:
            yield pack()


def main():
    entries = []
    for collection, label in COLLECTIONS.items():
        found = discover(collection)
        print(f"Discovered {label}: {len(found)} pages", flush=True)
        entries.extend(found)
    save(OUT / "source_manifest.json", entries)
    docs, errors = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(collect, e): e for e in entries}
        for i, future in enumerate(as_completed(futures), 1):
            try:
                docs.append(future.result())
            except Exception as error:
                errors.append({**futures[future], "error": type(error).__name__})
            if i % 25 == 0 or i == len(entries):
                print(f"Collected {i}/{len(entries)} pages; failures: {len(errors)}", flush=True)
    docs.sort(key=lambda d: (d["collection"], d["url"]))
    chunks = [chunk for doc in docs if doc["status"] == "ok" for chunk in chunks_for(doc)]
    issues = list(errors)
    for collection, expected in EXPECTED_CHAPTERS.items():
        numbered = [d for d in docs if d["collection"] == collection and
                    re.search(r"/\d+\?", d["url"])]
        if len(numbered) != expected:
            issues.append({"collection": collection, "expected_chapter_pages": expected, "actual": len(numbered)})
        for doc in numbered:
            if "/od/" in doc["url"]:
                if doc["status"] != "ok":
                    issues.append({"url": doc["url"], "error": "Missing Official Declaration text"})
                continue
            numbers = [v["number"] for v in doc["verses"]]
            if not numbers or numbers != list(range(1, max(numbers) + 1)):
                issues.append({"url": doc["url"], "error": "Missing, duplicate, or nonconsecutive verses"})
    stats = {}
    for collection in COLLECTIONS:
        subset = [d for d in docs if d["collection"] == collection]
        stats[collection] = {"pages": len(subset), "text_pages": sum(d["status"] == "ok" for d in subset),
                             "verses": sum(len(d["verses"]) for d in subset),
                             "chunks": sum(c["collection"] == collection for c in chunks)}
    save(OUT / "documents.json", docs)
    save(OUT / "chunks.json", chunks)
    save(OUT / "inventory.json", {"collections": stats, "issues": issues,
                                   "non_text_pages": [{"url": d["url"], "title": d["title"], "status": d["status"]}
                                                      for d in docs if d["status"] != "ok"]})
    lines = ["# Scripture and Preach My Gospel text inventory", "", "English text from official Church website. No embeddings or database changes.",
             "", "| Collection | Pages | Text pages | Verses | Proposed chunks |", "|---|---:|---:|---:|---:|"]
    for collection, counts in stats.items():
        lines.append(f"| {COLLECTIONS[collection]} | {counts['pages']} | {counts['text_pages']} | {counts['verses']:,} | {counts['chunks']:,} |")
    lines += ["", f"Validation issues: **{len(issues)}**. See inventory.json for details.", "", "## PMG pages"]
    lines += [f"- [{d['title']}]({d['url']}) — {len(d['blocks'])} text blocks" for d in docs if d["collection"] == "pmg"]
    lines += ["", "## Scripture book coverage"]
    books = defaultdict(list)
    for doc in docs:
        if doc["verses"]:
            books["/".join(urlsplit(doc["url"]).path.split("/")[:-1])].append(doc)
    lines += [f"- {book}: {len(group)} chapters; {sum(len(d['verses']) for d in group):,} verses" for book, group in sorted(books.items())]
    lines += ["", "## Collection boundaries", "", "Includes standard-work text and linked front matter/supplemental text; labels distinguish these from numbered verses.",
              "Chapter summaries are stored separately and excluded from verse embedding text.",
              "Footnote markers are removed while preserving linked words; footnote bodies, study-help databases, audio, video, and image binaries are excluded.",
              "Abraham facsimile explanations are collected as text; images remain accessible through official links.",
              "PMG headings and paragraphs are preserved in documents.json; chunks carry ancestor section headings.",
              "Scripture chunks group three verses within a chapter. PMG blocks are grouped within headings, targeting 1,500 characters; oversized individual paragraphs stay intact."]
    (OUT / "inventory.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(stats, indent=2), flush=True)
    print(f"Validation issues: {len(issues)}; output: {OUT}", flush=True)
    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
