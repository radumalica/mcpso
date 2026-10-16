"""Insert a one-line scope-update banner after the title of the given reports (idempotent)."""
import sys, pathlib
BANNER = ("> **Scope update:** the product direction changed to a new, independent application with no relation to mcp.so "
          "and no use of upstream data or code (see `master-plan.md` rev 2). Items in this report that assume continuing the fork, "
          "importing the upstream dataset (R07) or rebranding mcp.so are superseded; the audit findings and lessons remain valid.")
for name in sys.argv[1:]:
    p = pathlib.Path(name)
    lines = p.read_text().split("\n")
    if any("**Scope update:**" in l for l in lines[:5]):
        continue
    p.write_text("\n".join([lines[0], "", BANNER] + lines[1:]))
