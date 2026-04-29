#!/usr/bin/env python3
"""
Stramark Fulfillment Validators — Multi-Country.

Validates phone, address, ZIP per country profile.
Supported markets: Romania (RO), Slovakia (SK), Bulgaria (BG), Croatia (HR).

Country detection: POS Cake order tags.
  - No country tag  → Romania (default)
  - Tag "Slovakia"  → Slovakia
  - Tag "Bulgaria"  → Bulgaria
  - Tag "Croatia"   → Croatia
"""

import re
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict

try:
    from address_db import suggest_correction as _suggest_correction, format_zip as _format_zip
except ImportError:
    from sync.stramark.address_db import suggest_correction as _suggest_correction, format_zip as _format_zip

log = logging.getLogger("fulfillment.validators")


# ═══════════════════════════════════════════════════════════════════════════════
# Validation Result
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ValidationResult:
    """Result of order validation."""
    is_valid: bool = True
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    corrections: dict = field(default_factory=dict)

    def add_error(self, msg: str):
        self.errors.append(msg)
        self.is_valid = False

    def add_warning(self, msg: str):
        self.warnings.append(msg)

    def add_correction(self, key: str, original: str, corrected: str,
                       confidence: float = 1.0):
        self.corrections[key] = {
            "original": original,
            "corrected": corrected,
            "confidence": confidence,
        }

    def summary(self) -> str:
        parts = []
        if self.errors:
            parts.append(f"ERR({len(self.errors)}): " + "; ".join(self.errors))
        if self.warnings:
            parts.append(f"WARN({len(self.warnings)}): " + "; ".join(self.warnings))
        if self.corrections:
            fixes = [f"{k}: {v['original']}->{v['corrected']}"
                     for k, v in self.corrections.items()]
            parts.append(f"FIX({len(self.corrections)}): " + "; ".join(fixes))
        if self.is_valid:
            parts.append("VALID")
        return " | ".join(parts)


# ═══════════════════════════════════════════════════════════════════════════════
# Country Profiles
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class CountryProfile:
    code: str               # ISO 2-letter
    name: str
    flag: str
    default_courier_id: int
    courier_name: str
    phone_prefix: str       # "+40", "+421", etc.
    phone_local_pattern: re.Pattern   # local format (e.g. 07xxxxxxxx)
    phone_intl_pattern: re.Pattern    # international format
    zip_pattern: re.Pattern           # ZIP validation
    zip_digits: int
    currency: str
    tag_keywords: List[str]


COUNTRY_PROFILES: Dict[str, CountryProfile] = {
    "RO": CountryProfile(
        code="RO", name="Romania", flag="\U0001f1f7\U0001f1f4",
        default_courier_id=832, courier_name="Romania Cargus",
        phone_prefix="+40",
        phone_local_pattern=re.compile(r"^0[237]\d{8}$"),   # 07xx, 02xx, 03xx
        phone_intl_pattern=re.compile(r"^\+40[237]\d{8}$"),
        zip_pattern=re.compile(r"^\d{6}$"),
        zip_digits=6,
        currency="RON",
        tag_keywords=["romania", "românia", "ro"],
    ),
    "SK": CountryProfile(
        code="SK", name="Slovakia", flag="\U0001f1f8\U0001f1f0",
        default_courier_id=741, courier_name="Slovakia GLS",
        phone_prefix="+421",
        phone_local_pattern=re.compile(r"^0\d{9}$"),        # 09xxxxxxxx
        phone_intl_pattern=re.compile(r"^\+421\d{9}$"),
        zip_pattern=re.compile(r"^\d{3}\s?\d{2}$"),
        zip_digits=5,
        currency="EUR",
        tag_keywords=["slovakia", "slovensko", "sk"],
    ),
    "BG": CountryProfile(
        code="BG", name="Bulgaria", flag="\U0001f1e7\U0001f1ec",
        default_courier_id=838, courier_name="Bulgaria Express One",
        phone_prefix="+359",
        phone_local_pattern=re.compile(r"^0\d{8,9}$"),      # 08xxxxxxxx
        phone_intl_pattern=re.compile(r"^\+359\d{8,9}$"),
        zip_pattern=re.compile(r"^\d{4}$"),
        zip_digits=4,
        currency="EUR",
        tag_keywords=["bulgaria", "\u0431\u044a\u043b\u0433\u0430\u0440\u0438\u044f", "bg"],
    ),
    "HR": CountryProfile(
        code="HR", name="Croatia", flag="\U0001f1ed\U0001f1f7",
        default_courier_id=651, courier_name="Croatia DPD",
        phone_prefix="+385",
        phone_local_pattern=re.compile(r"^0\d{8,9}$"),      # 09xxxxxxxx
        phone_intl_pattern=re.compile(r"^\+385\d{8,9}$"),
        zip_pattern=re.compile(r"^\d{5}$"),
        zip_digits=5,
        currency="EUR",
        tag_keywords=["croatia", "hrvatska", "hr"],
    ),
}


# ═══════════════════════════════════════════════════════════════════════════════
# Tag-based Country Detection
# ═══════════════════════════════════════════════════════════════════════════════

def detect_country(order: dict) -> CountryProfile:
    """
    Detect country from POS order tags.

    Rules:
    - No country tag → Romania (default)
    - Tag contains "Slovakia" / "Slovensko" / "SK" → Slovakia
    - Tag contains "Bulgaria" / "България" / "BG" → Bulgaria
    - Tag contains "Croatia" / "Hrvatska" / "HR" → Croatia

    Tags can be: str, list[str], list[dict with "name"], or JSON string.
    """
    raw_tags = order.get("tags", "")
    tag_str = ""

    if isinstance(raw_tags, list):
        tag_str = " ".join(
            t if isinstance(t, str) else (t.get("name", "") if isinstance(t, dict) else str(t))
            for t in raw_tags
        )
    elif isinstance(raw_tags, str):
        tag_str = raw_tags

    lower = tag_str.lower()

    # Check non-default countries first
    for code in ("SK", "BG", "HR"):
        profile = COUNTRY_PROFILES[code]
        if any(kw in lower for kw in profile.tag_keywords):
            return profile

    # Default: Romania
    return COUNTRY_PROFILES["RO"]


# ═══════════════════════════════════════════════════════════════════════════════
# Phone Normalization & Validation
# ═══════════════════════════════════════════════════════════════════════════════

def normalize_phone(phone: str, country: CountryProfile) -> str:
    """Normalize phone number to international format for given country."""
    if not phone:
        return ""

    p = re.sub(r"[\s\-\(\)\.\u00a0]", "", phone.strip())
    prefix = country.phone_prefix
    digits = prefix.lstrip("+")

    # 00xx → +xx
    if p.startswith("00" + digits):
        p = prefix + p[2 + len(digits):]
    # xx without + → +xx
    elif p.startswith(digits) and not p.startswith("+"):
        p = "+" + p
    # Local format: 0xxx → +countryxxx
    elif p.startswith("0") and 9 <= len(p) <= 11:
        p = prefix + p[1:]
    # Bare digits
    elif not p.startswith("+") and len(p) >= 7:
        p = prefix + p

    return p


def validate_phone(phone: str, country: CountryProfile) -> ValidationResult:
    """Validate phone number for the given country."""
    result = ValidationResult()

    if not phone or not phone.strip():
        result.add_error("SDT trong")
        return result

    normalized = normalize_phone(phone, country)

    if not normalized:
        result.add_error("SDT khong hop le sau khi chuan hoa")
        return result

    # Check country-specific patterns
    is_local = country.phone_local_pattern.match(normalized)
    is_intl = country.phone_intl_pattern.match(normalized)
    is_generic_intl = re.match(r"^\+\d{10,15}$", normalized)

    if not is_local and not is_intl and not is_generic_intl:
        result.add_error(
            f"SDT '{phone}' khong dung format {country.name} "
            f"({country.phone_prefix}xxx) hoac quoc te (+xx...)"
        )

    if is_generic_intl and not normalized.startswith(country.phone_prefix):
        result.add_warning(
            f"SDT '{normalized}' khong phai so {country.name} "
            f"({country.phone_prefix}). Kiem tra lai."
        )

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Address Parsing & Validation
# ═══════════════════════════════════════════════════════════════════════════════

# Garbage values to reject
GARBAGE_VALUES = {"x", ".", "-", "n/a", "na", "test", "abc", "xxx", "none", "null"}
MIN_ADDRESS_LENGTH = 5
MIN_NAME_LENGTH = 3


def parse_address(full_addr: str, country: CountryProfile) -> dict:
    """
    Parse address string into components, aware of country ZIP format.

    Returns: {"street": ..., "city": ..., "zip_code": ...}
    """
    street, city, zip_code = "", "", ""

    # Build ZIP regex from country profile
    if country.zip_digits == 6:
        zip_re = re.compile(r"\b(\d{6})\b")
    elif country.zip_digits == 5:
        zip_re = re.compile(r"\b(\d{3}\s?\d{2})\b")
    elif country.zip_digits == 4:
        zip_re = re.compile(r"\b(\d{4})\b")
    else:
        zip_re = re.compile(r"\b(\d{4,6})\b")

    if "|" in full_addr:
        parts = [p.strip() for p in full_addr.split("|")]
        if parts and zip_re.match(parts[0]):
            zip_code = parts[0].replace(" ", "")
        if len(parts) >= 3:
            city = parts[2]
        if len(parts) >= 4:
            street = parts[-1].split(",")[0].strip()
    else:
        zip_match = zip_re.search(full_addr)
        if zip_match:
            zip_code = zip_match.group(1).replace(" ", "")
            street = full_addr[:zip_match.start()].rstrip(", ").strip()
            after = full_addr[zip_match.end():].strip()
            city_match = re.match(
                r"([A-Za-z\u00C0-\u017E\u0100-\u024F\u0400-\u04FF\s\-]+)",
                after
            )
            if city_match:
                city = city_match.group(1).strip().rstrip(",").strip()
                country_names = [
                    "Romania", "Rom\u00e2nia", "Slovakia", "Slovensko",
                    "Bulgaria", "\u0411\u044a\u043b\u0433\u0430\u0440\u0438\u044f",
                    "Croatia", "Hrvatska",
                    "RO", "SK", "BG", "HR",
                ]
                for cn in country_names:
                    if city.lower().endswith(cn.lower()):
                        city = city[:len(city) - len(cn)].rstrip(", ").strip()
        else:
            parts = [p.strip() for p in full_addr.split(",")]
            if len(parts) >= 3:
                street = parts[0]
                city = parts[1]
            else:
                street = full_addr

    return {"street": street or full_addr, "city": city, "zip_code": zip_code}


def validate_address(order: dict, country: CountryProfile) -> ValidationResult:
    """Validate shipping address for the given country."""
    result = ValidationResult()

    # 1. Recipient name
    name = (order.get("bill_full_name", "") or order.get("customer_name", "") or "").strip()
    if not name:
        result.add_error("Ten nguoi nhan trong")
    elif len(name) < MIN_NAME_LENGTH:
        result.add_error(f"Ten nguoi nhan qua ngan: '{name}'")
    elif name.lower() in GARBAGE_VALUES:
        result.add_error(f"Ten nguoi nhan khong hop le: '{name}'")

    # 2. Address
    raw_addr = order.get("shipping_address", "") or order.get("bill_address", "") or ""
    if isinstance(raw_addr, dict):
        full_addr = raw_addr.get("address", "") or raw_addr.get("full_address", "") or ""
    else:
        full_addr = str(raw_addr).strip()

    parsed = parse_address(full_addr, country)
    street = parsed["street"]
    city = parsed["city"]
    zip_code = parsed["zip_code"]

    if not full_addr:
        result.add_error("Dia chi giao hang trong")
    elif len(full_addr) < MIN_ADDRESS_LENGTH:
        result.add_error(f"Dia chi qua ngan: '{full_addr}'")

    # 3. City — try POS fields as fallback
    if not city:
        city = (
            order.get("shipping_province", "")
            or order.get("bill_city", "")
            or order.get("shipping_district", "")
            or ""
        ).strip()

    if not city:
        if full_addr and len(full_addr) > 15:
            result.add_warning("Khong tach duoc thanh pho tu dia chi")
        else:
            result.add_error("Thanh pho trong")

    # 4. ZIP — validate format
    if not zip_code:
        zip_code = (
            order.get("bill_zipcode", "")
            or order.get("shipping_zipcode", "")
            or ""
        ).strip()

    if zip_code:
        if not country.zip_pattern.match(zip_code):
            result.add_warning(
                f"ZIP '{zip_code}' khong dung format {country.name} "
                f"({country.zip_digits} so)"
            )
    else:
        result.add_warning(f"ZIP trong — {country.name} co the yeu cau")

    # ── AI Auto-Correction (fuzzy matching from address_db) ──
    corrections = _suggest_correction(country.code, city, zip_code)

    if corrections:
        # Auto-correct city
        if "city" in corrections and city:
            corrected_city = corrections["city"]
            conf = corrections.get("confidence", 0)
            if corrected_city.lower() != city.lower():
                if conf >= 0.8:
                    result.add_correction("city", city, corrected_city, conf)
                    log.info(f"  AI fix city: '{city}' -> '{corrected_city}' "
                             f"(conf={conf:.0%}, {country.code})")
                else:
                    result.add_warning(
                        f"City '{city}' co the la '{corrected_city}' "
                        f"(conf={conf:.0%}) — kiem tra thu cong"
                    )

        # Auto-fill missing ZIP from city
        if "zip" in corrections:
            corrected_zip = corrections["zip"]
            if not zip_code:
                result.add_correction("zip", "(trong)", corrected_zip)
                log.info(f"  AI fill ZIP: -> '{corrected_zip}' (tu city, {country.code})")
            elif zip_code.replace(" ", "") != corrected_zip.replace(" ", ""):
                result.add_correction("zip", zip_code, corrected_zip)
                log.info(f"  AI fix ZIP: '{zip_code}' -> '{corrected_zip}' ({country.code})")

        # Auto-fill city from ZIP
        if "city" in corrections and not city:
            corrected_city = corrections["city"]
            result.add_correction("city", "(trong)", corrected_city)
            log.info(f"  AI fill city: -> '{corrected_city}' (tu ZIP, {country.code})")
            # Remove city error since we resolved it
            result.errors = [e for e in result.errors if "Thanh pho" not in e]
            if not result.errors:
                result.is_valid = True

    # Format ZIP
    if zip_code and not corrections.get("zip"):
        formatted = _format_zip(country.code, zip_code)
        if formatted != zip_code:
            result.add_correction("zip_format", zip_code, formatted, 1.0)

    # Store parsed data for downstream use (apply corrections)
    order["_parsed_street"] = street
    order["_parsed_city"] = corrections.get("city", city) or city
    order["_parsed_zip"] = corrections.get("zip", zip_code) or zip_code

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Combined Validation
# ═══════════════════════════════════════════════════════════════════════════════

def validate_order(order: dict) -> ValidationResult:
    """
    Full validation of an order before creating 3PL fulfillment order.
    Auto-detects country from tags.
    """
    result = ValidationResult()

    order_id = order.get("id", "UNKNOWN")
    country = detect_country(order)

    log.info(f"Validating order {order_id} — {country.flag} {country.name}...")

    # Phone
    phone = order.get("bill_phone_number", "") or ""
    phone_result = validate_phone(phone, country)
    result.errors.extend(phone_result.errors)
    result.warnings.extend(phone_result.warnings)
    if not phone_result.is_valid:
        result.is_valid = False

    # Address
    addr_result = validate_address(order, country)
    result.errors.extend(addr_result.errors)
    result.warnings.extend(addr_result.warnings)
    result.corrections.update(addr_result.corrections)
    if not addr_result.is_valid:
        result.is_valid = False

    # Items
    items = order.get("items", []) or []
    if not items:
        result.add_error("Don hang khong co san pham")

    # COD
    cod = order.get("cod", 0) or 0
    try:
        cod_val = float(cod)
        if cod_val < 0:
            result.add_error(f"COD am: {cod_val}")
        elif cod_val == 0:
            result.add_warning("COD = 0 — Don da thanh toan truoc?")
    except (TypeError, ValueError):
        result.add_error(f"COD khong hop le: {cod}")

    # Store detected country on order
    order["_detected_country"] = country.code

    if result.is_valid:
        log.info(f"  VALID — {country.flag} {country.name} | {country.courier_name}")
    else:
        log.warning(f"  FAILED — {result.errors}")

    return result
