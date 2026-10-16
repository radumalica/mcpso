"""Insert or refresh a one-line banner after the title of the given reports (idempotent).
Usage: python3 -I tools/audit/add-scope-banner.py scope|superseded <files...>"""
import sys, pathlib
BANNERS = {
    "scope": ("> **Scope update (master plan v5):** the product is an independently operated registry built by enhancing this codebase; "
              "the historical upstream addition requests are imported, deduplicated, evaluated and selectively published (R07), with its own brand, "
              "infrastructure and data model, and without upstream branding or runtime dependence. Importing, eligibility and approval are separate "
              "concepts; the MVP scope is reduced. See `master-plan-v5.md`, `mvp-feature-matrix.md` and `publication-gate-checklist.md`."),
    "superseded": ("> **Superseded by `master-plan-v5.md`** (revision 5). Kept as history; several statements here were corrected there "
                   "(see `master-plan-v5-changelog.md` and `import-count-reconciliation.md` section 4)."),
}
kind = sys.argv[1]
banner = BANNERS[kind]
for name in sys.argv[2:]:
    p = pathlib.Path(name)
    lines = p.read_text().split("\n")
    head = lines[:6]
    idx = next((i for i, l in enumerate(head) if l.startswith("> **Scope update") or l.startswith("> **Superseded by")), None)
    if idx is not None:
        lines[idx] = banner
    else:
        lines = [lines[0], "", banner] + lines[1:]
    p.write_text("\n".join(lines))
