# Balance — Quản lý Tài chính Cá nhân

Ứng dụng quản lý tài chính cá nhân đa ví với kiến trúc **Modular Monolith** (`NestJS + PostgreSQL 16 + Next.js`), tách biệt hoàn toàn **Thu nhập**, **Chi tiêu (& Hoàn tiền)**, và **Chuyển khoản nội bộ**, đảm bảo số học tiền tệ chính xác (`BIGINT` minor units + ISO 4217).

## Cấu trúc dự án

- `frontend/` — Next.js App Router, Tailwind CSS, `@animate-ui/react`, `motion`, `lucide-react`
- `backend/` — NestJS Modular Monolith (Auth Argon2id + Refresh Token Rotation, MFA TOTP, Accounts, Income, Expense & Refunds, Transfers, Budgets, Reports, Recurring Rules, Bulk CSV Import, Attachments, Data Export/Deletion)
- `packages/shared-types/` — Shared TypeScript domain contracts
- `database/migrations/` — PostgreSQL 16+ DDL migrations (`001_initial_schema.sql`, `002_phase2_mfa_and_attachments.sql`)
- `docs/` — Bộ tài liệu phân tích sản phẩm, kiến trúc, bảo mật, UI/UX và QA (`01` → `09`)
- `docker-compose.yml` — Khởi chạy PostgreSQL 16 nhanh qua Docker

## Hướng dẫn chạy cục bộ

### 1. Khởi tạo PostgreSQL 16 & Migration
```bash
docker compose up -d
# Hoặc chạy trực tiếp migration lên PostgreSQL 16:
psql -U pfm_user -d pfm_db -f database/migrations/001_initial_schema.sql
psql -U pfm_user -d pfm_db -f database/migrations/002_phase2_mfa_and_attachments.sql
```

### 2. Build Shared Types & Chạy Backend (port 3001)
```bash
cd packages/shared-types && npm install && npm run build
cd ../../backend && npm install && npm run build && npm start
```

### 3. Chạy Frontend (port 3000)
```bash
cd frontend && pnpm install && pnpm build && pnpm start --port 3000
```

Mở `http://localhost:3000` (tự động chuyển tới `/login` / `/register`).
