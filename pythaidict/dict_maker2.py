import json
import re
from collections import defaultdict

INPUT_FILE = "kaikki_thai.jsonl"
OUTPUT_FILE = "thai_dict2.json"

THAI_RE = re.compile(r"[\u0E00-\u0E7F]+")

def is_thai(word):
    return bool(THAI_RE.fullmatch(word))

def get_paiboon(entry):
    for s in entry.get("sounds", []):
        if s.get("raw_tags") == ["Paiboon"]:
            return s.get("roman")
    return None

def extract_senses(entry):
    senses = []
    for s in entry.get("senses", []):
        glosses = s.get("glosses")
        if glosses:
            senses.append(glosses[0])
    return senses

def is_idiom(entry):
    if entry.get("related"):
        return True
    for s in entry.get("senses", []):
        if "idiomatic" in s.get("tags", []):
            return True
    return False

def is_compound(entry):
    if entry.get("etymology_templates"):
        return True
    return False

def char_len(word):
    return len([c for c in word])

print("Loading Kaikki Thai JSONL…")

entries = []
with open(INPUT_FILE, encoding="utf-8") as f:
    for line in f:
        entries.append(json.loads(line))

print(f"Loaded {len(entries)} entries")

# ------------------------------------------------------------
# Pass 1: collect all simple lemmas
# ------------------------------------------------------------

lemmas = {}

for e in entries:
    word = e.get("word")
    if not word or not is_thai(word):
        continue

    if word not in lemmas:
        lemmas[word] = {
            "word": word,
            "pos": set(),
            "romanization_paiboon": None,
            "senses": [],
            "components": [],
            "derived": [],
            "idioms": [],
            "compounds": [],
            "priority": 0
        }

    lemmas[word]["pos"].add(e.get("pos"))
    lemmas[word]["senses"].extend(extract_senses(e))

    if not lemmas[word]["romanization_paiboon"]:
        lemmas[word]["romanization_paiboon"] = get_paiboon(e)

# ------------------------------------------------------------
# Pass 2: classify compounds, idioms, derived
# ------------------------------------------------------------

for e in entries:
    word = e.get("word")
    if word not in lemmas:
        continue

    entry = lemmas[word]

    # derived terms
    for d in e.get("derived", []):
        w = d.get("word")
        if w and is_thai(w):
            entry["derived"].append(w)

    # idioms
    for r in e.get("related", []):
        w = r.get("word")
        if w and is_thai(w):
            entry["idioms"].append(w)

    # compound decomposition
    for ety in e.get("etymology_templates", []):
        if ety.get("name") == "com":
            parts = []
            for k in ["2", "3", "4"]:
                p = ety.get("args", {}).get(k)
                if p and is_thai(p):
                    parts.append(p)
            if parts:
                entry["components"] = parts

# ------------------------------------------------------------
# Pass 3: attach compounds to their heads
# ------------------------------------------------------------

for word, entry in lemmas.items():
    if entry["components"]:
        for part in entry["components"]:
            if part in lemmas:
                lemmas[part]["compounds"].append(word)

# ------------------------------------------------------------
# Pass 4: rank priorities (VERY IMPORTANT)
# ------------------------------------------------------------

for word, entry in lemmas.items():
    length = char_len(word)

    # base priority
    p = 100

    # penalize long words
    if length >= 4:
        p -= 30
    if length >= 6:
        p -= 40

    # penalize idioms
    if entry["idioms"]:
        p -= 40

    # penalize compounds
    if entry["components"]:
        p -= 20

    entry["priority"] = max(p, 1)

# ------------------------------------------------------------
# Final cleanup
# ------------------------------------------------------------

out_data = {}

for word, entry in lemmas.items():
    if not entry["senses"]:
        continue

    out_data[word] = {
        "pos": sorted(p for p in entry["pos"] if p),
        "romanization_paiboon": entry["romanization_paiboon"],
        "senses": list(dict.fromkeys(entry["senses"]))[:3],
        "components": entry["components"],
        "derived": sorted(set(entry["derived"])),
        "idioms": sorted(set(entry["idioms"])),
        "compounds": sorted(set(entry["compounds"])),
        "priority": entry["priority"]
    }

output = {
    "_meta": {
        "version": 2,
        "source": "kaikki.org Thai",
        "description": "Learner-first Thai dictionary (ranked)"
    },
    "_data": out_data
}

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"Done. Wrote {len(out_data)} lemmas to {OUTPUT_FILE}")
