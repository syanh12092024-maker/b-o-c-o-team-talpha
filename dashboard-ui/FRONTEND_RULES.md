# 🎨 Frontend Rules — CHO AI MODEL ĐỌC

## Phạm vi làm việc
- CHỈ sửa files trong `dashboard-ui/src/`
- KHÔNG sửa bất kỳ file nào ngoài `dashboard-ui/`
- KHÔNG tạo file mới ngoài `dashboard-ui/`

## Data Access
- Gọi data qua `/api/query` route (đã có sẵn)
- SQL queries chỉ SELECT từ views trong DATA_CONTRACT.md
- KHÔNG viết INSERT/UPDATE/DELETE

## Tech Stack
- Next.js 15 (App Router)
- TailwindCSS 4
- Recharts (charts)
- TypeScript strict mode

## Design System
- Dark theme: bg-[#0e1117], card bg-[#1e1e2e]
- Accent: indigo-500, emerald-400
- Font: Inter (Google Fonts)
- Border radius: rounded-xl
- Shadows: ring-1 ring-white/10
