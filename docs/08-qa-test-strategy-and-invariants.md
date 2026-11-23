# 08 — Chiến lược Kiểm thử QA & Bộ Bất biến Tài chính (Phase 1)

> **Tham chiếu chuẩn:** `agent.md`, `qa-engineer.md`, `02-business-domain-and-requirements.md`, `04-domain-model-and-database.md`, `05-security-and-threat-model.md`.  
> **Phạm vi:** Test Strategy & Invariant Specification only (chưa code implementation).

---

## 1. Risk-Based Test Pyramid & Coverage Model

### 1.1 Ma trận Phân tầng Rủi ro
| Mức Rủi ro | Phạm vi / Tính năng | Trọng tâm Kiểm thử |
| :--- | :--- | :--- |
| **Critical** | Money Arithmetic (`BIGINT`), Banker's Rounding, Posted Balance Formula | 100% Unit + Property-based tests + Worked examples |
| **Critical** | Tenant Isolation / IDOR (`T-02`), Auth & Refresh Rotation (`T-01`) | Integration API cross-user matrix + DB Composite FK |
| **Critical** | Atomic Transfers & Reversals (`BR-TRF-02`), Idempotency (`NFR-REL-01`) | Concurrency stress tests + Fault injection (DB rollback) |
| **High** | Net Cash Flow & Reports (`BR-RPT-01/02`), Refunds (`BR-EXP-03/04`), Budgets | Integration reconciliation (Report totals == Ledger sum) |
| **High** | Quick-Log Default Account (`BR-ACC-06`), Timezone Boundary (`NFR-FIN-02`) | Deterministic clock/timezone tests + E2E onboarding |
| **High** | CSV/JSON Export (`T-06`), Mass Assignment (`T-04`), Log Redaction (`T-07`) | Payload injection + Log output inspection |
| **Medium** | Performance (`NFR-PRF-01`: P95 < 500ms @ 10k tx), A11y (`WCAG AA`), Loading UX | Load test + `axe-core` + Playwright offline/throttling |

### 1.2 6 Tầng Kiểm thử
1. **Unit Tests:** Số học `BIGINT`, ISO 4217 precision, Banker's Rounding, State transitions, Posted Balance / Net Cash Flow / Timezone date calculation.
2. **Integration / API Tests (Real PostgreSQL):** `CHECK` constraints, Composite FKs `(entity_id, user_id)`, ACID rollback, `Idempotency-Key` deduplication & payload mismatch (`409`), Strict DTO chống Mass Assignment, Report reconciliation.
3. **End-to-End (E2E — Playwright):** Onboarding Quick-Log (1 ví) -> Mở rộng (2+ ví) -> Income, Expense + Refund, Transfer + Fee, Budgets, Reports, Optimistic UI rollback + Retry, Skeletons/Progress bars.
4. **Security & Isolation Tests:** Cross-user IDOR matrix (`404`/`403`), Refresh Token Reuse Detection, Brute-force `429`, SQLi/XSS/CSV Formula Injection, Log Redaction Audit.
5. **Accessibility Tests:** `axe-core` (0 lỗi Critical/Serious WCAG AA), điều hướng bàn phím, touch target `>= 44px`, cảnh báo kèm icon/text.
6. **Performance Tests:** Dataset 10,000 synthetic transactions/user -> API list/dashboard/reports P95 `< 500ms`.

---

## 2. Bộ Bất biến Tài chính & Worked Examples

1. **`BIGINT` Minor Units & Precision:**
   - Mọi `amount_minor` là số nguyên dương (`BIGINT > 0`), không dùng `float`/`double`.
   - *Worked Examples:* `VND (d=0)`: `"150000"` -> `150000`, `"100.50"` -> **REJECT (`422`)**. `USD (d=2)`: `"10.50"` -> `1050`, `0.10 + 0.20 = 30` (`$0.30`), `"10.555"` -> **REJECT**. `KWD (d=3)`: `"12.345"` -> `12345`, `"12.3456"` -> **REJECT**.
2. **Banker's Rounding (Half-Even) tại biên quy đổi:**
   - *Worked Examples:* `0.05 USD × 0.5 = 2.5 minor` -> **`2`** (`0.02 USD`, chẵn). `0.07 USD × 0.5 = 3.5 minor` -> **`4`** (`0.04 USD`, chẵn). `10.01 USD × 25,450 = 254,754.5 VND` -> **`254,754 VND`**.
3. **Posted-Only Account Balance (`BR-ACC-01`):**
   - $\text{Posted Balance} = \text{Opening} + \sum\text{INCOME} - \sum\text{EXPENSE} + \sum\text{REFUND} + \sum\text{TRANSFER\_IN} - \sum\text{TRANSFER\_OUT} + \sum\text{ADJ\_CREDIT} - \sum\text{ADJ\_DEBIT}$ (chỉ tính `status = 'POSTED'`).
   - *Worked Example:* Opening `1M` + Income `5M` (`POSTED`) + Income `2M` (`PENDING`) - Expense `1.2M` (`POSTED`) - Expense `500k` (`DRAFT`) - Expense `300k` (`VOIDED`) + Refund `200k` (`POSTED`) - Transfer Out `1M` (`POSTED`) + Adj Credit `50k` (`POSTED`) = **`4,050,000 VND`**.
4. **Quick-Log Default Account (`BR-ACC-06`):**
   - Đăng ký user mới -> tự tạo đúng 1 tài khoản `is_default = TRUE`, `opening_balance = 0`. Không cho archive tài khoản `active` cuối cùng. Đổi `base_currency_code` khi 0 tx -> đổi theo; khi `>= 1` tx -> giữ nguyên tiền tệ ví cũ.
5. **Internal Transfers Excluded from Net Cash Flow (`BR-TRF-03`, `BR-RPT-02`):**
   - $\text{Net Cash Flow} = \sum\text{INCOME} - (\sum\text{EXPENSE} - \sum\text{REFUND})$.
   - *Worked Example:* Thu `30M`, Chi `12M`, Hoàn `1M`, Chuyển khoản `5M` -> Net Cash Flow = **`+19,000,000 VND`** (tổng số dư các ví không đổi vì chuyển khoản).
6. **Transfer Fee as Separate `EXPENSE` (`BR-TRF-04`):**
   - *Worked Example:* Chuyển `100.00 USD` -> `2,500,000 VND`, phí `2.00 USD` -> Ví `USD` giảm `102.00 USD`, ví `VCB` tăng `2,500,000 VND`, báo cáo `USD` ghi nhận Chi `2.00 USD`.
7. **Expense Refund Bound (`BR-EXP-03/04`):**
   - $\sum\text{Refunds}(E) \le E.\text{amount\_minor}$. *Worked Example:* Chi gốc `1M`, hoàn `300k` -> hợp lệ (chi ròng `700k`, Thu nhập `+0`). Hoàn tiếp `800k` -> **REJECT (`422`)**.
8. **Timezone Date Boundary (`BR-BDG-02`, `NFR-FIN-02`):**
   - *Worked Example (`UTC+7`):* Chi `2026-11-30 23:45+07:00` (`16:45 UTC`) -> tính vào ngân sách **`2026-11`**. Chi `2026-12-01 01:00+07:00` (`2026-11-30 18:00 UTC`) -> tính vào ngân sách **`2026-12`**.

---

## 3. Traceability Matrix (Tóm tắt Ánh xạ Kiểm thử)

| Nhóm Yêu cầu | Test Case ID | Loại Kiểm thử | Mục tiêu Xác minh |
| :--- | :--- | :--- | :--- |
| `FR-ACC-01..03`, `BR-ACC-01..06` | `TC-ACC-01..05` | Unit + API + E2E | Tạo ví, validation `minor_unit`, Archive (chặn ví cuối), Auto-create Default Account, Posted Balance & Adjustment. |
| `FR-INC-01..02`, `US-INC-01` | `TC-INC-01..04` | API + Security + Concurrency | Tạo/lọc Thu nhập, `amount > 0`, currency match, Cross-user IDOR (`404`/`403`), Concurrent `Idempotency-Key` (0 duplicate). |
| `FR-EXP-01..03`, `US-EXP-01` | `TC-EXP-01..02` | API + E2E + Concurrency | Tạo Chi tiêu, Optimistic UI rollback + Retry khi offline, `EXPENSE_REFUND <= gốc` (chống race condition). |
| `FR-TRF-01..02`, `US-TRF-01` | `TC-TRF-01..03` | API + Fault Injection | Chuyển cùng/khác tiền tệ + Banker's Rounding + tách phí `EXPENSE`, chặn `from == to`, rollback khi DB lỗi giữa chừng. |
| `FR-BDG-01..02`, `US-BDG-01` | `TC-BDG-01..02` | Integration + Clock | Cảnh báo `80%`/`100%`, cô lập tiền tệ ngân sách, ranh giới `23:45 UTC+7` vs `01:00 UTC+7`. |
| `FR-RPT-01..02`, `US-RPT-01` | `TC-RPT-01` | Integration + E2E | Tách riêng khối/tab theo tiền tệ, Net Cash Flow khớp Ledger 100%, Drill-down, Empty state. |
| `FR-DAT-01`, `T-06`, `NFR-*` | `TC-DAT-01`, `TC-NFR-01` | Security + Load + A11y | CSV Formula Injection, Export ownership, Account deletion 2 bước, P95 < 500ms (10k tx), `axe-core` WCAG AA, Log Redaction. |

---

## 4. Release Readiness Gates (Gate D & DoD)

Bản phát hành MVP chỉ đạt trạng thái **Ready** khi đáp ứng toàn bộ tiêu chí định lượng của **Gate D**:
1. **100% Pass** Unit/Property tests cho Money Arithmetic, Banker's Rounding, Posted Balance, Net Cash Flow, Refund bounds.
2. **100% Pass** Integration/API tests cho Atomic Transfers, Idempotency (`0%` duplicate), Timezone boundary, và **0** sai lệch đối soát (Reconciliation discrepancy = `0`).
3. **100% Pass** Security & Isolation tests (0 IDOR, 0 Mass Assignment, 0 CSV Injection, 0 sensitive data trong logs, 0 Critical/High unpatched CVEs/secrets).
4. **100% Pass** Critical E2E journeys + **0** lỗi WCAG AA Critical/Serious (`axe-core`).
5. **Performance:** API list/dashboard/reports đạt **P95 < 500ms** với 10,000 synthetic transactions/user.
6. **0** Critical/High defects đang mở.
