# 09 — Quy tắc Phân quyền Model, Artifact Handoff, Vertical Slice & Scope Lock

Tài liệu này quy định cơ chế vận hành đội ngũ Subagents cho **Giai đoạn 2 (Implementation)** nhằm tối ưu chi phí token, tránh xung đột mã nguồn và đảm bảo tính nhất quán tuyệt đối giữa Database, Backend, Frontend và QA.

---

## 1. Phân quyền Model AI cho Subagents (Model Routing & Token Optimization)

| Vai trò / Tác vụ | Model chỉ định | Tham số `invoke_subagent` | Lý do tối ưu |
| :--- | :--- | :--- | :--- |
| **Software Architect** (DB Schema, API Contracts, ADRs) | **Gemini 4 Argon** | `Model: "pro"` | Đòi hỏi suy luận sâu về ACID, invariants và thiết kế hệ thống. |
| **Backend Engineer** (API, Domain Services, Ledger, Auth, Jobs) | **Gemini 4 Argon** | `Model: "pro"` | Xử lý logic tài chính (`bigint`), concurrency, idempotency, transaction. |
| **Security Engineer** (Threat Model, Authz, Isolation Audit) | **Gemini 4 Argon** | `Model: "pro"` | Phân tích lỗ hổng IDOR, Replay, Injection và kiểm soát bảo mật. |
| **Logic Debugger / QA Invariant** (Debug lỗi logic phức tạp, Test invariants) | **Gemini 4 Argon** | `Model: "pro"` | Truy vết race condition, sai số làm tròn, lệch đối soát số dư. |
| **Frontend / UI Builder** (Thiết kế & chỉnh sửa UI components, layout) | **Gemini 4 Neon** | `Model: "flash"` | Tối ưu tốc độ & token cho việc dựng component theo `ui-ux-rules` và spec có sẵn. |
| **Mock Data & Basic Fixes** (Tạo dữ liệu giả lập, sửa lỗi copy/style cơ bản) | **Gemini 4 Neon** | `Model: "flash"` | Tác vụ lặp lại, phạm vi hẹp, không cần model nặng. |

---

## 2. Giao tiếp qua Tệp `.md` & Types (Artifact Handoff Protocol)

- **Nguyên tắc:** **Không bao giờ** copy-paste đoạn chat dài từ subagent này sang subagent khác để tránh phình context và mất thông tin.
- **Cơ chế truyền ngữ cảnh:**
  - Subagent trước bắt buộc ghi kết quả chuẩn hóa ra tệp hợp đồng (ví dụ: `docs/04-domain-model-and-database.md`, `packages/shared-types/src/index.ts`, hoặc `docs/handoffs/<slice>-<role>.md`).
  - Subagent tiếp theo khởi chạy với context sạch và chỉ đọc trực tiếp các tệp cần thiết (tương đương `@docs/...` / `@packages/shared-types/...`).

---

## 3. Triển khai theo Vertical Slice (Lát cắt Tính năng Hoàn chỉnh)

Thay vì dựng hàng loạt màn hình rời rạc rồi mới ghép, toàn bộ chuỗi subagent (**Backend [Argon] → Frontend [Neon] → QA/Security [Argon]**) sẽ chạy **trọn vẹn từng lát cắt tính năng** trước khi chuyển sang lát cắt tiếp theo:

1. **Slice 0 — Foundation & Shared Kernel:** Monorepo, PostgreSQL + migrations (`currencies`), `Money` value object (`bigint`), RFC 9457 Error Handler, Redacted Logger, CI Security Gates.
2. **Slice 1 — Auth & Onboarding (Default Account):** Register, Login, Refresh Token Rotation + Reuse Detection, Auto-create Default Account (`"Sổ chung"`).
3. **Slice 2 — Accounts & Quick-Log Income:** Accounts CRUD/Archive, `POST/GET /incomes` (hỗ trợ Quick-Log 1 ví & Multi-ví), UI `/accounts` + `/incomes` + Test Isolation/Idempotency.
4. **Slice 3 — Quick-Log Expenses & Categories:** Categories (`INCOME`/`EXPENSE`), `POST/GET /expenses`, Searchable Combobox, Optimistic UI + Rollback/Retry.
5. **Slice 4 — Internal Transfers:** Atomic Transfer (cùng & khác tiền tệ, Banker's Rounding), Transfer Fee tách `EXPENSE`, UI `/transfers` + Concurrency/Rollback Tests.
6. **Slice 5 — Core Financial Reports:** `GET /reports/balances` & `GET /reports/cash-flow` (tách tiền tệ, loại trừ transfers), Drill-down UI `/dashboard` + Reconciliation Tests.
7. **Slice 6 — MVP Complete (P1):** `EXPENSE_REFUND`, `Balance Adjustments`, Monthly `Budgets` (80%/100%), Async CSV/JSON Export (`pg-boss` + chống CSV Injection), Account Deletion 2 bước.

---

## 4. Khóa Phạm vi Sửa đổi (Scope Lock Rules)

Mỗi lần điều phối subagent, Orchestrator **bắt buộc** đính kèm chỉ thị Scope Lock vào Prompt:

- **Frontend / UI Builder (`Gemini 4 Neon`):**
  > **SCOPE LOCK:** *"Chỉ chỉnh sửa các file trong `frontend/src/components/` (và `frontend/src/app/`, `frontend/src/styles/` thuộc lát cắt hiện tại). **Tuyệt đối không đụng vào thư mục `src/lib/` (core logic/API client), `backend/`, `packages/shared-types/`, hay cấu trúc database.** Nếu phát hiện thiếu trường dữ liệu API, hãy dừng và báo cáo lại cho Orchestrator."*
- **Backend Engineer (`Gemini 4 Argon`):**
  > **SCOPE LOCK:** *"Chỉ chỉnh sửa các file trong `backend/`, `database/migrations/`, và `packages/shared-types/` thuộc lát cắt hiện tại. Tuyệt đối không sửa giao diện `frontend/`."*
- **QA Engineer:**
  > **SCOPE LOCK:** *"Chỉ tạo/sửa test suites trong `tests/`. Không chỉnh sửa mã nguồn production (`backend/`, `frontend/`) để làm test pass."*
