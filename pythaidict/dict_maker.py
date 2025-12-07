import json
from tqdm import tqdm
from pythainlp import romanize

INPUT_FILE = "kaikki.org-dictionary-Thai-words.jsonl"
OUTPUT_FILE = "thai_dict.json"

# Map Paiboon tone marks to tone names
PAIBOON_TONE_MAP = {
    '̄': 'mid',   # macron
    '́': 'high',  # acute
    '̀': 'low',   # grave
    '̌': 'rising',  # caron
    '̂': 'falling', # circumflex
}

def detect_tone(roman):
    # Scan the roman string for known tone marks
    for char in roman:
        if char in PAIBOON_TONE_MAP:
            return PAIBOON_TONE_MAP[char]
    return "mid"  # default if no tone mark

def extract_entry(entry):
    word = entry.get("word")
    senses = entry.get("senses", [])
    definitions = []
    for sense in senses:
        glosses = sense.get("glosses") or sense.get("raw_glosses") or []
        definitions.extend(glosses)

    # Extract Paiboon romanization with tone marks
    roman_with_tone = None
    for s in entry.get("sounds", []):
        if "tags" in s and "romanization" in s["tags"]:
            if s.get("raw_tags") and "Paiboon" in s["raw_tags"]:
                roman_with_tone = s.get("roman")
                break

    try:
        roman_plain = romanize(word, engine="royal")
    except Exception:
        # fallback if royal fails
        roman_plain = roman_with_tone or word

    # optional: extract tone info from Paiboon romanization
    word_tone = detect_tone(roman_with_tone) if roman_with_tone else ""

    return {
        "word": word,
        "definitions": definitions,
        "romanization_paiboon": roman_with_tone or "",
        "romanization_royal": roman_plain,
        "tone": word_tone,
    }

dictionary = {}
print("Loading Kaikki JSONL…")
with open(INPUT_FILE, "r", encoding="utf-8") as f:
    for line in tqdm(f, desc="Processing words"):
        entry = json.loads(line)
        word_data = extract_entry(entry)
        if word_data["word"]:
            dictionary[word_data["word"]] = word_data

# Optional: build a sorted index for fast lookup (list of words)
sorted_index = sorted(dictionary.keys())
output_data = {
    "_index": sorted_index,
    "_data": dictionary
}

print("Writing thai_dict.json…")
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(output_data, f, ensure_ascii=False, indent=2)

print("Done! Dictionary created.")
