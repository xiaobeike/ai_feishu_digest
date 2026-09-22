import ipaddress
import os
from urllib.parse import urlsplit


_PRIVATE_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".home.arpa")

# Webhook targets are matched against a literal allowlist so a tampered or
# mistyped URL cannot point a push at an internal service. Extra hosts can be
# added with WEBHOOK_HOST_ALLOWLIST (comma separated).
DEFAULT_WEBHOOK_HOSTS = ("open.feishu.cn", "open.larksuite.com", "qyapi.weixin.qq.com")


def webhook_hosts() -> tuple[str, ...]:
    extra = tuple(
        part.strip().lower()
        for part in os.environ.get("WEBHOOK_HOST_ALLOWLIST", "").split(",")
        if part.strip()
    )
    return DEFAULT_WEBHOOK_HOSTS + extra


def assert_public_http_url(url: str) -> str:
    """Reject anything that is not a plain http/https request to a public host."""

    parts = urlsplit((url or "").strip())
    if parts.scheme not in ("http", "https"):
        raise ValueError(f"Unsupported URL scheme: {parts.scheme or '(none)'}")

    host = (parts.hostname or "").strip().lower()
    if not host:
        raise ValueError(f"URL has no host: {url}")
    if host == "localhost" or host.endswith(_PRIVATE_HOST_SUFFIXES):
        raise ValueError(f"Refusing to request non-public host: {host}")

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return url  # a DNS name; it is resolved when the request is made
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
        raise ValueError(f"Refusing to request non-public host: {host}")
    return url


def assert_url_within(url: str, base_url: str) -> str:
    """Pin a composed URL to the base host, then require it to be public http(s)."""

    expected = (urlsplit(base_url).hostname or "").lower()
    actual = (urlsplit((url or "").strip()).hostname or "").lower()
    if not expected or actual != expected:
        raise ValueError(f"Refusing to request unexpected host: {actual or '(none)'}")
    return assert_public_http_url(url)
