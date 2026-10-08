"""Parse untrusted RSS and Atom documents into the app's news-item shape."""

import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Literal
from xml.etree.ElementTree import Element

from defusedxml import ElementTree

from zeroai.schemas import NewsItem

_TAG_RE = re.compile(r"<[^>]+>")
_ATOM = "{http://www.w3.org/2005/Atom}"

FeedKind = Literal["rss", "atom"]


def _text(node: Element | None) -> str:
    return (node.text or "").strip() if node is not None else ""


def _parse_date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)  # RSS (RFC 822)
    except TypeError, ValueError:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))  # Atom (ISO 8601)
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _clean(html: str, limit: int = 400) -> str:
    return " ".join(_TAG_RE.sub(" ", html).split())[:limit]


def _is_web_link(link: str) -> bool:
    return link.lower().startswith(("http://", "https://"))


def parse_feed(xml: str, source: str) -> tuple[FeedKind, list[NewsItem]]:
    """Parse an RSS 2.0 or Atom document, dropping entries with unsafe or missing links."""
    root = ElementTree.fromstring(xml)
    kind: FeedKind = "atom" if root.tag.lower().endswith("feed") else "rss"
    items: list[NewsItem] = []
    for entry in root.iter("item"):  # RSS
        items.append(
            NewsItem(
                title=_text(entry.find("title")),
                link=_text(entry.find("link")),
                source=source,
                published=_parse_date(_text(entry.find("pubDate"))),
                snippet=_clean(_text(entry.find("description"))),
            )
        )
    for entry in root.iter(f"{_ATOM}entry"):  # Atom
        link = entry.find(f"{_ATOM}link")
        items.append(
            NewsItem(
                title=_text(entry.find(f"{_ATOM}title")),
                link=link.get("href", "") if link is not None else "",
                source=source,
                published=_parse_date(
                    _text(entry.find(f"{_ATOM}updated")) or _text(entry.find(f"{_ATOM}published"))
                ),
                snippet=_clean(_text(entry.find(f"{_ATOM}summary"))),
            )
        )
    return kind, [item for item in items if item.title and _is_web_link(item.link)]


def parse_feed_items(xml: str, source: str) -> list[NewsItem]:
    """Return just the items when a caller does not need the RSS/Atom kind."""
    return parse_feed(xml, source)[1]
