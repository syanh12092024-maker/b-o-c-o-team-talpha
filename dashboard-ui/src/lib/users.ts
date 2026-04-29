/**
 * Helper đọc/ghi users.json với file lock — tránh race condition.
 */
import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lockfile = require("proper-lockfile");

export interface UserRecord {
    id: string;
    email: string;
    name: string;
    password: string;
    role: string;
    projects: string[];
    status?: "active" | "pending";
}

const USERS_PATH = path.join(process.cwd(), "..", "config", "users.json");

/**
 * Đọc users.json (không lock).
 */
export function loadUsers(): UserRecord[] {
    const data = fs.readFileSync(USERS_PATH, "utf-8");
    return JSON.parse(data);
}

/**
 * Ghi users.json (không lock — chỉ dùng bên trong withUsersLock).
 */
function saveUsers(users: UserRecord[]) {
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 4) + "\n", "utf-8");
}

/**
 * Thực thi callback với file lock trên users.json.
 * Callback nhận users hiện tại, trả về users đã cập nhật.
 * Nếu callback throw → lock tự giải phóng, users.json không bị sửa.
 */
export async function withUsersLock(
    callback: (users: UserRecord[]) => UserRecord[]
): Promise<UserRecord[]> {
    // Lock trên chính file users.json
    const release = await lockfile.lock(USERS_PATH, {
        retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
        stale: 10000, // Lock hết hạn sau 10s
    });

    try {
        const users = loadUsers();
        const updated = callback(users);
        saveUsers(updated);
        return updated;
    } finally {
        await release();
    }
}
