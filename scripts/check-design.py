#!/usr/bin/env python3
"""Structural checks for the `design/` wireframes.

**Read this when:** you have edited anything under `design/`, or you are about to
change how a wireframe is structured.

There is no test harness for these files — they are hand-authored static HTML with
no build step (see `docs/conventions/design-wireframes.md`), so the conventions in
that document had no enforcement at all. This is that enforcement, and it exists
because the conventions it checks are exactly the ones that drifted: a note left
describing a page that no longer matches reality is the failure mode the whole
directory is written to avoid ("a stale wireframe is worse than none"), and a
broken inter-page link is invisible until a human happens to click it.

Three checks, one per convention:

1. **Links resolve.** `design/README.md` requires root-absolute links between
   pages (`/projects/index.html`), so they are resolved against `design/` rather
   than the filesystem root — which is the trap: it is easy to write a link that
   looks right and 404s under the local static server the README tells you to use.
   Anchors, external URLs, and `mailto:` are skipped.
2. **Every page keeps a `.design-note`.** The convention requires one on every
   page, hidden by CSS so the page previews like the live site. `design/index.html`
   is the sitemap and is exempt (it is a list of links, not a mock of a route).
3. **Class names are defined somewhere.** A class used in a page must be defined
   in that page's own inline `<style>`, or in `shared/tokens.css` /
   `shared/shell.css`. An undefined class is a silent no-op: the page renders,
   slightly wrong, and only someone who knows the intended design will notice.
4. **Tags are balanced.** A wireframe is HTML with no build step, so a botched
   edit — a replacement that caught part of a tag, a stray closing tag — renders
   as mangled markup with nothing to catch it. This check exists because that
   happened: a `.design-note` edit that matched too little text left the tail of
   the old sentence dangling after the closing quote, and every other check still
   passed (the link target it contained happened to be valid).

Run from the meta repo root:

    python3 scripts/check-design.py

Exits non-zero and lists every problem, so it can gate a change. Deliberately
dependency-free (no `bs4`): the pages are regular enough for the standard library,
and a checker nobody can run without installing something is a checker nobody runs.
"""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

DESIGN = Path(__file__).resolve().parent.parent / "design"
SHARED_CSS = ["shared/tokens.css", "shared/shell.css"]

# `design/index.html` is the sitemap: a page listing every wireframe. It has no
# route to mock, so the note convention does not apply to it.
NOTE_EXEMPT = {"index.html"}

# SVG fragments and the like carry `class=` attributes whose names are local to
# an `<svg>` block, not part of the page's CSS vocabulary. They are rare here; the
# check is written against `<style>` content and the shared sheets, so anything
# genuinely undefined still gets caught, and this list stays empty unless a real
# false positive shows up.
CLASS_IGNORE: set[str] = set()


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def page_files() -> list[Path]:
    return sorted(p for p in DESIGN.rglob("*.html"))


def extract_attr(text: str, attr: str) -> list[str]:
    return re.findall(rf'{attr}\s*=\s*"([^"]*)"', text, re.I)


def is_external(href: str) -> bool:
    return bool(re.match(r"^(https?:|mailto:|tel:|data:|#|javascript:)", href, re.I))


def resolve_link(href: str, page: Path) -> Path | None:
    """Resolve an href to a file under `design/`, or None if it is not a page/CSS link."""
    href = href.split("#", 1)[0].split("?", 1)[0]
    if not href:
        return None
    if href.startswith("/"):
        # Root-absolute, resolved against design/ — this is the convention, and
        # the reason the README insists on serving the directory rather than
        # opening files via file://.
        return (DESIGN / href.lstrip("/")).resolve()
    return (page.parent / href).resolve()


def check_links(files: list[Path]) -> list[str]:
    problems: list[str] = []
    for page in files:
        text = read(page)
        for href in extract_attr(text, "href") + extract_attr(text, "src"):
            if is_external(href):
                continue
            target = resolve_link(href, page)
            if target is None:
                continue
            if not target.exists():
                rel = page.relative_to(DESIGN)
                problems.append(f"{rel}: link target does not exist -> {href}")
    return problems


def check_notes(files: list[Path]) -> list[str]:
    problems: list[str] = []
    for page in files:
        rel = page.relative_to(DESIGN)
        if str(rel) in NOTE_EXEMPT:
            continue
        if 'class="design-note"' not in read(page):
            problems.append(f"{rel}: missing .design-note (required by design-wireframes.md)")
    return problems


def defined_classes() -> set[str]:
    """Every class defined in the shared stylesheets."""
    defined: set[str] = set()
    for rel in SHARED_CSS:
        path = DESIGN / rel
        if not path.exists():
            continue
        css = read(path)
        # Strip comments so a class name mentioned in prose is not counted.
        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        for selector in re.findall(r"([^{}]+)\{", css):
            defined.update(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", selector))
    return defined


def local_classes(page: Path) -> set[str]:
    defined: set[str] = set()
    for block in re.findall(r"<style[^>]*>(.*?)</style>", read(page), re.S):
        block = re.sub(r"/\*.*?\*/", "", block, flags=re.S)
        for selector in re.findall(r"([^{}]+)\{", block):
            defined.update(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", selector))
    return defined


def used_classes(page: Path) -> set[str]:
    used: set[str] = set()
    for value in extract_attr(read(page), "class"):
        for name in html.unescape(value).split():
            used.add(name)
    return used


def check_classes(files: list[Path]) -> list[str]:
    shared = defined_classes()
    problems: list[str] = []
    for page in files:
        local = local_classes(page)
        for name in sorted(used_classes(page) - local - shared - CLASS_IGNORE):
            rel = page.relative_to(DESIGN)
            problems.append(f"{rel}: class not defined locally or in shared CSS -> .{name}")
    return problems


# Elements that are routinely written without a closing tag in HTML, so counting
# opening and closing forms would report a false imbalance everywhere.
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}

# Only these are written without a closing tag in HTML, so they are excluded from
# the balance check.
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


def check_structure(files: list[Path]) -> list[str]:
    """Every non-void tag balances.

    Deliberately checks *all* tags rather than a curated block list: this was
    first written for `div`/`section`/… only, and the same negative test that
    motivated the check walked straight through it — the corruption that actually
    happened left a stray `</a>` behind, and `a` was not on the list. Verified to
    report nothing across the whole directory as it stands, so the broad form
    costs no false positives and covers the inline tags too. HTML's optional
    closing tags (`</p>`, `</li>`) are not used anywhere in these files, which is
    what makes the broad form safe.
    """
    problems: list[str] = []
    for page in files:
        text = read(page)
        # Strip comments and the contents of <style>/<script>, so a `</div>` in a
        # comment or a string is not counted as markup.
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        text = re.sub(r"<(style|script)[^>]*>.*?</\1>", "", text, flags=re.S | re.I)

        opens: dict[str, int] = {}
        closes: dict[str, int] = {}
        for slash, name, attrs in re.findall(r"<(/?)([a-zA-Z][\w-]*)([^>]*)>", text):
            tag = name.lower()
            if tag in VOID_TAGS:
                continue
            # `<br/>` and `<div />`-style self-closing forms are not closers.
            if not slash and attrs.rstrip().endswith("/"):
                continue
            target = closes if slash else opens
            target[tag] = target.get(tag, 0) + 1

        for tag in sorted(set(opens) | set(closes)):
            if opens.get(tag, 0) != closes.get(tag, 0):
                rel = page.relative_to(DESIGN)
                problems.append(
                    f"{rel}: <{tag}> opened {opens.get(tag, 0)}x but closed {closes.get(tag, 0)}x"
                )
    return problems


def main() -> int:
    files = page_files()
    if not files:
        print("check-design: no HTML files found under design/ — is this the meta repo root?")
        return 1

    checks = [
        ("links resolve", check_links),
        ("every page has a .design-note", check_notes),
        ("class names are defined", check_classes),
        ("tags are balanced", check_structure),
    ]

    failures = 0
    for label, check in checks:
        problems = check(files)
        if problems:
            failures += len(problems)
            print(f"FAIL  {label}  ({len(problems)} problem(s))")
            for problem in problems:
                print(f"        {problem}")
        else:
            print(f"ok    {label}")

    print()
    print(f"checked {len(files)} page(s) in {DESIGN.name}/")
    if failures:
        print(f"{failures} problem(s) found")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
