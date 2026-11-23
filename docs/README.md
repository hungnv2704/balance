# Tài liệu Phân tích Sản phẩm & Thiết kế Kỹ thuật — Ứng dụng Quản lý Tài chính Cá nhân

**Giai đoạn:** Phase 1 — Product Discovery, Architecture & Security Design  
**Trạng thái:** Chờ Phê duyệt (Pending User Approval — Chưa triển khai code)  
**Điều phối:** Orchestrator Agent (cùng Product Manager, Software Architect, Security Engineer)

---

## Mục lục Bộ tài liệu

1. [01 - Tầm nhìn Sản phẩm & Phạm vi MVP](./01-product-vision-and-mvp.md)
   - Tầm nhìn, mục tiêu, chỉ số đo lường (privacy-preserving), Target Personas, ranh giới MVP vs Phase 2+.
2. [02 - Phân tích Nghiệp vụ, Yêu cầu Hệ thống & User Stories](./02-business-domain-and-requirements.md)
   - Phân tích 6 phân hệ cốt lõi (Income, Expenses, Accounts, Transfers, Budgets, Financial Reports).
   - 10 quyết định nghiệp vụ tài chính nền tảng.
   - Functional Requirements (FR), Non-Functional Requirements (NFR) và User Stories + Acceptance Criteria (`Given/When/Then`).
3. [03 - Kiến trúc Hệ thống, Tech Stack & ADRs](./03-architecture-and-tech-stack.md)
   - Đánh giá phương án kiến trúc (Modular Monolith vs Microservices vs Serverless) + Sơ đồ Context & Module.
   - Đánh giá & lựa chọn Technology Stack (NestJS, PostgreSQL 16+, Next.js, pg-boss, Self-hosted Auth).
   - Chuẩn REST API v1 (RFC 9457, Cursor Pagination, `Idempotency-Key`) & 5 Architecture Decision Records (ADRs).
4. [04 - Domain Model & Thiết kế Cơ sở Dữ liệu](./04-domain-model-and-database.md)
   - Quyết định Unified `transactions` Ledger + `transfers` Header + Tách biệt hoàn toàn Income/Expense/Transfer ở Domain/API/Constraints.
   - Công thức số học tiền tệ (`BIGINT` minor units + ISO 4217), công thức số dư, ngày tháng, xóa mềm/đảo bút toán.
   - Sơ đồ ER (Mermaid) & PostgreSQL DDL hoàn chỉnh đã đồng bộ hóa giữa Product, Architect và Security.
5. [05 - Yêu cầu Bảo mật & Phân tích Mối đe dọa](./05-security-and-threat-model.md)
   - Phân loại tài sản dữ liệu, Trust Boundaries, Threat Model (10 Abuse Cases theo STRIDE/OWASP).
   - Kiểm soát xác thực, phân quyền sở hữu, toàn vẹn tài chính, mã hóa, log redaction, xuất/xóa dữ liệu.
   - Ma trận phân quyền (Authorization Matrix) & Kế hoạch kiểm thử bảo mật.
6. [06 - Lộ trình Phát triển, Đánh giá Rủi ro & Câu hỏi Mở](./06-roadmap-and-risk-assessment.md)
   - Development Roadmap theo thứ tự ưu tiên & phụ thuộc kỹ thuật (bao gồm Thin Vertical Slice đầu tiên).
   - Bảng tổng hợp rủi ro sản phẩm, kỹ thuật, bảo mật và biện pháp giảm thiểu.
   - Danh sách Câu hỏi Mở (Open Questions) cần User xác nhận trước khi sang Giai đoạn lập trình.
7. [07 - Đặc tả Thiết kế UI/UX, Design System Tokens & Screen Specifications](./07-ui-ux-flow-and-screen-spec.md)
   - Design Tokens tuân thủ `ui-ux-rules/rules/AGENTS.md` (1 font + 2 weights, 1 accent color, viền `1px`, touch target `44px`).
   - Quick-Log / Simple Mode UX vs Multi-Account Mode, đặc tả từng màn hình và 4 trạng thái Loading/Optimistic UI.
8. [08 - Chiến lược Kiểm thử QA & Bộ Bất biến Tài chính](./08-qa-test-strategy-and-invariants.md)
   - Risk-based Test Pyramid (6 tầng), 8 Bất biến Tài chính kèm Worked Examples, Traceability Matrix và Gate D.
9. [09 - Quy tắc Phân quyền Model, Artifact Handoff, Vertical Slice & Scope Lock](./09-agent-orchestration-and-execution-rules.md)
   - Phân quyền `Gemini 4 Argon` vs `Gemini 4 Neon`, giao tiếp qua file `.md`/types, lộ trình 7 Vertical Slices và quy tắc khóa phạm vi sửa đổi.

---

## Nhật ký Đồng bộ hóa của Orchestrator (Cross-Agent Reconciliation Log)

Trong quá trình rà soát chéo giữa **Product Manager**, **Software Architect** và **Security Engineer**, Orchestrator đã giải quyết và thống nhất các điểm giao thoa sau:

1. **Đồng bộ Trạng thái Giao dịch (`status`)**: Product Manager yêu cầu hỗ trợ `DRAFT`, `PENDING`, `POSTED`, `VOIDED`, `REVERSED`; bản nháp DDL ban đầu của Architect chỉ có `POSTED`, `VOIDED`. **Quyết định hợp nhất:** Schema hỗ trợ đủ 5 trạng thái (`DRAFT`, `PENDING`, `POSTED`, `VOIDED`, `REVERSED`) với bất biến rõ ràng: **chỉ bản ghi `POSTED` mới tác động đến Posted Balance, Budgets và Báo cáo dòng tiền**.
2. **Đồng bộ Hoàn tiền (`EXPENSE_REFUND`) & Phí chuyển khoản (`fee_transaction_id`)**: Thêm `EXPENSE_REFUND` vào `entry_type` của `transactions` (kèm `refunds_transaction_id` trỏ tới giao dịch chi tiêu gốc) và thêm `fee_transaction_id` trên `transfers` để phí chuyển khoản được tách thành một bản ghi `EXPENSE` độc lập một cách nguyên tử.
3. **Đồng bộ Cơ chế Xác thực & Xóa tài khoản**: Kết hợp đề xuất Web-first của Architect và yêu cầu bảo mật của Security Engineer bằng mô hình **HttpOnly Secure SameSite Cookies + Refresh Token Rotation (SHA-256 hashed trong bảng `user_sessions` với Reuse Detection)**, đồng thời bổ sung `deletion_scheduled_at` trên `users` cho quy trình xóa tài khoản có grace period.
4. **Tích hợp Quy chuẩn UI/UX (`ui-ux-rules`)**: Đưa trực tiếp các quy tắc về Skeleton (không dùng spinner), Optimistic UI + Retry, 1 màu nhấn (accent color), 1 font family + 2 weights, 1px borders, và combobox tìm kiếm + cuộn vào NFRs.
5. **Bổ sung Cơ chế Quick-Log & Default Account ("Sổ chung")**: Tự động tạo 1 tài khoản mặc định (`is_default = TRUE`) khi user đăng ký để hỗ trợ ghi thu-chi tối giản 2 chạm mà vẫn bảo toàn `transactions.account_id NOT NULL` và mọi bất biến sổ cái.
