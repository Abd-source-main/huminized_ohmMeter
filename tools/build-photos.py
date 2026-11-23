"""Dev-only: build photos/ from hand-checked labels.

Usage: python3 tools/build-photos.py <labels.json> <commons-meta.json> <raw-image-dir>

labels.json is a list of entries:
  {"src": "raw file name", "title": "File:... on Commons", "bands": ["brown", "black", "red", "gold"],
   "crop": [x0, y0, x1, y1] (fractions of width/height, optional), "rotate": 0|90|180|270 (optional),
   "note": "optional hint shown after answering"}

Writes photos/<id>.jpg (max 960 px, JPEG q80), photos/photos.json and photos/CREDITS.md.
"""
import html, json, os, re, sys
from PIL import Image

labels = json.load(open(sys.argv[1]))
meta = json.load(open(sys.argv[2]))
raw = sys.argv[3]
out = os.path.join(os.path.dirname(__file__), "..", "photos")
os.makedirs(out, exist_ok=True)


def text(h):
    return html.unescape(re.sub(r"<[^>]+>", "", h or "")).strip() or "Unknown author"


entries, credits = [], {}
for i, lab in enumerate(labels, 1):
    m = meta[lab["title"]]
    im = Image.open(os.path.join(raw, lab["src"])).convert("RGB")
    cropped = False
    if lab.get("crop"):
        x0, y0, x1, y1 = lab["crop"]
        w, h = im.size
        im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
        cropped = True
    if lab.get("rotate"):
        im = im.rotate(-lab["rotate"], expand=True)
        cropped = True
    im.thumbnail((960, 960), Image.LANCZOS)
    name = f"r{i:03d}.jpg"
    im.save(os.path.join(out, name), "JPEG", quality=80, optimize=True, progressive=True)
    author = text(m["artist"])
    entry = {
        "file": name, "bands": lab["bands"], "author": author, "license": m["license"],
        "licenseUrl": m.get("licenseUrl") or "", "source": m["page"], "cropped": cropped,
    }
    if lab.get("note"):
        entry["note"] = lab["note"]
    entries.append(entry)
    credits.setdefault(m["page"], {"title": lab["title"][5:], "author": author, "license": m["license"],
                                   "licenseUrl": m.get("licenseUrl") or "", "files": []})["files"].append(name)

json.dump({"version": 1, "photos": entries}, open(os.path.join(out, "photos.json"), "w"), indent=1, ensure_ascii=False)

lines = ["# Photo credits", "",
         "The real resistor photos in this app come from [Wikimedia Commons](https://commons.wikimedia.org/).",
         "Each one is used under the license shown. Files marked *cropped* were cropped, rotated and/or resized",
         "to show a single resistor, and those changes are released under the same license as the original.", ""]
for page, c in credits.items():
    lic = f"[{c['license']}]({c['licenseUrl']})" if c["licenseUrl"] else c["license"]
    lines.append(f"- **[{c['title']}]({page})** by {c['author']}, {lic}. Used as: {', '.join(c['files'])}")
open(os.path.join(out, "CREDITS.md"), "w").write("\n".join(lines) + "\n")
print(f"built {len(entries)} photos from {len(credits)} source files")
