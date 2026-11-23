# 05 — Yêu cầu Bảo mật & Phân tích Mối đe dọa (Security & Threat Analysis)

## 1. Phân loại Tài sản & Dữ liệu (Asset & Data Classification)

| Nhóm Tài sản | Ví dụ | Mức độ | Yêu cầu bảo vệ cốt lõi |
| :--- | :--- | :--- | :--- |
| **Credentials & Auth Secrets** | Password hash, Refresh tokens, Session IDs, MFA secrets, KMS keys | **Critical** | Không lưu plaintext; hash Argon2id/SHA-256; TLS; Secrets Manager; cấm log. |
| **PII** | Email, Họ tên, IP, Device fingerprint | **Restricted (High)** | Mã hóa at-rest & in-transit; ẩn/redacted trong logs & telemetry. |
| **Financial Accounts & Transactions** | Số dư, Opening Balance, Amount, Mô tả/Ghi chú, Merchant, Source | **Restricted (High)** | User isolation nghiêm ngặt; tính toán server-side; **tuyệt đối không log** `description/note/merchant/amount`. |
| **Budgets & Recurring Rules** | Hạn mức, Chu kỳ lặp | **Confidential (Medium)** | User isolation; idempotency khi chạy job. |
| **Exports & Attachments (P1/P2)** | File CSV/JSON export, ảnh hóa đơn | **Restricted (High)** | Private storage; Pre-signed URL ngắn hạn (<= 5 phút) hoặc stream có authz; chống CSV Injection. |
| **Audit Logs** | Lịch sử đăng nhập, đổi mật khẩu, void/reverse, xóa tài khoản | **Confidential (Medium)** | Append-only; **redacted toàn bộ PII/nội dung nhạy cảm**; chỉ giữ ID và loại sự kiện. |

---

## 2. Mô hình hóa Mối đe dọa (Threat Model — STRIDE / OWASP)

| ID | Mối đe dọa | Mức độ | Kịch bản tấn công | Biện pháp giảm thiểu (Mitigations) |
| :--- | :--- | :--- | :--- | :--- |
| **T-01** | **Account Takeover (ATO)** | **Critical** | Credential stuffing, brute-force, đánh cắp token qua XSS, lạm dụng reset password. | Argon2id, Rate limiting + exponential backoff, HttpOnly Secure SameSite Cookies, Refresh Token Rotation + Reuse Detection, Reset token ngắn hạn dùng 1 lần. |
| **T-02** | **IDOR / BOLA** | **Critical** | User B đổi `account_id`, `transaction_id`, `transfer_id` để đọc/sửa/xóa dữ liệu User A. | Lấy `user_id` từ verified Auth Context; mọi query có `WHERE user_id = ?`; ép Composite FK `(id, user_id)` ở PostgreSQL; trả `404` nhất quán. |
| **T-03** | **Transaction & Balance Tampering** | **Critical** | Gửi số tiền âm, sửa trực tiếp `balance`, hoặc làm lệch 2 đầu chuyển khoản. | Tính `balance` từ ledger trong ACID transaction; cấm client gửi `balance`; `CHECK (amount_minor > 0)`. |
| **T-04** | **Mass Assignment** | **High** | Client gửi kèm `user_id`, `status: "POSTED"`, `balance`, `role` vào JSON payload. | Strict DTO allowlist (Zod/class-validator `whitelist: true, forbidNonWhitelisted: true`). |
| **T-05** | **Replay & Duplicate Writes** | **High** | Double-click, retry mạng, hoặc worker chạy lại tạo trùng giao dịch. | Bắt buộc `Idempotency-Key`; Unique index `(recurring_rule_id, occurrence_date)`; lock `accounts` theo thứ tự `id ASC` khi transfer. |
| **T-06** | **Export / Attachment Leakage** | **High** | URL file export/hóa đơn đoán được, hoặc CSV chứa công thức độc hại (`=cmd|...`). | Private bucket + Pre-signed URL <= 5 phút hoặc stream qua API check `user_id`; sanitize ký tự `=`, `+`, `-`, `@`, `\t`, `\r` khi export CSV. |
| **T-07** | **Sensitive Data in Logs** | **High** | Error logs/APM ghi nguyên văn request body chứa password, token, `description`, `amount`. | Structured logging theo Allowlist; middleware tự động redact; cấm log raw body ở production. |
| **T-08** | **XSS, CSRF & Injection** | **High** | Stored XSS qua `note`/`merchant`; CSRF ép chuyển khoản; SQLi qua filter/sort. | Output encoding + CSP chặt; `SameSite=Lax/Strict` + CSRF token; Parameterized queries; Validate magic bytes nếu có upload file (P2). |
| **T-09** | **Support/Admin Abuse** | **Medium** | Nhân sự Support tự ý xem dữ liệu giao dịch chi tiết của user. | Tách Admin portal; mặc định Support không xem được dữ liệu tài chính chi tiết trừ khi có cơ chế break-glass + consent + Audit Log bắt buộc. |
| **T-10** | **Resource Exhaustion / DoS** | **Medium** | Gọi report/export khoảng thời gian quá lớn liên tục hoặc CSV bomb (P2). | Rate limiting theo `user_id`/IP; Cursor pagination bắt buộc; Export chạy async qua `pg-boss` có timeout. |

---

## 3. Các Kiểm soát Bảo mật Bắt buộc (Security Controls)

1. **Authentication & Session Security:**
   - Mật khẩu tối thiểu 12 ký tự, hash bằng **Argon2id** (memory >= 19–64 MiB, iterations >= 2–3).
   - **HttpOnly, Secure, SameSite=Lax/Strict Cookies** kết hợp **Refresh Token Rotation** (lưu SHA-256 hash trong `user_sessions`). Phát hiện dùng lại token cũ (**Reuse Detection**) -> thu hồi toàn bộ `token_family_id` ngay lập tức.
   - Thu hồi toàn bộ session khi đổi mật khẩu, reset mật khẩu, hoặc "Đăng xuất tất cả thiết bị".
   - *MFA Roadmap (Phase 2):* TOTP / WebAuthn + Recovery Codes + Step-up Auth khi xóa tài khoản hoặc export toàn bộ dữ liệu.
2. **Encryption & Secrets:**
   - Bắt buộc **TLS 1.2+ (ưu tiên TLS 1.3)** + HSTS cho toàn bộ kết nối.
   - Mã hóa at-rest (DB, Backups, Object Storage) bằng **AES-256** qua Cloud KMS.
   - Secrets quản lý qua Secrets Manager, tuyệt đối không commit `.env` thật (bật pre-commit secret scanning).
3. **Security Headers & CORS:**
   - `Strict-Transport-Security`, `Content-Security-Policy` (`frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
   - CORS allowlist chính xác domain frontend; cấm `*` khi dùng credentials.
4. **Privacy, Retention & Account Deletion:**
   - Khi user yêu cầu xóa tài khoản (yêu cầu Step-up Auth nhập lại mật khẩu): khóa đăng nhập ngay, đặt `deletion_scheduled_at` (grace period 14–30 ngày), sau đó **hard-delete / cryptographic erasure** toàn bộ PII, giao dịch, sessions, exports. Ghi nhận giới hạn backup retention (tự hết hạn theo vòng đời backup).

---

## 4. Ma trận Phân quyền (Authorization Matrix)

| Tài nguyên | Hành động | Anonymous | Owner (Auth User) | Non-Owner | Support / Admin | Background Worker |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Auth / Sessions** | Register / Login / Reset | Allow (Rate-limited) | Revoke own sessions | Deny | Deny | Deny |
| **User Profile** | Read / Update / Delete | Deny | **Own Only** (Delete cần Step-up) | Deny | Read metadata (No PII), Suspend (**Audited**) | Hard-delete sau grace period |
| **Accounts** | Create / Read / Update / Archive | Deny | **Own Only** (Cấm sửa `balance`) | Deny | Deny | Read để tính báo cáo |
| **Incomes & Expenses** | Create / Read / Update / Void / Reverse | Deny | **Own Only** (`Idempotency-Key`) | Deny | Deny | Create từ Recurring (P2, Idempotent) |
| **Transfers** | Create / Read / Void / Reverse | Deny | **Own Only** (Cả 2 đầu tài khoản) | Deny | Deny | Deny |
| **Categories & Budgets** | CRUD / Archive | Deny | **Own Only** | Deny | Manage system defaults (**Audited**) | Read cảnh báo ngân sách |
| **Exports (CSV/JSON)** | Request / Download | Deny | **Own Only** (Rate-limited) | Deny | Deny | Generate & dọn file hết hạn |
| **Audit Logs** | Read | Deny | Read own security events | Deny | Read **Redacted** logs (**Audited**) | Append-only |

---

## 5. Kế hoạch Kiểm thử Bảo mật (Security Verification Plan)

Trước khi release Production, bắt buộc chạy và pass các nhóm kiểm thử sau:
1. **Cross-user Isolation Tests:** User B gọi `GET/PATCH/POST` vào mọi ID tài nguyên của User A -> 100% bị chặn (`404`/`403`).
2. **Financial Concurrency & Idempotency Tests:** Bắn concurrent requests cùng `Idempotency-Key` -> chỉ tạo 1 bản ghi; giả lập lỗi DB giữa chừng khi transfer -> rollback toàn bộ; gửi payload chứa `balance`/`user_id` -> bị từ chối.
3. **Auth & Session Tests:** Reuse Refresh Token đã xoay vòng -> thu hồi toàn bộ family; truy cập bằng token đã revoke -> `401`; brute-force login -> `429`.
4. **Injection & Export Tests:** SQLi trên filter/sort; Stored XSS trong `note`/`merchant`; CSV Formula Injection (`=cmd|...`) khi export.
5. **Log Redaction Audit:** Kiểm tra log thực tế ở các kịch bản lỗi/thành công -> 0% lộ password, token, description, amount.
6. **CI/CD Security Gates:** Secret scanning (gitleaks), Dependency/SCA scan (0 Critical/High unpatched), SAST, và DAST cơ bản trên Staging.

*(Ghi chú: Tài liệu này không cấu thành chứng nhận tuân thủ pháp lý như GDPR/PDPA/PCI-DSS; cần đối chiếu pháp lý theo quốc gia triển khai thực tế).*
