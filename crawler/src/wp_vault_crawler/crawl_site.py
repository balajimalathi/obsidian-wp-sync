"""Crawl a site with crawl4ai and write crawl-snapshot.json."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def same_origin(base: str, candidate: str) -> bool:
    b = urlparse(base)
    c = urlparse(candidate)
    return (b.scheme, b.netloc) == (c.scheme, c.netloc)


async def fetch_sitemap_urls(site_url: str) -> list[str]:
    import urllib.request

    candidates = [
        urljoin(site_url.rstrip("/") + "/", "sitemap.xml"),
        urljoin(site_url.rstrip("/") + "/", "wp-sitemap.xml"),
        urljoin(site_url.rstrip("/") + "/", "sitemap_index.xml"),
    ]
    urls: list[str] = []
    for sitemap_url in candidates:
        try:
            with urllib.request.urlopen(sitemap_url, timeout=30) as resp:
                data = resp.read()
            root = ElementTree.fromstring(data)
            ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
            for loc in root.findall(".//sm:loc", ns):
                if loc.text:
                    urls.append(loc.text.strip())
            # Nested sitemap indexes
            for loc in root.findall(".//sm:sitemap/sm:loc", ns):
                if loc.text:
                    nested = loc.text.strip()
                    try:
                        with urllib.request.urlopen(nested, timeout=30) as resp:
                            nested_data = resp.read()
                        nested_root = ElementTree.fromstring(nested_data)
                        for nested_loc in nested_root.findall(".//sm:loc", ns):
                            if nested_loc.text:
                                urls.append(nested_loc.text.strip())
                    except Exception:
                        continue
            if urls:
                break
        except Exception:
            continue
    return [normalize_url(u) for u in urls if same_origin(site_url, u)]


async def crawl_site(site_url: str, max_pages: int = 500) -> dict:
    from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
    from crawl4ai.content_filter_strategy import PruningContentFilter
    from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

    seed_urls = await fetch_sitemap_urls(site_url)
    if not seed_urls:
        seed_urls = [normalize_url(site_url)]

    md_generator = DefaultMarkdownGenerator(
        content_filter=PruningContentFilter(threshold=0.48, threshold_type="fixed")
    )
    config = CrawlerRunConfig(
        markdown_generator=md_generator,
        exclude_external_links=True,
    )

    pages: list[dict] = []
    seen: set[str] = set()
    queue: list[str] = list(dict.fromkeys(seed_urls))

    async with AsyncWebCrawler() as crawler:
        while queue and len(pages) < max_pages:
            url = queue.pop(0)
            norm = normalize_url(url)
            if norm in seen:
                continue
            seen.add(norm)
            try:
                result = await crawler.arun(url=url, config=config)
            except Exception as exc:
                pages.append(
                    {
                        "url": norm,
                        "status": "error",
                        "error": str(exc),
                        "title": None,
                        "markdown": None,
                        "links": [],
                        "images": [],
                    }
                )
                continue

            links: list[str] = []
            images: list[str] = []
            if result.links:
                for link in result.links.get("internal", []) or []:
                    href = link.get("href") if isinstance(link, dict) else str(link)
                    if href and same_origin(site_url, href):
                        n = normalize_url(href)
                        links.append(n)
                        if n not in seen:
                            queue.append(n)
            if getattr(result, "media", None):
                for img in (result.media.get("images") or []):
                    src = img.get("src") if isinstance(img, dict) else None
                    if src:
                        images.append(src)

            markdown = None
            if result.markdown:
                markdown = getattr(result.markdown, "fit_markdown", None) or str(
                    result.markdown
                )

            pages.append(
                {
                    "url": norm,
                    "status": "ok" if result.success else "error",
                    "error": None if result.success else (result.error_message or "crawl failed"),
                    "title": result.metadata.get("title") if result.metadata else None,
                    "markdown": markdown,
                    "links": sorted(set(links)),
                    "images": sorted(set(images)),
                }
            )

    return {
        "site_url": normalize_url(site_url),
        "crawled_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "page_count": len(pages),
        "pages": pages,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crawl a site into crawl-snapshot.json")
    parser.add_argument("--site-url", required=True, help="Base site URL")
    parser.add_argument("--out", required=True, help="Output JSON path")
    parser.add_argument("--max-pages", type=int, default=500)
    args = parser.parse_args(argv)

    snapshot = asyncio.run(crawl_site(args.site_url, max_pages=args.max_pages))
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print(f"Wrote {snapshot['page_count']} pages to {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
