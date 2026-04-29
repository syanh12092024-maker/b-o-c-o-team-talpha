/**
 * Canonical marketer name mapping — MULTI-PROJECT.
 * Covers STRAMARK, AUUS1, ZEN8, HNLE, TRENDIFY marketers.
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
    { id: "HIEUNV", name: "Nguyễn Văn Hiệu", role: "Marketer", project: "STRAMARK" },
    { id: "TUONGVAN", name: "Phạm Thị Tường Vân", role: "Marketer", project: "STRAMARK" },
    { id: "MINHTHU", name: "Đỗ Minh Thư", role: "Marketer", project: "STRAMARK" },
    // AUUS1
    { id: "THANHNT", name: "Nguyễn Tất Thành", role: "Leader", project: "AUUS1" },
    { id: "MANHDS", name: "Đặng Sỹ Mạnh", role: "Marketer", project: "AUUS1" },
    { id: "THANGNH", name: "Nguyễn Hữu Thắng", role: "Marketer", project: "AUUS1" },
    { id: "KINHBN", name: "Bùi Nguyên Kính", role: "Marketer", project: "AUUS1" },
    { id: "CHINHTV", name: "Chính TV", role: "Marketer", project: "AUUS1" },
    // ZEN8 (Marketers)
    { id: "NHAMHT", name: "Mai Huỳnh Thanh Nhã", role: "Marketer", project: "ZEN8" },
    { id: "LYVLN", name: "Võ Lê Nhật Ly", role: "Marketer", project: "ZEN8" },
    { id: "HUYTN", name: "Trương Nhật Huy", role: "Marketer", project: "ZEN8" },
    { id: "DUNGNH", name: "Nguyễn Hoàng Dũng", role: "Marketer", project: "ZEN8" },
    { id: "TAIHH", name: "Huỳnh Hữu Tài", role: "Marketer", project: "ZEN8" },
    { id: "TUNPT", name: "Nguyễn Phan Thiên Tú", role: "Marketer", project: "ZEN8" },
    { id: "LINHLTT", name: "Lê Thị Trúc Linh", role: "Marketer", project: "ZEN8" },
    { id: "VUONGNM", name: "Nguyễn Minh Vương", role: "Marketer", project: "ZEN8" },
    // HNLE
    { id: "TUNGNT", name: "Nguyễn Thanh Tùng", role: "Marketer", project: "HNLE" },
    { id: "THACHTD", name: "Tạ Đình Thạch", role: "Marketer", project: "HNLE" },
    { id: "NHATTM", name: "Trần Minh Nhật", role: "Marketer", project: "HNLE" },
    { id: "DUCNV", name: "Nguyễn Văn Đức", role: "Marketer", project: "HNLE" },
    { id: "VANDTH", name: "Đàm Thị Hồng Vân", role: "Marketer", project: "HNLE" },
    { id: "HUYENLT", name: "Lê Thanh Huyền", role: "Marketer", project: "HNLE" },
    // TRENDIFY
    { id: "VANPTT", name: "Vân PTT", role: "Marketer", project: "TRENDIFY" },
    { id: "THUDM", name: "Thu DM", role: "Marketer", project: "TRENDIFY" },
    { id: "PHUNGNTM", name: "Phụng NTM", role: "Marketer", project: "TRENDIFY" },
    { id: "TuPA", name: "Tú PA", role: "Marketer", project: "TRENDIFY" },
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

    // === STRAMARK: Nguyễn Văn Hiệu ===
    "Nguyễn Văn Hiệu": "Nguyễn Văn Hiệu",
    "Hiệu": "Nguyễn Văn Hiệu",
    "Hieu": "Nguyễn Văn Hiệu",
    "HIEUNV": "Nguyễn Văn Hiệu",

    // === STRAMARK: Phạm Thị Tường Vân ===
    "Phạm Thị Tường Vân": "Phạm Thị Tường Vân",
    "Tường Vân": "Phạm Thị Tường Vân",
    "Tuong Van": "Phạm Thị Tường Vân",
    "TUONGVAN": "Phạm Thị Tường Vân",

    // === STRAMARK: Đỗ Minh Thư ===
    "Đỗ Minh Thư": "Đỗ Minh Thư",
    "Minh Thư": "Đỗ Minh Thư",
    "Minh Thu": "Đỗ Minh Thư",
    "MT": "Đỗ Minh Thư",
    "MINHTHU": "Đỗ Minh Thư",

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

    // === AUUS1: Chính TV ===
    "Chính TV": "Chính TV",
    "CHINH TV": "Chính TV",
    "Chinh TV": "Chính TV",
    "Chính": "Chính TV",
    "CHINHTV": "Chính TV",
    "chinhtv": "Chính TV",
    "Chinh": "Chính TV",

    // === ZEN8: Mai Huỳnh Thanh Nhã ===
    "Mai Huỳnh Thanh Nhã": "Mai Huỳnh Thanh Nhã",
    "Mai Nhã": "Mai Huỳnh Thanh Nhã",
    "NHAMHT": "Mai Huỳnh Thanh Nhã",

    // === ZEN8: Võ Lê Nhật Ly ===
    "Võ Lê Nhật Ly": "Võ Lê Nhật Ly",
    "Nhật Ly": "Võ Lê Nhật Ly",
    "Li Zi": "Võ Lê Nhật Ly",
    "LYVLN": "Võ Lê Nhật Ly",

    // === ZEN8: Trương Nhật Huy ===
    "Trương Nhật Huy": "Trương Nhật Huy",
    "Nhật Huy": "Trương Nhật Huy",
    "Nhat Huyy": "Trương Nhật Huy",
    "HUYTN": "Trương Nhật Huy",

    // === ZEN8: Nguyễn Hoàng Dũng ===
    "Nguyễn Hoàng Dũng": "Nguyễn Hoàng Dũng",
    "Hoàng Dũng": "Nguyễn Hoàng Dũng",
    "DUNGNH": "Nguyễn Hoàng Dũng",

    // === ZEN8: Huỳnh Hữu Tài ===
    "Huỳnh Hữu Tài": "Huỳnh Hữu Tài",
    "Huỳnh Tài": "Huỳnh Hữu Tài",
    "TAIHH": "Huỳnh Hữu Tài",

    // === ZEN8: Nguyễn Phan Thiên Tú ===
    "Nguyễn Phan Thiên Tú": "Nguyễn Phan Thiên Tú",
    "Thiên Tú": "Nguyễn Phan Thiên Tú",
    "Tấn Trường": "Nguyễn Phan Thiên Tú",
    "TUNPT": "Nguyễn Phan Thiên Tú",

    // === ZEN8: Lê Thị Trúc Linh ===
    "Lê Thị Trúc Linh": "Lê Thị Trúc Linh",
    "Trúc Linh": "Lê Thị Trúc Linh",
    "LINHLTT": "Lê Thị Trúc Linh",

    // === ZEN8: Nguyễn Minh Vương ===
    "Nguyễn Minh Vương": "Nguyễn Minh Vương",
    "Minh Vương": "Nguyễn Minh Vương",
    "VUONGNM": "Nguyễn Minh Vương",

    // === HNLE: Nguyễn Thanh Tùng ===
    "Nguyễn Thanh Tùng": "Nguyễn Thanh Tùng",
    "Thanh Tùng": "Nguyễn Thanh Tùng",
    "TUNGNT": "Nguyễn Thanh Tùng",
    "Tung NT": "Nguyễn Thanh Tùng",
    "Tùng NT": "Nguyễn Thanh Tùng",
    "Tùng": "Nguyễn Thanh Tùng",
    "Tung": "Nguyễn Thanh Tùng",
    "TUNG": "Nguyễn Thanh Tùng",
    "tung": "Nguyễn Thanh Tùng",
    "tungnt": "Nguyễn Thanh Tùng",
    "AU": "Nguyễn Thanh Tùng",           // campaign code AU = TUNGNT (Superba Oil AU01)

    // === HNLE: Tạ Đình Thạch ===
    "Tạ Đình Thạch": "Tạ Đình Thạch",
    "Đình Thạch": "Tạ Đình Thạch",
    "Thạch": "Tạ Đình Thạch",
    "THACHTD": "Tạ Đình Thạch",
    "Thach": "Tạ Đình Thạch",
    "thachtd": "Tạ Đình Thạch",
    "Ta Dinh Thach": "Tạ Đình Thạch",

    // === HNLE: Trần Minh Nhật ===
    "Trần Minh Nhật": "Trần Minh Nhật",
    "Minh Nhật": "Trần Minh Nhật",
    "NHATTM": "Trần Minh Nhật",
    "Nhật": "Trần Minh Nhật",
    "Nhat": "Trần Minh Nhật",
    "NHAT": "Trần Minh Nhật",
    "nhattm": "Trần Minh Nhật",
    "Tran Minh Nhat": "Trần Minh Nhật",
    "vd1": "Trần Minh Nhật",             // Nhật test campaigns (vd1)
    "vd2": "Trần Minh Nhật",             // Nhật test campaigns (vd2)
    "vd3": "Trần Minh Nhật",             // Nhật test campaigns (vd3)
    "23/3": "Trần Minh Nhật",            // Nhật campaigns with date as code
    "25/3": "Trần Minh Nhật",
    "30/3": "Trần Minh Nhật",
    "18/3": "Trần Minh Nhật",

    // === HNLE: Nguyễn Văn Đức ===
    "Nguyễn Văn Đức": "Nguyễn Văn Đức",
    "Văn Đức": "Nguyễn Văn Đức",
    "DUCNV": "Nguyễn Văn Đức",
    "Đức": "Nguyễn Văn Đức",
    "Duc": "Nguyễn Văn Đức",
    "DUC": "Nguyễn Văn Đức",
    "ducnv": "Nguyễn Văn Đức",
    "Nguyen Van Duc": "Nguyễn Văn Đức",
    "Dufei": "Nguyễn Văn Đức",

    // === HNLE: Đàm Thị Hồng Vân ===
    "Đàm Thị Hồng Vân": "Đàm Thị Hồng Vân",
    "Hồng Vân": "Đàm Thị Hồng Vân",
    "VANDTH": "Đàm Thị Hồng Vân",
    "Vân": "Đàm Thị Hồng Vân",
    "Van": "Đàm Thị Hồng Vân",
    "VAN": "Đàm Thị Hồng Vân",
    "vandth": "Đàm Thị Hồng Vân",
    "Dam Thi Hong Van": "Đàm Thị Hồng Vân",
    "UC": "Đàm Thị Hồng Vân",            // campaign code UC = VANDTH (Orange Gel AU02CB3)

    // === HNLE: Lê Thanh Huyền ===
    "Lê Thanh Huyền": "Lê Thanh Huyền",
    "Thanh Huyền": "Lê Thanh Huyền",
    "Huyền": "Lê Thanh Huyền",
    "HUYENLT": "Lê Thanh Huyền",
    "Huyen": "Lê Thanh Huyền",
    "HUYEN": "Lê Thanh Huyền",
    "huyenlt": "Lê Thanh Huyền",
    "Le Thanh Huyen": "Lê Thanh Huyền",

    // === TRENDIFY: Vân PTT ===
    "Vân PTT": "Vân PTT",
    "VANPTT": "Vân PTT",
    "Van PTT": "Vân PTT",

    // === TRENDIFY: Thu DM ===
    "Thu DM": "Thu DM",
    "THUDM": "Thu DM",
    "Thu": "Thu DM",

    // === TRENDIFY: Phụng NTM ===
    "Phụng NTM": "Phụng NTM",
    "PHUNGNTM": "Phụng NTM",
    "Phung NTM": "Phụng NTM",

    // === TRENDIFY: Tú PA ===
    "Tú PA": "Tú PA",
    "TuPA": "Tú PA",
    "Tu PA": "Tú PA",
    "TUPA": "Tú PA",
};

/** Resolve any marketer code/name variant to the canonical name */
export function resolveMarketerName(nameOrCode: string): string {
    if (!nameOrCode) return nameOrCode;
    let raw = nameOrCode.trim();
    if (raw.startsWith('{') && raw.includes('"name"')) {
        try { raw = JSON.parse(raw).name || raw; } catch(e) {}
    }
    return NAME_VARIANTS[raw] ?? raw;
}

/**
 * Check if a marketer name is a real person.
 * Uses WHITELIST approach: only names that map to a known CANONICAL_MARKETER are considered real.
 * This filters campaign name fragments (89, SUPERBA OIL, TEST KSA, etc.)
 */
export function isRealMarketer(nameOrCode: string): boolean {
    if (!nameOrCode) return false;
    const lower = nameOrCode.toLowerCase().trim();
    // Quick-reject system values
    if (lower === "" || lower === "null" || lower === "unknown" ||
        lower === "all marketers" || lower === "[object object]" ||
        lower === "unmatched") return false;
    // Whitelist: check if resolved name matches any canonical marketer name
    const resolved = resolveMarketerName(nameOrCode);
    const canonicalNames = new Set(CANONICAL_MARKETERS.map(m => m.name as string));
    return canonicalNames.has(resolved);
}
