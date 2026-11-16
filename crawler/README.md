# wp-vault-crawler

Python `crawl4ai` runner that produces `.wp-sync/crawl-snapshot.json` for the TypeScript site reconciler.

```bash
cd crawler
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
crawl4ai-setup
wp-vault-crawl --site-url https://example.com --out ../vault/.wp-sync/crawl-snapshot.json
```
