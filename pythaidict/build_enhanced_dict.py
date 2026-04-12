import json
import re
from collections import defaultdict

INPUT_FILE = "kaikki_thai.jsonl"
NAMES_FILE = "thai_names.json"
OUTPUT_FILE = "thai_dict3.json"

THAI_RE = re.compile(r"[\u0E00-\u0E7F]+")
THAI_LOOSE_RE = re.compile(r"[\u0E00-\u0E7F]")

JUNK_TAGS = {"obsolete", "archaic", "rare", "misspelling", "dated", "nonstandard"}
REGISTER_TAGS = {"formal", "colloquial", "vulgar", "slang", "literary", "spoken", "written", "polite"}

def is_thai(word):
    return bool(THAI_RE.fullmatch(word))

def is_thai_loose(word):
    return bool(THAI_LOOSE_RE.search(word))

def get_romanization(entry):
    sounds = entry.get("sounds", [])
    for s in sounds:
        if s.get("raw_tags") == ["Paiboon"]:
            r = s.get("roman")
            if r:
                return r
    for s in sounds:
        r = s.get("roman")
        if r:
            return r
    return None

def extract_senses(entry):
    senses = []
    for s in entry.get("senses", []):
        glosses = s.get("glosses")
        if not glosses:
            continue
        tags = set(s.get("tags", []))
        if tags & JUNK_TAGS:
            continue
        gloss = glosses[0]
        if any(gloss.startswith(p) for p in [
            "romanization of", "alternative form of", "obsolete form of",
            "misspelling of", "plural of", "form of", "abstract noun of",
            "nominalization of", "gerund of", "past tense of", "noun form of",
            "verb form of", "adjective form of", "adverb form of",
        ]):
            continue
        register = sorted(tags & REGISTER_TAGS)
        examples = []
        for ex in s.get("examples", []):
            text = ex.get("text")
            translation = ex.get("translation") or ex.get("english")
            if text and translation and is_thai_loose(text):
                examples.append({"text": text, "translation": translation})
        senses.append({
            "gloss": gloss,
            "register": register,
            "examples": examples[:2]
        })
    return senses

def get_synonyms(entry):
    syns = []
    for s in entry.get("synonyms", []):
        w = s.get("word")
        if w and is_thai_loose(w):
            syns.append(w)
    return syns

def char_len(word):
    return len(list(word))

print("Loading Kaikki Thai JSONL…")

entries = []
with open(INPUT_FILE, encoding="utf-8") as f:
    for line in f:
        entries.append(json.loads(line))

print(f"Loaded {len(entries)} entries")

# ------------------------------------------------------------
# Pass 1: collect all lemmas
# ------------------------------------------------------------

lemmas = {}

for e in entries:
    word = e.get("word")
    if not word or not is_thai_loose(word):
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
            "synonyms": [],
            "is_common": False,
            "priority": 0
        }

    lemmas[word]["pos"].add(e.get("pos"))
    lemmas[word]["senses"].extend(extract_senses(e))
    lemmas[word]["synonyms"].extend(get_synonyms(e))

    if not lemmas[word]["romanization_paiboon"]:
        lemmas[word]["romanization_paiboon"] = get_romanization(e)

    for s in e.get("senses", []):
        if "common" in s.get("tags", []):
            lemmas[word]["is_common"] = True

# ------------------------------------------------------------
# Pass 2: classify compounds, idioms, derived
# ------------------------------------------------------------

for e in entries:
    word = e.get("word")
    if word not in lemmas:
        continue
    entry = lemmas[word]

    for d in e.get("derived", []):
        w = d.get("word")
        if w and is_thai_loose(w):
            entry["derived"].append(w)

    for r in e.get("related", []):
        w = r.get("word")
        if w and is_thai_loose(w):
            entry["idioms"].append(w)

    for ety in e.get("etymology_templates", []):
        if ety.get("name") == "com":
            parts = []
            for k in ["2", "3", "4", "5"]:
                p = ety.get("args", {}).get(k)
                if p and is_thai(p):
                    parts.append(p)
            if parts:
                entry["components"] = parts

# ------------------------------------------------------------
# Pass 3: attach compounds to heads
# ------------------------------------------------------------

for word, entry in lemmas.items():
    if entry["components"]:
        for part in entry["components"]:
            if part in lemmas:
                lemmas[part]["compounds"].append(word)

# ------------------------------------------------------------
# Pass 4: index word forms
# ------------------------------------------------------------

form_index = {}

for e in entries:
    word = e.get("word")
    if not word or word not in lemmas:
        continue
    for form in e.get("forms", []):
        f = form.get("form")
        if f and is_thai(f) and f not in lemmas:
            form_index[f] = word

# ------------------------------------------------------------
# Pass 5: priority ranking
# ------------------------------------------------------------

for word, entry in lemmas.items():
    length = char_len(word)
    p = 100

    if length >= 4:
        p += 20
    if length >= 6:
        p += 20

    if entry["is_common"]:
        p += 30

    if entry["components"]:
        p += 10

    if entry["idioms"] and not entry["senses"]:
        p -= 20

    entry["priority"] = max(p, 1)

# ------------------------------------------------------------
# Pass 6: merge Thai names
# ------------------------------------------------------------

print("Merging Thai names…")

with open(NAMES_FILE, encoding="utf-8") as f:
    names = json.load(f)

for name in names:
    word = name["word"]
    name_type = name["type"]
    gender = name.get("gender", "")

    if name_type == "given name":
        gloss = f"Thai given name ({gender})" if gender else "Thai given name"
    else:
        gloss = "Thai family name"

    sense = {
        "gloss": gloss,
        "register": [],
        "examples": []
    }

    if word not in lemmas:
        lemmas[word] = {
            "word": word,
            "pos": {"name"},
            "romanization_paiboon": name["roman"],
            "senses": [sense],
            "components": [],
            "derived": [],
            "idioms": [],
            "compounds": [],
            "synonyms": [],
            "is_common": True,
            "priority": 120
        }
    else:
        existing_glosses = {s["gloss"] for s in lemmas[word]["senses"]}
        if gloss not in existing_glosses:
            lemmas[word]["senses"].insert(0, sense)
        if not lemmas[word]["romanization_paiboon"]:
            lemmas[word]["romanization_paiboon"] = name["roman"]
        lemmas[word]["pos"].add("name")

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
        "senses": list({s["gloss"]: s for s in entry["senses"]}.values())[:5],
        "components": entry["components"],
        "derived": sorted(set(entry["derived"]))[:10],
        "idioms": sorted(set(entry["idioms"]))[:10],
        "compounds": sorted(set(entry["compounds"]))[:10],
        "synonyms": sorted(set(entry["synonyms"]))[:5],
        "is_common": entry["is_common"],
        "priority": entry["priority"]
    }

for form, canonical in form_index.items():
    if canonical in out_data and form not in out_data:
        out_data[form] = {**out_data[canonical], "form_of": canonical}

output = {
    "_meta": {
        "version": 3,
        "source": "kaikki.org Thai",
        "description": "Learner-first Thai dictionary (v3)"
    },
    "_data": out_data
}

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"Done. Wrote {len(out_data)} lemmas to {OUTPUT_FILE}")