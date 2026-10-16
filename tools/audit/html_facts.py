"""Extract SEO/a11y facts from captured HTML pages (reports/evidence/ui/*.html)."""
import re, sys, pathlib
d = pathlib.Path(sys.argv[1])
def lum(h):
    r, g, b = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)
for name in ["home", "search", "categories", "category", "server", "server-missing", "category-missing", "privacy"]:
    p = d / f"{name}.html"
    if not p.exists(): continue
    h = p.read_text(errors="replace")
    g = lambda pat: (re.search(pat, h, re.S | re.I) or [None, None])[1]
    print(f"[{name}] title={g('<title>(.*?)</title>')!r}")
    print("   description:", (g(r'<meta name="description" content="(.*?)"') or "")[:90] or None, "| canonical:", g(r'<link rel="canonical" href="(.*?)"'))
    print("   h1:", len(re.findall(r"<h1", h)), "h2:", len(re.findall(r"<h2", h)), "| og:", len(re.findall(r'property="og:', h)), "twitter:", len(re.findall(r'name="twitter:', h)), "| json-ld:", len(re.findall("application/ld\\+json", h)), "| robots meta:", g(r'<meta name="robots" content="(.*?)"'))
    print("   imgs:", len(re.findall("<img", h)), "alt=star:", len(re.findall(r'alt="star"', h)), "| imgs w/o alt:", len([m for m in re.findall(r"<img[^>]*>", h) if "alt=" not in m]), "| inputs:", len(re.findall("<input", h)), "aria-label:", len(re.findall("aria-label", h)), "<label:", len(re.findall("<label", h)), "| buttons:", len(re.findall("<button", h)), "| lang:", g(r'<html lang="(.*?)"'))
for fg, bg, what in [("808080", "ffffff", "server page description text-[#808080] on white"), ("636262", "ffffff", "card description text-[#636262] on white"), ("2752f4", "ffffff", "nav hover blue on white"), ("94a3b8", "ffffff", "placeholder-ish slate-400 on white")]:
    c = contrast(fg, bg)
    print(f"contrast {what}: {c:.2f}:1 -> {'AA ok' if c >= 4.5 else 'FAILS AA (<4.5)'}")
