#!/usr/bin/env python3
"""
Slovak Address Database with Fuzzy Matching.

Contains major cities/towns in Slovakia with their ZIP codes, organized by region.
Provides fuzzy matching to auto-correct misspelled city names and fill missing ZIPs.
"""

import re
import logging
from typing import Optional, Tuple, List

log = logging.getLogger("fulfillment.sk_address")


# ──────────────────────────────────────────
# Slovak City → ZIP Database
# Organized by region (kraj), covering all major cities & towns
# Source: Slovak postal system (Slovenská pošta)
# ──────────────────────────────────────────

# Format: { "city_name_lowercase": ("City Name", "ZIP Code", "Region") }
SK_CITIES: dict[str, tuple[str, str, str]] = {}

_RAW_DATA = """
# Bratislavský kraj
Bratislava|811 01|Bratislavský
Bratislava - Staré Mesto|811 01|Bratislavský
Bratislava - Ružinov|821 01|Bratislavský
Bratislava - Nové Mesto|831 01|Bratislavský
Bratislava - Petržalka|851 01|Bratislavský
Bratislava - Karlova Ves|841 04|Bratislavský
Bratislava - Dúbravka|841 02|Bratislavský
Bratislava - Rača|831 06|Bratislavský
Bratislava - Devínska Nová Ves|841 07|Bratislavský
Malacky|901 01|Bratislavský
Pezinok|902 01|Bratislavský
Senec|903 01|Bratislavský
Svätý Jur|900 21|Bratislavský
Modra|900 01|Bratislavský
Stupava|900 31|Bratislavský
Ivanka pri Dunaji|900 28|Bratislavský
Bernolákovo|900 27|Bratislavský
Šamorín|931 01|Bratislavský
Dunajská Streda|929 01|Bratislavský
# Trnavský kraj
Trnava|917 01|Trnavský
Piešťany|921 01|Trnavský
Hlohovec|920 01|Trnavský
Galanta|924 01|Trnavský
Skalica|909 01|Trnavský
Senica|905 01|Trnavský
Leopoldov|920 41|Trnavský
Vrbové|922 03|Trnavský
Sereď|926 01|Trnavský
Holíč|908 51|Trnavský
Gbely|908 45|Trnavský
Šaštín-Stráže|908 41|Trnavský
Smolenice|919 04|Trnavský
Bučany|919 28|Trnavský
Kúty|908 01|Trnavský
# Trenčiansky kraj
Trenčín|911 01|Trenčiansky
Považská Bystrica|017 01|Trenčiansky
Púchov|020 01|Trenčiansky
Partizánske|958 01|Trenčiansky
Nové Mesto nad Váhom|915 01|Trenčiansky
Dubnica nad Váhom|018 41|Trenčiansky
Ilava|019 01|Trenčiansky
Bánovce nad Bebravou|957 01|Trenčiansky
Myjava|907 01|Trenčiansky
Stará Turá|916 01|Trenčiansky
Brezová pod Bradlom|906 13|Trenčiansky
Nemšová|914 41|Trenčiansky
Handlová|972 51|Trenčiansky
Bojnice|972 01|Trenčiansky
# Nitriansky kraj
Nitra|949 01|Nitriansky
Komárno|945 01|Nitriansky
Nové Zámky|940 01|Nitriansky
Levice|934 01|Nitriansky
Šaľa|927 01|Nitriansky
Topoľčany|955 01|Nitriansky
Zlaté Moravce|953 01|Nitriansky
Štúrovo|943 01|Nitriansky
Kolárovo|946 03|Nitriansky
Vráble|952 01|Nitriansky
Hurbanovo|947 01|Nitriansky
Želiezovce|937 01|Nitriansky
Tvrdošovce|941 10|Nitriansky
Šurany|942 01|Nitriansky
# Žilinský kraj
Žilina|010 01|Žilinský
Martin|036 01|Žilinský
Ružomberok|034 01|Žilinský
Liptovský Mikuláš|031 01|Žilinský
Čadca|022 01|Žilinský
Dolný Kubín|026 01|Žilinský
Námestovo|029 01|Žilinský
Tvrdošín|027 44|Žilinský
Bytča|014 01|Žilinský
Kysucké Nové Mesto|024 01|Žilinský
Turčianske Teplice|039 01|Žilinský
Vrútky|038 61|Žilinský
Rajec|015 22|Žilinský
Trstená|028 01|Žilinský
Liptovský Hrádok|033 01|Žilinský
# Banskobystrický kraj
Banská Bystrica|974 01|Banskobystrický
Zvolen|960 01|Banskobystrický
Lučenec|984 01|Banskobystrický
Rimavská Sobota|979 01|Banskobystrický
Žiar nad Hronom|965 01|Banskobystrický
Brezno|977 01|Banskobystrický
Banská Štiavnica|969 01|Banskobystrický
Veľký Krtíš|990 01|Banskobystrický
Detva|962 12|Banskobystrický
Revúca|050 01|Banskobystrický
Krupina|963 01|Banskobystrický
Fiľakovo|986 01|Banskobystrický
Tornaľa|982 01|Banskobystrický
Dudince|962 71|Banskobystrický
Kremnica|967 01|Banskobystrický
Sliač|962 31|Banskobystrický
# Prešovský kraj
Prešov|080 01|Prešovský
Poprad|058 01|Prešovský
Humenné|066 01|Prešovský
Bardejov|085 01|Prešovský
Vranov nad Topľou|093 01|Prešovský
Svidník|089 01|Prešovský
Snina|069 01|Prešovský
Kežmarok|060 01|Prešovský
Stará Ľubovňa|064 01|Prešovský
Svit|059 21|Prešovský
Levoča|054 01|Prešovský
Stropkov|091 01|Prešovský
Sabinov|083 01|Prešovský
Lipany|082 71|Prešovský
Spišská Belá|059 01|Prešovský
Vysoké Tatry|062 01|Prešovský
Spišská Nová Ves|052 01|Prešovský
Medzilaborce|068 01|Prešovský
# Košický kraj
Košice|040 01|Košický
Košice - Staré Mesto|040 01|Košický
Košice - Západ|040 01|Košický
Košice - Sever|040 11|Košický
Košice - Juh|040 12|Košický
Košice - Šaca|040 15|Košický
Michalovce|071 01|Košický
Trebišov|075 01|Košický
Rožňava|048 01|Košický
Spišská Nová Ves|052 01|Košický
Gelnica|056 01|Košický
Moldava nad Bodvou|045 01|Košický
Kráľovský Chlmec|077 01|Košický
Sobrance|073 01|Košický
Sečovce|078 01|Košický
Veľké Kapušany|079 01|Košický
Dobšiná|049 25|Košický
"""

# Parse raw data into dict
for line in _RAW_DATA.strip().splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = line.split("|")
    if len(parts) == 3:
        city, zip_code, region = parts[0].strip(), parts[1].strip(), parts[2].strip()
        SK_CITIES[city.lower()] = (city, zip_code, region)

# Also build ZIP → city reverse lookup
SK_ZIP_TO_CITY: dict[str, tuple[str, str]] = {}
for key, (city, zip_code, region) in SK_CITIES.items():
    zip_normalized = zip_code.replace(" ", "")
    SK_ZIP_TO_CITY[zip_normalized] = (city, zip_code)

# Common misspellings / alternate names
SK_ALIASES: dict[str, str] = {
    "ba": "bratislava",
    "ke": "košice",
    "bb": "banská bystrica",
    "nr": "nitra",
    "za": "žilina",
    "po": "prešov",
    "tn": "trenčín",
    "tt": "trnava",
    "presov": "prešov",
    "kosice": "košice",
    "zilina": "žilina",
    "trencin": "trenčín",
    "banska bystrica": "banská bystrica",
    "bratislawa": "bratislava",
    "piestany": "piešťany",
    "nove zamky": "nové zámky",
    "banovce": "bánovce nad bebravou",
    "ruzomberok": "ružomberok",
    "liptovsky mikulas": "liptovský mikuláš",
    "sturovo": "štúrovo",
    "banska stiavnica": "banská štiavnica",
    "spisska nova ves": "spišská nová ves",
    "stara lubovna": "stará ľubovňa",
    "kralovsky chlmec": "kráľovský chlmec",
    "cadca": "čadca",
    "dolny kubin": "dolný kubín",
    "namestovo": "námestovo",
    "lucenec": "lučenec",
    "rimavska sobota": "rimavská sobota",
    "povazsks bystrica": "považská bystrica",
    "povazska bystrica": "považská bystrica",
    "nove mesto nad vahom": "nové mesto nad váhom",
    "dubnica nad vahom": "dubnica nad váhom",
    "ziar nad hronom": "žiar nad hronom",
    "vysoke tatry": "vysoké tatry",
    "turcianske teplice": "turčianske teplice",
    "moldava nad bodvou": "moldava nad bodvou",
    "dunajska streda": "dunajská streda",
    "zlate moravce": "zlaté moravce",
    "kezmarok": "kežmarok",
    "levoca": "levoča",
    "svit": "svit",
    "poprad": "poprad",
    "martin": "martin",
    "zvolen": "zvolen",
    "humenne": "humenné",
    "bardejov": "bardejov",
    "sabinov": "sabinov",
    "vranov nad toplou": "vranov nad topľou",
    "michalovce": "michalovce",
    "trebisov": "trebišov",
    "roznava": "rožňava",
    "gelnica": "gelnica",
    "sobrance": "sobrance",
    "filakovo": "fiľakovo",
    "velky krtis": "veľký krtíš",
    "revuca": "revúca",
    "krupina": "krupina",
    "detva": "detva",
    "kremnica": "kremnica",
    "skalica": "skalica",
    "senica": "senica",
    "holic": "holíč",
    "gbely": "gbely",
    "galanta": "galanta",
    "sala": "šaľa",
    "komarno": "komárno",
    "levice": "levice",
    "partizanske": "partizánske",
    "handlova": "handlová",
    "puchov": "púchov",
    "myjava": "myjava",
    "sered": "sereď",
    "topolcany": "topoľčany",
    "hlohovec": "hlohovec",
    "brezno": "brezno",
    "snina": "snina",
    "svidnik": "svidník",
    "stropkov": "stropkov",
}


# ──────────────────────────────────────────
# Fuzzy Matching
# ──────────────────────────────────────────

def _remove_diacritics(text: str) -> str:
    """Remove Slovak diacritics for fuzzy matching."""
    replacements = {
        "á": "a", "ä": "a", "č": "c", "ď": "d", "é": "e", "í": "i",
        "ĺ": "l", "ľ": "l", "ň": "n", "ó": "o", "ô": "o", "ŕ": "r",
        "š": "s", "ť": "t", "ú": "u", "ý": "y", "ž": "z",
    }
    result = text.lower()
    for fr, to in replacements.items():
        result = result.replace(fr, to)
    return result


def _levenshtein(s1: str, s2: str) -> int:
    """Simple Levenshtein distance."""
    if len(s1) < len(s2):
        return _levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            # Insertions, deletions, substitutions
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (c1 != c2)))
        prev = curr
    return prev[len(s2)]


def _similarity(s1: str, s2: str) -> float:
    """Return similarity ratio (0.0-1.0) between two strings."""
    s1_clean = _remove_diacritics(s1.strip())
    s2_clean = _remove_diacritics(s2.strip())
    if s1_clean == s2_clean:
        return 1.0
    max_len = max(len(s1_clean), len(s2_clean))
    if max_len == 0:
        return 1.0
    dist = _levenshtein(s1_clean, s2_clean)
    return 1.0 - (dist / max_len)


# ──────────────────────────────────────────
# Public API
# ──────────────────────────────────────────

def lookup_city(name: str) -> Optional[Tuple[str, str, str, float]]:
    """
    Look up a city name in the Slovak database.
    
    Returns: (correct_city, zip_code, region, confidence) or None.
    confidence: 1.0 = exact match, 0.8+ = fuzzy match.
    """
    if not name or not name.strip():
        return None

    clean = name.strip().lower()

    # 1. Exact match
    if clean in SK_CITIES:
        city, zip_code, region = SK_CITIES[clean]
        return (city, zip_code, region, 1.0)

    # 2. Alias match
    if clean in SK_ALIASES:
        alias_key = SK_ALIASES[clean]
        if alias_key in SK_CITIES:
            city, zip_code, region = SK_CITIES[alias_key]
            return (city, zip_code, region, 0.95)

    # 3. No-diacritics match
    clean_ascii = _remove_diacritics(clean)
    for key, (city, zip_code, region) in SK_CITIES.items():
        if _remove_diacritics(key) == clean_ascii:
            return (city, zip_code, region, 0.95)

    # 4. Check in aliases with no-diacritics
    for alias, target in SK_ALIASES.items():
        if _remove_diacritics(alias) == clean_ascii:
            if target in SK_CITIES:
                city, zip_code, region = SK_CITIES[target]
                return (city, zip_code, region, 0.92)

    # 5. Fuzzy match (find best)
    best_match = None
    best_score = 0.0

    for key, (city, zip_code, region) in SK_CITIES.items():
        score = _similarity(clean, key)
        if score > best_score:
            best_score = score
            best_match = (city, zip_code, region, score)

    # Only return if confidence > 0.7
    if best_match and best_score >= 0.7:
        return best_match

    return None


def lookup_zip(zip_code: str) -> Optional[Tuple[str, str]]:
    """
    Look up a ZIP code and return the matching city.
    
    Returns: (city_name, formatted_zip) or None.
    """
    if not zip_code:
        return None

    # Normalize: remove spaces
    normalized = zip_code.strip().replace(" ", "")

    if normalized in SK_ZIP_TO_CITY:
        return SK_ZIP_TO_CITY[normalized]

    # Try with common formats: XXXXX → match XXX XX
    if len(normalized) == 5 and normalized.isdigit():
        # Already normalized, check again
        return SK_ZIP_TO_CITY.get(normalized)

    return None


def suggest_correction(city: str, zip_code: str) -> dict:
    """
    Given a city and/or ZIP code, suggest corrections.
    
    Returns dict with possible keys:
    - city: corrected city name
    - zip: corrected/filled ZIP code
    - region: region name
    - confidence: match confidence (0.0 - 1.0)
    - source: how the correction was found
    """
    corrections = {}

    # Strategy 1: lookup by city name
    if city:
        result = lookup_city(city)
        if result:
            correct_city, correct_zip, region, conf = result
            corrections["city"] = correct_city
            corrections["region"] = region
            corrections["confidence"] = conf

            # Fill ZIP if missing or different
            if not zip_code:
                corrections["zip"] = correct_zip
                corrections["source"] = "city→zip"
            elif zip_code.replace(" ", "") != correct_zip.replace(" ", ""):
                # ZIP doesn't match city → warn but suggest
                corrections["zip"] = correct_zip
                corrections["source"] = "city→zip (mismatch)"
            else:
                corrections["source"] = "city_match"

    # Strategy 2: lookup by ZIP code (if city not found or not provided)
    if zip_code and "city" not in corrections:
        result = lookup_zip(zip_code)
        if result:
            correct_city, correct_zip = result
            corrections["city"] = correct_city
            corrections["zip"] = correct_zip
            corrections["confidence"] = 0.9
            corrections["source"] = "zip→city"

    return corrections


def format_zip(zip_code: str) -> str:
    """Format a Slovak ZIP code as XXX XX."""
    cleaned = zip_code.strip().replace(" ", "")
    if len(cleaned) == 5 and cleaned.isdigit():
        return f"{cleaned[:3]} {cleaned[3:]}"
    return zip_code
