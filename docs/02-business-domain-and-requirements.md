# 02 — Phân tích Nghiệp vụ, Yêu cầu Hệ thống & User Stories

## 1. Phân tích 6 Phân hệ Nghiệp vụ Cốt lõi

### 1.1 Quản lý Thu nhập (Income Management)
- **Ngữ nghĩa:** Năng lực độc lập để ghi nhận, phân loại và phân tích các dòng tiền đi vào sở hữu của người dùng (lương, freelance, lãi suất, thưởng, quà tặng).
- **Quy tắc nghiệp vụ:**
  - `BR-INC-01`: Số tiền thu nhập phải luôn dương (`> 0`). Độ chính xác thập phân tuân theo chuẩn ISO 4217 của mã tiền tệ.
  - `BR-INC-02`: Tiền tệ của bản ghi thu nhập phải khớp với tiền tệ của tài khoản nhận.
  - `BR-INC-03`: Chỉ bản ghi ở trạng thái `POSTED` mới được cộng vào Posted Balance của tài khoản và Báo cáo Thu nhập thực tế.
  - `BR-INC-04`: Cấm xóa cứng (hard-delete) giao dịch đã `POSTED`. Dùng `VOIDED` (hủy bỏ với lý do) hoặc `REVERSED` (tạo bút toán đảo ngược để giữ vết kiểm toán).
- **Vòng đời trạng thái (State Transitions):**

| Trạng thái hiện tại | Hành động | Trạng thái mới | Tác động số dư & Báo cáo |
| :--- | :--- | :--- | :--- |
| `(none)` | Lưu nháp | `DRAFT` | Không tác động |
| `(none)` | Ghi nhận chờ nhận | `PENDING` | Không tác động Posted Balance; hiển thị riêng ở mục Chờ nhận |
| `(none)` / `DRAFT` / `PENDING` | Xác nhận thực nhận (Post) | `POSTED` | Cộng vào số dư tài khoản & Báo cáo Thu nhập |
| `DRAFT` / `PENDING` | Hủy bỏ | `VOIDED` | Không tác động |
| `POSTED` | Hủy sổ / Đảo ngược | `VOIDED` / `REVERSED` | Loại khỏi số dư & Báo cáo Thu nhập (ghi Audit Log) |

---

### 1.2 Quản lý Chi tiêu (Expense Management)
- **Ngữ nghĩa:** Năng lực độc lập để ghi nhận, phân loại chi tiêu thực tế (theo danh mục, cửa hàng/người nhận) và liên kết ngân sách.
- **Quy tắc nghiệp vụ:**
  - `BR-EXP-01`: Số tiền chi tiêu phải luôn dương (`> 0`); tiền tệ khớp với tài khoản chi.
  - `BR-EXP-02`: Mặc định MVP cho phép tài khoản có số dư âm kèm cảnh báo mềm (soft warning) để không cản trở người dùng ghi chép thực tế khi chưa kịp nhập thu nhập. *(Ghi chú: Cần User xác nhận lại tại OQ-02)*.
  - `BR-EXP-03 (Hoàn tiền — Expense Refund)`: Hoàn tiền từ người bán hoặc bồi hoàn chi phí **không phải là Thu nhập**. Hệ thống ghi nhận là `EXPENSE_REFUND` gắn với danh mục chi tiêu gốc (và tùy chọn gắn `refunds_transaction_id` tới giao dịch chi tiêu gốc), làm **tăng số dư tài khoản nhận hoàn** và **giảm tổng chi tiêu ròng / tăng lại hạn mức ngân sách còn lại**.
  - `BR-EXP-04`: Tổng số tiền hoàn cho một giao dịch chi tiêu gốc không được vượt quá giá trị của giao dịch chi tiêu gốc đó.
- **Vòng đời trạng thái:** Tương tự Income (`DRAFT` -> `PENDING` -> `POSTED` -> `VOIDED` / `REVERSED`).

---

### 1.3 Quản lý Tài khoản (Accounts)
- **Ngữ nghĩa:** Đại diện cho nơi giữ tiền thực tế của người dùng (`CASH`, `BANK`, `E_WALLET`, `CREDIT_CARD`, `SAVINGS`). Mỗi tài khoản gắn với **1 mã tiền tệ ISO 4217 cố định**.
- **Quy tắc nghiệp vụ:**
  - `BR-ACC-01 (Công thức số dư Posted)`:
    $$\text{Posted Balance} = \text{Opening Balance} + \sum \text{INCOME} - \sum \text{EXPENSE} + \sum \text{EXPENSE\_REFUND} + \sum \text{TRANSFER\_IN} - \sum \text{TRANSFER\_OUT} + \sum \text{ADJUSTMENT\_CREDIT} - \sum \text{ADJUSTMENT\_DEBIT}$$
    *(Chỉ tính các bản ghi có `status = 'POSTED'`)*.
  - `BR-ACC-02`: Số dư đầu kỳ (`opening_balance`) không được tính là Thu nhập hay Chi tiêu trong báo cáo dòng tiền.
  - `BR-ACC-03 (Balance Adjustment)`: Chức năng điều chỉnh đối soát tạo bút toán `ADJUSTMENT_CREDIT` hoặc `ADJUSTMENT_DEBIT` riêng biệt, loại trừ khỏi Thu nhập/Chi tiêu thông thường để giữ minh bạch.
  - `BR-ACC-04`: Không thể đổi `currency_code` của tài khoản khi tài khoản đã có ít nhất 1 giao dịch. *(Ngoại lệ cho Default Account: nếu chưa có giao dịch nào, đổi `base_currency_code` trong Cài đặt sẽ tự động cập nhật `currency_code` của Default Account).*
  - `BR-ACC-05`: Cấm xóa cứng tài khoản đã có giao dịch; dùng **Archive** (ẩn khỏi danh sách chọn tạo mới, giữ nguyên lịch sử). **Không cho phép Archive tài khoản `active` duy nhất cuối cùng** (hoặc tài khoản đang là `is_default = TRUE` khi chưa chuyển cờ default sang tài khoản khác).
  - `BR-ACC-06 (Auto-created Default Account & Quick-Log UX)`: Ngay khi user đăng ký thành công, hệ thống tự động tạo 1 tài khoản mặc định ("Sổ chung", `is_default = TRUE`, `opening_balance = 0`, tiền tệ theo `base_currency_code`). Khi user chỉ có đúng 1 tài khoản `active`, form Thu nhập / Chi tiêu tự động chọn sẵn tài khoản này và thu gọn trường chọn ví (Progressive Disclosure), đồng thời không hiển thị cảnh báo đỏ nếu số dư âm. Ngay khi user tạo tài khoản `active` thứ 2, trường chọn ví tự động hiện rõ và tính năng Chuyển khoản được mở khóa.

---

### 1.4 Quản lý Chuyển khoản Nội bộ (Transfers)
- **Ngữ nghĩa:** Luân chuyển tiền giữa 2 tài khoản thuộc cùng một người dùng.
- **Quy tắc nghiệp vụ:**
  - `BR-TRF-01`: Tài khoản nguồn và tài khoản đích phải thuộc cùng user và khác nhau (`from_account_id != to_account_id`).
  - `BR-TRF-02`: Thực thi **nguyên tử (atomic)**: Cả 2 bút toán (`TRANSFER_OUT` tại nguồn và `TRANSFER_IN` tại đích) phải cùng thành công hoặc cùng rollback.
  - `BR-TRF-03`: Chuyển khoản nội bộ **tuyệt đối không** được tính vào Thu nhập, Chi tiêu, Ngân sách hay Net Cash Flow.
  - `BR-TRF-04 (Phí chuyển khoản)`: Nếu có phí, hệ thống tạo một bản ghi `EXPENSE` độc lập (gắn `fee_transaction_id` trên `transfers`), trừ từ tài khoản nguồn và tính vào Chi tiêu/Ngân sách.
  - `BR-TRF-05 (Khác tiền tệ)`: Lưu tường minh số tiền & tiền tệ nguồn, số tiền & tiền tệ đích, tỷ giá áp dụng (`exchange_rate`), nguồn tỷ giá và thời điểm hiệu lực. Không tính lại chuyển khoản quá khứ theo tỷ giá mới.

---

### 1.5 Quản lý Ngân sách (Budgets)
- **Ngữ nghĩa:** Giới hạn chi tiêu đặt ra cho 1 danh mục chi tiêu (`EXPENSE`) trong 1 kỳ xác định và 1 tiền tệ duy nhất.
- **Quy tắc nghiệp vụ:**
  - `BR-BDG-01`: Mỗi ngân sách gắn với 1 tiền tệ duy nhất, 1 kỳ (MVP: tháng dương lịch) và 1 danh mục chi tiêu. Không gộp giao dịch khác tiền tệ.
  - `BR-BDG-02`: Tính theo `transaction_date` (theo múi giờ cấu hình của user) của các giao dịch `POSTED`.
  - `BR-BDG-03`: `Actual Spent = SUM(EXPENSE) - SUM(EXPENSE_REFUND)` của danh mục đó trong kỳ và đúng tiền tệ.
  - `BR-BDG-04`: Ngưỡng cảnh báo: `>= 80%` (Warning) và `>= 100%` (Exceeded). Luôn hiển thị kèm text/icon, không chỉ dựa vào màu sắc.

---

### 1.6 Báo cáo Tài chính (Financial Reports)
- **Quy tắc nghiệp vụ:**
  - `BR-RPT-01 (Không gộp tiền tệ)`: Báo cáo tách biệt theo từng `currency_code` (VD: tab/khối riêng cho `VND` và `USD`). Tuyệt đối không cộng gộp khác tiền tệ khi chưa có chính sách quy đổi.
  - `BR-RPT-02 (Net Cash Flow)`:
    $$\text{Net Cash Flow (per currency, per period)} = \sum \text{POSTED INCOME} - \left(\sum \text{POSTED EXPENSE} - \sum \text{POSTED EXPENSE\_REFUND}\right)$$
    *(Loại trừ Transfers, Opening Balances, Adjustments)*.
  - `BR-RPT-03`: Mọi báo cáo phải hiển thị rõ kỳ lọc, tiền tệ, tài khoản lọc và quy tắc tính. Hỗ trợ drill-down xuống danh sách giao dịch cấu thành.

---

## 2. Tổng hợp 10 Quyết định Nghiệp vụ Tài chính Nền tảng

| # | Vấn đề nghiệp vụ | Quyết định chuẩn cho MVP |
|---|---|---|
| 1 | Tách Income và Expense? | Tách biệt hoàn toàn ở Navigation, Module, API, Validation, Reporting; dùng Unified Ledger ở DB với `CHECK` constraints chặt (xem Tài liệu 04). |
| 2 | Đa tài khoản & đa tiền tệ? | Có. 1 user sở hữu nhiều tài khoản; 1 tài khoản = 1 mã tiền tệ ISO 4217 cố định. |
| 3 | Công thức số dư? | Posted-only balance (`POSTED` transactions + opening balance + adjustments). `DRAFT`/`PENDING` hiển thị tách biệt. |
| 4 | Chuyển khoản & phí? | Hỗ trợ chuyển khoản nội bộ atomic; phí chuyển khoản tách thành bản ghi `EXPENSE` riêng. |
| 5 | Hoàn tiền & đảo bút toán? | Hoàn tiền là `EXPENSE_REFUND` (giảm chi tiêu, không tăng thu nhập). Sửa sai giao dịch `POSTED` dùng `VOIDED`/`REVERSED`. |
| 6 | Giao dịch định kỳ (P2)? | Mặc định tạo `DRAFT`/nhắc nhở chờ user xác nhận để tránh tự động ghi sai thực tế. |
| 7 | Ngày tính ngân sách? | Theo `transaction_date` (giờ địa phương theo timezone của user). |
| 8 | Base currency & Báo cáo? | User chọn 1 Base Currency làm ưu tiên hiển thị; báo cáo tách riêng từng tiền tệ gốc, không tự quy đổi gộp. |
| 9 | Xóa danh mục/tài khoản có lịch sử? | Cấm xóa cứng; chuyển sang `archived_at` (soft-archive) để bảo toàn lịch sử. |
| 10 | Export & Xóa dữ liệu? | Hỗ trợ Export CSV/JSON (chống CSV Injection) và Xóa tài khoản vĩnh viễn có xác nhận 2 bước + grace period. |

---

## 3. Yêu cầu Chức năng (Functional Requirements)

- **FR-ACC-01 (P0):** Tạo, xem, sửa tên/loại, lưu trữ (archive) tài khoản với tiền tệ ISO 4217 và số dư đầu kỳ.
- **FR-ACC-02 (P0):** Tính và hiển thị số dư tài khoản chính xác theo công thức Posted Balance.
- **FR-ACC-03 (P1):** Tạo bút toán Điều chỉnh số dư (Balance Adjustment) tách biệt khỏi Income/Expense.
- **FR-INC-01 (P0):** Tạo, xem, sửa, `void`/`reverse` bản ghi Thu nhập tại module riêng (gắn Tài khoản, Nguồn thu, Danh mục thu nhập, Trạng thái).
- **FR-INC-02 (P0):** Quản lý Danh mục Thu nhập (tạo, sửa, archive) và lọc/tìm kiếm lịch sử Thu nhập.
- **FR-EXP-01 (P0):** Tạo, xem, sửa, `void`/`reverse` bản ghi Chi tiêu tại module riêng (gắn Tài khoản, Merchant, Danh mục chi tiêu, Trạng thái).
- **FR-EXP-02 (P1):** Ghi nhận Hoàn tiền (`EXPENSE_REFUND`) liên kết giao dịch chi tiêu gốc.
- **FR-EXP-03 (P0):** Quản lý Danh mục Chi tiêu (tạo, sửa, archive) và lọc/tìm kiếm lịch sử Chi tiêu.
- **FR-TRF-01 (P0):** Chuyển khoản nội bộ nguyên tử (cùng tiền tệ & khác tiền tệ có tỷ giá/số tiền nhận tường minh).
- **FR-TRF-02 (P1):** Nhập phí chuyển khoản và tự động tách thành bản ghi `EXPENSE` độc lập.
- **FR-BDG-01 (P1):** Thiết lập ngân sách tháng theo Danh mục Chi tiêu và Tiền tệ.
- **FR-BDG-02 (P1):** Tính mức đã chi ròng, số còn lại, và cảnh báo ngưỡng >= 80%, >= 100%.
- **FR-RPT-01 (P0):** Báo cáo Tổng quan số dư, Tổng Thu, Tổng Chi ròng, Net Cash Flow tách biệt theo tiền tệ (loại trừ Transfers).
- **FR-RPT-02 (P0):** Drill-down từ số liệu báo cáo xuống danh sách giao dịch chi tiết.
- **FR-DAT-01 (P1):** Export toàn bộ dữ liệu cá nhân (CSV/JSON) và Yêu cầu Xóa tài khoản vĩnh viễn.

---

## 4. Yêu cầu Phi chức năng (Non-Functional Requirements)

- **NFR-FIN-01 (Độ chính xác tiền tệ):** Dùng integer minor units (`BIGINT`) hoặc exact decimal; sai số cộng/trừ cùng tiền tệ = 0. Tuyệt đối không dùng floating-point.
- **NFR-FIN-02 (Tiền tệ & Ngày tháng):** Mọi số tiền gắn mã ISO 4217; tách `transaction_date` (local date) với `created_at`/`updated_at` (UTC).
- **NFR-SEC-01 (Phân quyền & Cô lập dữ liệu):** 100% API kiểm tra ownership ở server từ Auth Context; 0% lỗ hổng IDOR.
- **NFR-SEC-02 (Riêng tư & Logging):** Không log mô tả giao dịch, ghi chú, merchant, số tài khoản, mật khẩu, hoặc token vào logs/telemetry.
- **NFR-REL-01 (Idempotency):** Mọi thao tác ghi tài chính bắt buộc `Idempotency-Key` để chống trùng lặp khi bấm đúp hoặc retry (0% duplicate).
- **NFR-REL-02 (Atomicity):** Chuyển khoản và đảo ngược giao dịch thực thi trong ACID transaction (all-or-nothing).
- **NFR-PRF-01 (Hiệu năng & Loading UX):** API danh sách/báo cáo P95 < 500ms với 10,000 giao dịch/user. Loading UX theo quy chuẩn: < 1s không hiện loader; 1–10s dùng **Skeleton** khớp layout (cấm spinner); > 10s (VD: Export) dùng **Progress bar + thời gian ước lượng**.
- **NFR-UX-01 (Tương tác & Phản hồi):** Áp dụng Optimistic UI cho thao tác trạng thái/xóa nháp (rollback + nút **Retry** khi lỗi). Danh sách dài (Danh mục, Tài khoản) dùng combobox hỗ trợ cả gõ tìm kiếm và cuộn.
- **NFR-A11Y-01 (Trợ năng & Giao diện):** Tương phản đạt **WCAG AA**, hỗ trợ bàn phím/screen-reader, vùng chạm >= 44px. Dùng 1 màu nhấn (accent color) cho hành động; màu ngữ nghĩa luôn kèm text/icon; 1 font family + 2 weights; card dùng viền `1px` thay vì bóng đổ nặng.

---

## 5. User Stories & Acceptance Criteria (Tiêu chuẩn Kiểm thử)

### US-ACC-01: Tạo và Lưu trữ Tài khoản
> *As a user, I want to create a financial account with an explicit currency and opening balance, and archive it when no longer needed, so that my balances and history remain accurate.*
- **AC-ACC-01.1 (Happy path):** *Given* user đã đăng nhập, *When* tạo tài khoản `"Ví Tiền Mặt"`, loại `CASH`, tiền tệ `VND`, số dư đầu kỳ `2,000,000 VND`, *Then* tài khoản được tạo ở trạng thái `active` với số dư `2,000,000 VND` và báo cáo Thu nhập tháng vẫn là `0 VND`.
- **AC-ACC-01.2 (Validation):** *Given* tiền tệ là `VND` (0 số lẻ), *When* nhập tên rỗng hoặc số dư `"100.50"`, *Then* hiển thị lỗi inline hướng dẫn cách sửa và chặn submit.
- **AC-ACC-01.3 (Archive):** *Given* tài khoản có 15 giao dịch `POSTED`, *When* chọn `"Lưu trữ tài khoản"`, *Then* tài khoản chuyển `archived`, ẩn khỏi form tạo giao dịch mới nhưng 15 giao dịch và báo cáo cũ vẫn giữ nguyên.
- **AC-ACC-01.4 (Empty & Loading):** *Given* user chưa có tài khoản nào và tải mất 2s, *When* mở trang Tài khoản, *Then* hiện Skeleton khớp layout (không spinner) rồi hiện Empty State kèm nút `"Tạo tài khoản"`.

### US-INC-01: Ghi nhận Thu nhập Độc lập
> *As a user, I want to record income in a dedicated Income workflow, so that I can track earnings separately from spending and transfers.*
- **AC-INC-01.1 (Happy path):** *Given* tài khoản `"VCB"` (`VND`) có số dư `5,000,000 VND`, *When* vào mục **Thu nhập**, tạo `20,000,000 VND`, danh mục `"Lương"`, nguồn `"Công ty X"`, trạng thái `POSTED`, *Then* số dư `"VCB"` tăng thành `25,000,000 VND` và tổng Thu nhập kỳ tăng `20,000,000 VND`.
- **AC-INC-01.2 (Validation & Currency):** *Given* tài khoản `"VCB"` (`VND`), *When* nhập `amount <= 0` hoặc gửi mã `USD` qua API, *Then* server từ chối (`400`/`422`), số dư không đổi.
- **AC-INC-01.3 (Ownership):** *Given* User A gửi request tạo thu nhập vào `account_id` của User B, *When* server xử lý, *Then* trả về `404`/`403` không lộ thông tin tài khoản B.
- **AC-INC-01.4 (Idempotency):** *Given* client bấm đúp gửi 2 request liên tiếp cùng `Idempotency-Key`, *When* server xử lý, *Then* chỉ tạo đúng 1 bản ghi thu nhập và số dư chỉ tăng 1 lần.

### US-EXP-01: Ghi nhận Chi tiêu & Hoàn tiền
> *As a user, I want to record expenses and link refunds to original expenses, so that my net spending and budgets are accurate.*
- **AC-EXP-01.1 (Happy path):** *Given* tài khoản `"Ví"` có `2,000,000 VND`, *When* ghi nhận chi tiêu `150,000 VND` danh mục `"Ăn uống"` (`POSTED`), *Then* số dư giảm còn `1,850,000 VND` và chi tiêu `"Ăn uống"` tăng `150,000 VND`.
- **AC-EXP-01.2 (Refund):** *Given* chi tiêu gốc `1,000,000 VND` danh mục `"Mua sắm"` từ `"VCB"`, *When* ghi nhận hoàn tiền `300,000 VND` liên kết giao dịch gốc về `"VCB"`, *Then* số dư `"VCB"` tăng `300,000 VND`, chi tiêu ròng `"Mua sắm"` còn `700,000 VND`, và tổng Thu nhập không đổi.
- **AC-EXP-01.3 (Refund boundary):** *Given* chi tiêu gốc `1,000,000 VND`, *When* nhập hoàn tiền `1,200,000 VND`, *Then* hệ thống từ chối và báo lỗi vượt quá giá trị gốc.
- **AC-EXP-01.4 (Optimistic UI & Retry):** *Given* mạng bị ngắt khi user hủy 1 bản nháp `DRAFT`, *When* thao tác thất bại, *Then* UI rollback khôi phục bản nháp và hiện nút `"Thử lại"`.

### US-TRF-01: Chuyển khoản Nội bộ (Cùng & Khác tiền tệ)
> *As a user, I want to transfer money between my own accounts with optional fees, so that balances stay accurate without inflating income or expenses.*
- **AC-TRF-01.1 (Same currency):** *Given* `"VCB"` (`10,000,000 VND`) và `"Tiền mặt"` (`500,000 VND`), *When* chuyển `2,000,000 VND` từ `"VCB"` sang `"Tiền mặt"`, *Then* `"VCB"` còn `8,000,000 VND`, `"Tiền mặt"` thành `2,500,000 VND`, tổng Thu nhập và Chi tiêu không đổi.
- **AC-TRF-01.2 (Cross-currency + Fee):** *Given* `"USD"` (`500.00 USD`) và `"VCB"` (`0 VND`), *When* chuyển `100.00 USD` sang `"VCB"` nhận `2,500,000 VND` (tỷ giá `25,000`) với phí `2.00 USD`, *Then* `"USD"` giảm `102.00 USD`, `"VCB"` tăng `2,500,000 VND`, phát sinh 1 bản ghi `EXPENSE` riêng `2.00 USD`, và phần `100.00 USD` không tính vào Thu/Chi.
- **AC-TRF-01.3 (Validation):** *When* chọn nguồn và đích trùng nhau hoặc tài khoản đích thuộc User khác, *Then* từ chối và không thay đổi số dư nào.

### US-BDG-01: Theo dõi Ngân sách Tháng
> *As a user, I want to set monthly category budgets per currency and see threshold alerts, so that I can control my spending.*
- **AC-BDG-01.1 (Threshold):** *Given* ngân sách `"Ăn uống"` tháng `2026-11` là `5,000,000 VND`, *When* chi tiêu ròng đạt `4,000,000 VND` (80%), *Then* hiển thị đã chi `4,000,000 VND`, còn lại `1,000,000 VND` và cảnh báo ngưỡng 80% kèm icon/text.
- **AC-BDG-01.2 (Timezone boundary):** *Given* timezone `Asia/Ho_Chi_Minh (UTC+7)`, *When* ghi nhận chi tiêu lúc `2026-11-30 23:45` giờ địa phương, *Then* tính vào ngân sách tháng `2026-11` (không bị đẩy sang `2026-12`).
- **AC-BDG-01.3 (Currency isolation):** *Given* ngân sách đặt bằng `VND`, *When* phát sinh chi tiêu cùng danh mục bằng `USD`, *Then* giao dịch `USD` không cộng vào ngân sách `VND`.

### US-RPT-01: Báo cáo Dòng tiền Ròng Tách Tiền tệ
> *As a user, I want to view income, expenses, and net cash flow per currency, so that I avoid misleading currency mixing.*
- **AC-RPT-01.1 (Formula):** *Given* tháng `2026-11` có Thu `30,000,000 VND`, Chi `12,000,000 VND`, Hoàn tiền `1,000,000 VND`, Chuyển khoản `5,000,000 VND`, *When* xem báo cáo `VND`, *Then* Thu = `30,000,000 VND`, Chi ròng = `11,000,000 VND`, Net Cash Flow = `+19,000,000 VND` (ghi chú rõ loại trừ chuyển khoản).
- **AC-RPT-01.2 (Non-mixing):** *Given* có cả `VND` và `USD`, *When* mở báo cáo, *Then* tách riêng 2 khối/tab `VND` và `USD`, không cộng gộp.
- **AC-RPT-01.3 (Empty state):** *Given* kỳ lọc chưa có giao dịch `POSTED`, *When* tải xong, *Then* hiển thị `0 VND` kèm thông báo hướng dẫn tạo giao dịch.
