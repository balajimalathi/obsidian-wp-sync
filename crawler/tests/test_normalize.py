from wp_vault_crawler.crawl_site import normalize_url, same_origin


def test_normalize_url_strips_trailing_slash():
    assert normalize_url("https://example.com/blog/") == "https://example.com/blog"


def test_normalize_url_root():
    assert normalize_url("https://example.com/") == "https://example.com/"


def test_same_origin():
    assert same_origin("https://example.com", "https://example.com/a")
    assert not same_origin("https://example.com", "https://other.com/a")
