#!/usr/bin/env python3
"""
Validators for T1 Fulfillment Automation.
Validates phone numbers and addresses before creating 3PL orders.
Market: Slovakia (SK) — Phone format: +421xxxxxxxxx
"""

import re
import logging
from dataclasses import dataclass, field
from typing import List, Optional

from sk_address_db import suggest_correction, lookup_city, format_zip

log = logging.getLogger("fulfillment.validators")


@dataclass
class ValidationResult:
    """Result of order validation."""
    is_valid: bool = True
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    corrections: dict = field(default_factory=dict)  # AI-suggested corrections

    def add_error(self, msg: str):
        self.errors.append(msg)
        self.is_valid = False

    def add_warning(self, msg: str):
        self.warnings.append(msg)

    def add_correction(self, key: str, original: str, corrected: str, confidence: float = 1.0):
        """Add an auto-correction suggestion."""
        self.corrections[key] = {
            "original": original,
            "corrected": corrected,
            "confidence": confidence,
        }

    def summary(self) -> str:
        parts = []
        if self.errors:
            parts.append(f"❌ {len(self.errors)} lỗi: " + "; ".join(self.errors))
        if self.warnings:
            parts.append(f"⚠️ {len(self.warnings)} cảnh báo: " + "; ".join(self.warnings))
        if self.corrections:
            fixes = [f"{k}: {v['original']}→{v['corrected']}" for k, v in self.corrections.items()]
            parts.append(f"🔧 {len(self.corrections)} sửa: " + "; ".join(fixes))
        if self.is_valid:
            parts.append("✅ Hợp lệ")
        return " | ".join(parts)


# ──────────────────────────────────────────
# Phone Number Validation (Slovakia +421)
# ──────────────────────────────────────────

# Slovakia phone: +421 followed by 9 digits
# Also accept: 0421, 00421, or just 9-digit local number
SK_PHONE_PATTERNS = [
    re.compile(r"^\+421\d{9}$"),           # +421912345678
    re.compile(r"^00421\d{9}$"),           # 00421912345678
    re.compile(r"^0\d{9}$"),               # 0912345678 (local)
]

# Generic international format (fallback)
INTL_PHONE_PATTERN = re.compile(r"^\+\d{10,15}$")


def normalize_phone(phone: str) -> str:
    """
    Normalize phone number: remove spaces, dashes, parentheses.
    Convert local SK format to international +421.
    """
    if not phone:
        return ""

    # Strip whitespace and common separators
    cleaned = re.sub(r"[\s\-\(\)\.\u00a0]", "", phone.strip())

    # Convert local SK format → international
    if re.match(r"^0\d{9}$", cleaned):
        cleaned = "+421" + cleaned[1:]
    elif re.match(r"^00421\d{9}$", cleaned):
        cleaned = "+" + cleaned[2:]
    elif re.match(r"^9\d{8}$", cleaned):
        # Bare 9-digit SK number without leading 0 (e.g., 908404892)
        cleaned = "+421" + cleaned

    return cleaned


def validate_phone(phone: str) -> ValidationResult:
    """
    Validate phone number for Slovakia market.

    Rules:
    - Must not be empty
    - Must match Slovakia format (+421xxxxxxxxx) or valid intl format
    - Must have correct digit count
    """
    result = ValidationResult()

    if not phone or not phone.strip():
        result.add_error("Số điện thoại trống")
        return result

    normalized = normalize_phone(phone)

    if not normalized:
        result.add_error("Số điện thoại không hợp lệ sau khi chuẩn hóa")
        return result

    # Check Slovakia patterns
    is_sk = any(p.match(normalized) for p in SK_PHONE_PATTERNS)
    is_intl = INTL_PHONE_PATTERN.match(normalized)

    if not is_sk and not is_intl:
        result.add_error(
            f"SĐT '{phone}' không đúng format Slovakia (+421xxxxxxxxx) "
            f"hoặc quốc tế (+xx...)"
        )
        return result

    # Warn if not Slovakia number
    if not normalized.startswith("+421"):
        result.add_warning(
            f"SĐT '{normalized}' không phải số Slovakia (+421). "
            f"Kiểm tra lại xem đúng chưa."
        )

    return result


# ──────────────────────────────────────────
# Address Validation (Slovakia)
# ──────────────────────────────────────────

# Slovakia postal code: 5 digits, often written as XXX XX
SK_ZIP_PATTERN = re.compile(r"^\d{3}\s?\d{2}$")

# Known Slovakia regions (kraje)
SK_REGIONS = [
    "bratislavský", "trnavský", "trenčiansky", "nitriansky",
    "žilinský", "banskobystrický", "prešovský", "košický",
    "bratislava", "trnava", "trenčín", "nitra",
    "žilina", "banská bystrica", "prešov", "košice",
]

# Garbage/placeholder values to reject
GARBAGE_VALUES = {"x", ".", "-", "n/a", "na", "test", "abc", "xxx", "none", "null"}
MIN_ADDRESS_LENGTH = 5
MIN_NAME_LENGTH = 3


def _extract_city_from_address(full_address: str) -> str:
    """
    Try to extract city name from a full address string.
    POS Cake format: "Ševčenkova 7, 036 01 Martin, Slovakia"
    We attempt to find city after ZIP code pattern (XXX XX).
    """
    if not full_address:
        return ""

    # Try to find: "XXX XX CityName" pattern
    match = re.search(r"\b\d{3}\s?\d{2}\s+([A-Za-zÀ-žĀ-ž\s\-]+)", full_address)
    if match:
        city = match.group(1).strip().rstrip(",").strip()
        # Remove trailing country name if present
        for country in ["Slovakia", "Slovensko", "SK"]:
            if city.lower().endswith(country.lower()):
                city = city[:-(len(country))].strip().rstrip(",").strip()
        if city:
            return city

    # Fallback: try comma-separated parts (2nd or 3rd part often has city)
    parts = [p.strip() for p in full_address.split(",") if p.strip()]
    if len(parts) >= 3:
        # "Street, ZIP City, Country" → try extracting from middle part
        mid = parts[1].strip()
        zip_match = re.match(r"\d{3}\s?\d{2}\s+(.*)", mid)
        if zip_match:
            return zip_match.group(1).strip()
        return mid
    elif len(parts) >= 2:
        return parts[1].strip()

    return ""


def validate_address(order: dict) -> ValidationResult:
    """
    Validate shipping address for Slovakia market.

    POS Cake stores address in two possible ways:
    1. shipping_address as dict: {'address': 'Ševčenkova 7, 036 01 Martin, Slovakia', ...}
    2. shipping_address as string + separate shipping_province, shipping_district

    Rules:
    - bill_full_name: required, min 3 chars, no garbage
    - Address text: required, min 5 chars (from dict or string)
    - City: extracted from address or shipping_province (warning if missing)
    - ZIP code: valid Slovakia format (optional but warned)
    - Country: should be SK
    """
    result = ValidationResult()

    # 1. Recipient name
    name = (
        order.get("bill_full_name", "")
        or order.get("customer_name", "")
        or ""
    ).strip()

    if not name:
        result.add_error("Tên người nhận trống (bill_full_name)")
    elif len(name) < MIN_NAME_LENGTH:
        result.add_error(f"Tên người nhận quá ngắn: '{name}' (tối thiểu {MIN_NAME_LENGTH} ký tự)")
    elif name.lower() in GARBAGE_VALUES:
        result.add_error(f"Tên người nhận không hợp lệ: '{name}'")

    # 2. Street address — handle dict or string format
    raw_addr = order.get("shipping_address", "") or order.get("bill_address", "") or ""
    address = ""
    zip_from_addr = ""
    city_from_addr = ""

    if isinstance(raw_addr, dict):
        # POS Cake format: {'address': 'Ševčenkova 7, 036 01 Martin, Slovakia', ...}
        address = raw_addr.get("address", "") or raw_addr.get("street", "") or ""
        # Try to extract city from embedded address
        city_from_addr = _extract_city_from_address(address)
        # Try to extract ZIP from embedded address
        zip_match = re.search(r"\b(\d{3}\s?\d{2})\b", address)
        if zip_match:
            zip_from_addr = zip_match.group(1)
    else:
        address = str(raw_addr).strip()
        city_from_addr = _extract_city_from_address(address)
        zip_match = re.search(r"\b(\d{3}\s?\d{2})\b", address)
        if zip_match:
            zip_from_addr = zip_match.group(1)

    if not address:
        result.add_error("Địa chỉ giao hàng trống (shipping_address)")
    elif len(address) < MIN_ADDRESS_LENGTH:
        result.add_error(f"Địa chỉ quá ngắn: '{address}' (tối thiểu {MIN_ADDRESS_LENGTH} ký tự)")
    elif address.lower() in GARBAGE_VALUES:
        result.add_error(f"Địa chỉ không hợp lệ: '{address}'")

    # 3. City / Province — check dedicated fields first, fall back to extracted
    city = (
        order.get("shipping_province", "")
        or order.get("bill_city", "")
        or order.get("shipping_district", "")
        or ""
    ).strip()

    if not city:
        city = city_from_addr  # Use extracted from address string

    if not city:
        # If full address looks complete (has ZIP + words), just warn
        if address and len(address) > 15:
            result.add_warning(
                "Không tách được thành phố từ địa chỉ — kiểm tra thủ công"
            )
        else:
            result.add_error("Thành phố / tỉnh trống (shipping_province)")
    elif city.lower() in GARBAGE_VALUES:
        result.add_error(f"Thành phố không hợp lệ: '{city}'")

    # 4. ZIP code (Slovakia: 5 digits) — check fields + extracted
    zip_code = (
        order.get("bill_zipcode", "")
        or order.get("shipping_zipcode", "")
        or ""
    ).strip()

    if not zip_code:
        zip_code = zip_from_addr  # Use extracted from address

    if zip_code:
        if not SK_ZIP_PATTERN.match(zip_code):
            result.add_warning(
                f"Mã bưu chính '{zip_code}' không đúng format Slovakia (XXX XX)"
            )
    else:
        result.add_warning("Mã bưu chính (ZIP code) trống — 3PL có thể yêu cầu")

    # 5. Country
    country = ""
    if isinstance(raw_addr, dict):
        country = (raw_addr.get("country_code", "") or "").strip().upper()
    if not country:
        country = (
            order.get("bill_country", "")
            or order.get("shipping_country", "")
            or ""
        ).strip().upper()

    if country and country not in ("SK", "SVK", "SLOVAKIA"):
        result.add_warning(
            f"Quốc gia '{country}' không phải Slovakia (SK). Kiểm tra lại."
        )

    # ──── AI Auto-Correction ────
    # Use Slovak address database to auto-correct city + ZIP
    corrections = suggest_correction(city, zip_code)

    if corrections:
        # Auto-correct city
        if "city" in corrections and city:
            corrected_city = corrections["city"]
            conf = corrections.get("confidence", 0)
            if corrected_city.lower() != city.lower():
                if conf >= 0.8:
                    result.add_correction("city", city, corrected_city, conf)
                    log.info(
                        f"  🔧 Auto-fix city: '{city}' → '{corrected_city}' "
                        f"(confidence: {conf:.0%})"
                    )
                else:
                    result.add_warning(
                        f"City '{city}' có thể là '{corrected_city}' "
                        f"(confidence: {conf:.0%}) — kiểm tra thủ công"
                    )

        # Auto-fill missing ZIP from city
        if "zip" in corrections:
            corrected_zip = corrections["zip"]
            if not zip_code:
                result.add_correction("zip", "(trống)", corrected_zip)
                log.info(f"  🔧 Auto-fill ZIP: → '{corrected_zip}' (từ city)")
            elif zip_code.replace(" ", "") != corrected_zip.replace(" ", ""):
                result.add_correction("zip", zip_code, corrected_zip)
                log.info(
                    f"  🔧 ZIP mismatch: '{zip_code}' → '{corrected_zip}' "
                    f"(theo city '{corrections.get('city', city)}')"
                )

        # Auto-fill missing city from ZIP
        if "city" in corrections and not city:
            corrected_city = corrections["city"]
            result.add_correction("city", "(trống)", corrected_city)
            log.info(f"  🔧 Auto-fill city: → '{corrected_city}' (từ ZIP)")
            # Remove the error about missing city since we found it
            result.errors = [
                e for e in result.errors
                if "Thành phố" not in e and "tỉnh trống" not in e
            ]
            if not result.errors:
                result.is_valid = True

    # Format ZIP code
    if zip_code and not corrections.get("zip"):
        formatted = format_zip(zip_code)
        if formatted != zip_code:
            result.add_correction("zip_format", zip_code, formatted, 1.0)

    return result


# ──────────────────────────────────────────
# Combined Validation
# ──────────────────────────────────────────

def validate_order(order: dict) -> ValidationResult:
    """
    Full validation of an order before creating 3PL fulfillment order.

    Checks:
    1. Phone number (Slovakia format)
    2. Address (name, street, city, ZIP)
    3. Items (has at least 1 item)
    4. COD amount (positive if COD order)

    Returns ValidationResult with is_valid=True/False and error/warning lists.
    """
    result = ValidationResult()

    order_id = order.get("id", "UNKNOWN")
    log.info(f"Validating order {order_id}...")

    # Phone validation
    phone = order.get("bill_phone_number", "") or ""
    phone_result = validate_phone(phone)
    result.errors.extend(phone_result.errors)
    result.warnings.extend(phone_result.warnings)
    if not phone_result.is_valid:
        result.is_valid = False

    # Address validation
    addr_result = validate_address(order)
    result.errors.extend(addr_result.errors)
    result.warnings.extend(addr_result.warnings)
    if not addr_result.is_valid:
        result.is_valid = False

    # Items check
    items = order.get("items", []) or []
    if not items:
        result.add_error("Đơn hàng không có sản phẩm (items rỗng)")

    # COD check
    cod = order.get("cod", 0) or 0
    try:
        cod_val = float(cod)
        if cod_val < 0:
            result.add_error(f"COD âm: {cod_val}")
        elif cod_val == 0:
            result.add_warning("COD = 0 — Đơn đã thanh toán trước?")
    except (TypeError, ValueError):
        result.add_error(f"COD không hợp lệ: {cod}")

    # Log result
    if result.is_valid:
        log.info(f"  ✅ Order {order_id} validation PASSED")
    else:
        log.warning(f"  ❌ Order {order_id} validation FAILED: {result.errors}")

    if result.warnings:
        log.info(f"  ⚠️ Warnings: {result.warnings}")

    return result
