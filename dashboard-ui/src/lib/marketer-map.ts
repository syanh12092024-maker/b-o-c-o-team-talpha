/**
 * Canonical marketer name mapping — MULTI-PROJECT.
 * Covers STRAMARK + AUUS1 marketers.
 *
 * Maps ALL known variants (from mart_performance_master, vw_fact_ads_performance,
 * campaign codes, shortened names, etc.) to the canonical full name.
 */

// Canonical names
export const CANONICAL_MARKETERS = [
    // STRAMARK
    { id: "ANHNT", name: "Nguyễn Tuấn Anh", role: "Leader", project: "STRAMARK" },
    { id: "TUKT", name: "Kim Thanh Tú", role: "Leader", project: "STRAMARK" },
    { id: "CHIPTL", name: "Phạm Thị Linh Chi", role: "Marketer", project: "STRAMARK" },
    { id: "LETC", name: "Trần Cẩm Lệ", role: "Marketer", project: "STRAMARK" },
    // AUUS1
    { id: "THANHNT", name: "Nguyễn Tất Thành", role: "Leader", project: "AUUS1" },
    { id: "MANHDS", name: "Đặng Sỹ Mạnh", role: "Marketer", project: "AUUS1" },
    { id: "THANGNH", name: "Nguyễn Hữu Thắng", role: "Marketer", project: "AUUS1" },
    { id: "KINHBN", name: "Bùi Nguyên Kính", role: "Marketer", project: "AUUS1" },
] as const;

/**
 * Maps ALL known name/code variants → canonical name.
 */
const NAME_VARIANTS: Record<string, string> = {
    // === STRAMARK: Kim Thanh Tú ===
    "Kim Tu": "Kim Thanh Tú",
    "Kim Tú": "Kim Thanh Tú",
    "Kim Thanh Tú": "Kim Thanh Tú",
    "Kim thanh tú": "Kim Thanh Tú",
    "Tú": "Kim Thanh Tú",
    "TÚ": "Kim Thanh Tú",
    "TUKT": "Kim Thanh Tú",

    // === STRAMARK: Nguyễn Tuấn Anh ===
    "Nguyễn Tuấn Anh": "Nguyễn Tuấn Anh",
    "TA": "Nguyễn Tuấn Anh",
    "TA-lich": "Nguyễn Tuấn Anh",
    "TA-lich -mass": "Nguyễn Tuấn Anh",
    "TA-pixelnew": "Nguyễn Tuấn Anh",
    "TA-pixelnew-content2": "Nguyễn Tuấn Anh",
    "TA-pixelnew-content2-mass": "Nguyễn Tuấn Anh",
    "TA-pixelnew-contentnew": "Nguyễn Tuấn Anh",
    "TA-lich-pixelnew": "Nguyễn Tuấn Anh",
    "TA-LDPnew": "Nguyễn Tuấn Anh",
    "ANHNT": "Nguyễn Tuấn Anh",

    // === STRAMARK: Phạm Thị Linh Chi ===
    "Phạm Thị Linh Chi": "Phạm Thị Linh Chi",
    "LC": "Phạm Thị Linh Chi",
    "LC trondoi": "Phạm Thị Linh Chi",
    "LC trondoi pixelnew": "Phạm Thị Linh Chi",
    "LC-trondoi-pixelnew": "Phạm Thị Linh Chi",
    "LC-lich-pixelnew": "Phạm Thị Linh Chi",
    "LC ldp ver3": "Phạm Thị Linh Chi",
    "LC LDP ver4": "Phạm Thị Linh Chi",
    "CHIPTL": "Phạm Thị Linh Chi",

    // === STRAMARK: Trần Cẩm Lệ ===
    "Trần Cẩm Lệ": "Trần Cẩm Lệ",
    "Lệ": "Trần Cẩm Lệ",
    "Lệ new": "Trần Cẩm Lệ",
    "Lệ LDP ms": "Trần Cẩm Lệ",
    "LETC": "Trần Cẩm Lệ",

    // === AUUS1: Nguyễn Tất Thành ===
    "Nguyễn Tất Thành": "Nguyễn Tất Thành",
    "Tất Thành": "Nguyễn Tất Thành",
    "Thành": "Nguyễn Tất Thành",
    "THANHNT": "Nguyễn Tất Thành",

    // === AUUS1: Đặng Sỹ Mạnh ===
    "Đặng Sỹ Mạnh": "Đặng Sỹ Mạnh",
    "Đặng Mạnh": "Đặng Sỹ Mạnh",
    "Mạnh": "Đặng Sỹ Mạnh",
    "MANHDS": "Đặng Sỹ Mạnh",

    // === AUUS1: Nguyễn Hữu Thắng ===
    "Nguyễn Hữu Thắng": "Nguyễn Hữu Thắng",
    "Hữu Thắng": "Nguyễn Hữu Thắng",
    "Thắng": "Nguyễn Hữu Thắng",
    "THANGNH": "Nguyễn Hữu Thắng",

    // === AUUS1: Bùi Nguyên Kính ===
    "Bùi Nguyên Kính": "Bùi Nguyên Kính",
    "Kính": "Bùi Nguyên Kính",
    "KINHBN": "Bùi Nguyên Kính",
};

/** Resolve any marketer code/name variant to the canonical name */
export function resolveMarketerName(nameOrCode: string): string {
    if (!nameOrCode) return nameOrCode;
    return NAME_VARIANTS[nameOrCode] ?? nameOrCode;
}

/** Check if a marketer name is a real person (exclude system/unknown values) */
export function isRealMarketer(name: string): boolean {
    const lower = name.toLowerCase();
    return (
        lower !== "all marketers" &&
        lower !== "unknown" &&
        lower !== "" &&
        lower !== "null" &&
        lower !== "[object object]" &&
        lower !== "s.anh" &&
        lower !== "diệu thúy" &&
        lower !== "unmatched"
    );
}
