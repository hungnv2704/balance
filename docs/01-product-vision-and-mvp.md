# 01 — Tầm nhìn Sản phẩm & Phạm vi MVP

## 1. Tầm nhìn & Mục tiêu Sản phẩm (Product Vision & Goals)

- **Tầm nhìn (Vision):** Xây dựng một ứng dụng quản lý tài chính cá nhân đáng tin cậy, minh bạch và ít ma sát cho việc sử dụng hằng ngày, trong đó **Thu nhập (Income)** và **Chi tiêu (Expenses)** là hai năng lực nghiệp vụ độc lập, bình đẳng (first-class capabilities), giúp người dùng kiểm soát dòng tiền thực tế, hiểu rõ số dư từng tài khoản và ra quyết định tài chính chính xác.
- **Mục tiêu cốt lõi:**
  1. **Tính chính xác & giải thích được (Explainable Financial Truth):** Mọi số dư tài khoản, tổng thu, tổng chi và báo cáo đều đối soát (reconcile) 100% tới từng giao dịch gốc.
  2. **Tách biệt ngữ nghĩa dòng tiền:** Không bao giờ nhầm lẫn giữa thu nhập thực, chi tiêu thực và việc chuyển tiền nội bộ (transfers).
  3. **Ghi nhận nhanh, an toàn dữ liệu:** Giảm thao tác lặp lại hằng ngày, chống mất dữ liệu hoặc tạo trùng giao dịch khi mạng chập chờn hoặc bấm đúp.
  4. **Quyền riêng tư & quyền kiểm soát dữ liệu:** Người dùng toàn quyền xuất (export) và xóa dữ liệu cá nhân; không dark patterns.

### Chỉ số đo lường giá trị (Privacy-Preserving Product Metrics)
*(Không thu thập PII hay nội dung/số tiền giao dịch vào analytics)*
- **Time-to-Log:** Thời gian trung bình hoàn tất ghi nhận 1 giao dịch Income hoặc Expense < 15 giây.
- **Weekly Active Logging Retention (W4):** Tỷ lệ người dùng duy trì ghi nhận >= 3 giao dịch/tuần sau 4 tuần >= 40%.
- **Reconciliation Integrity Rate:** Tỷ lệ số dư tài khoản khớp 100% với tổng hợp giao dịch `POSTED` = 100% (bất biến hệ thống).
- **Duplicate Submission Prevention Rate:** 0 giao dịch trùng lặp phát sinh từ retry/double-click.

---

## 2. Nhóm Người dùng Mục tiêu (Target Personas & JTBD)

> *Lưu ý: Các Persona dưới đây là giả định định hướng sản phẩm (product framing assumptions), chưa qua khảo sát khách hàng thực tế.*

| Persona | Bối cảnh (Context) | Nỗi đau (Pain Points) | Job-to-be-Done (JTBD) |
| :--- | :--- | :--- | :--- |
| **1. Nhân viên văn phòng (Salaried Professional)** | Thu nhập cố định hằng tháng (1–2 nguồn), chi tiêu hằng ngày qua tiền mặt, thẻ ghi nợ, ví điện tử. | Cuối tháng không rõ tiền đi đâu; nhiều app gộp chuyển khoản giữa các ví vào "chi tiêu" làm sai báo cáo. | *"Khi nhận lương và chi tiêu qua nhiều ví, tôi muốn tách bạch thu - chi - chuyển khoản và theo dõi ngân sách từng nhóm để kiểm soát tiết kiệm cuối tháng."* |
| **2. Freelancer / Đa nguồn thu (Multi-source Earner)** | Thu nhập biến động từ nhiều khách hàng/dự án, có thể bằng nhiều loại tiền tệ (VND, USD). | Khó theo dõi nguồn thu nào chính, khoản nào đã xuất hóa đơn (`PENDING`) vs thực nhận (`POSTED`). | *"Khi làm nhiều dự án, tôi muốn quản lý chi tiết từng nguồn thu nhập và trạng thái thực nhận để biết chính xác dòng tiền khả dụng."* |
| **3. Người quản lý đa tài khoản (Multi-account Tracker)** | Sở hữu 3–5 tài khoản (ngân hàng, tiền mặt, tiết kiệm), hay luân chuyển tiền và có hoàn tiền (refund). | Số dư trên app hay lệch thực tế do xử lý sai phí chuyển khoản, số dư đầu kỳ hoặc hoàn tiền. | *"Khi chuyển tiền giữa các tài khoản hoặc nhận hoàn tiền mua sắm, tôi muốn số dư và báo cáo phản ánh đúng bản chất tài chính."* |

---

## 3. Phạm vi MVP vs Giai đoạn sau (MVP Scope Boundary)

| Phân hệ / Năng lực | In-Scope (MVP — Phase 1) | Out-of-Scope (Phase 2+) |
| :--- | :--- | :--- |
| **Identity & Preferences** | Đăng ký/đăng nhập, quản lý phiên an toàn, cấu hình múi giờ (timezone), ngôn ngữ, đơn vị tiền tệ cơ sở (base currency). | MFA (TOTP/WebAuthn), sinh trắc học, chia sẻ workspace hộ gia đình (Multi-user Household). |
| **Accounts** | Tạo/sửa/lưu trữ (archive) nhiều tài khoản (Tiền mặt, Ngân hàng, Ví điện tử, Thẻ tín dụng dạng theo dõi nợ cơ bản, Tiết kiệm), số dư đầu kỳ, điều chỉnh số dư (balance adjustment), đa tiền tệ theo từng tài khoản. | Đồng bộ ngân hàng tự động (Open Banking / Bank Feeds), danh mục đầu tư/chứng khoán/crypto. |
| **Income** | Ghi nhận thu nhập độc lập, nguồn thu (source), danh mục thu nhập (tùy chỉnh/archive), trạng thái (`DRAFT`, `PENDING`, `POSTED`, `VOIDED`, `REVERSED`), ghi chú, lọc & tìm kiếm. | Đính kèm hóa đơn/chứng từ (Attachments/OCR), tính thuế TNCN tự động, quy tắc định kỳ tự động. |
| **Expenses** | Ghi nhận chi tiêu độc lập, người nhận/cửa hàng (merchant/payee), danh mục chi tiêu, trạng thái (`DRAFT`, `PENDING`, `POSTED`, `VOIDED`, `REVERSED`), hoàn tiền (refund) liên kết giao dịch gốc. | Chia hóa đơn nhóm (Split bills), quét hóa đơn AI/OCR. |
| **Transfers** | Chuyển tiền giữa 2 tài khoản cùng chủ sở hữu (cùng tiền tệ hoặc khác tiền tệ có nhập tay tỷ giá/số tiền nhận thực tế), tách phí chuyển khoản thành Expense riêng. | Chuyển tiền P2P cho người dùng khác, tự động lấy tỷ giá thị trường real-time. |
| **Budgets** | Ngân sách theo tháng cho từng danh mục chi tiêu (1 tiền tệ xác định), tính trên chi tiêu thực tế (`POSTED`), cảnh báo ngưỡng (80%, 100%). | Ngân sách cộng dồn (Rollover), ngân sách linh hoạt tuần/năm, dự báo AI. |
| **Financial Reports** | Tổng quan số dư theo từng tiền tệ, Báo cáo Thu nhập, Báo cáo Chi tiêu, Dòng tiền ròng (Net Cash Flow = Income - Expenses, loại trừ Transfers), Tiến độ ngân sách. Tuyệt đối không gộp tiền tệ khác loại. | Báo cáo quy đổi đa tiền tệ tự động, biểu đồ dự báo (Forecasting), báo cáo thuế. |
| **Import / Export / Privacy** | Export dữ liệu cá nhân ra CSV/JSON chuẩn hóa; Xóa tài khoản & toàn bộ dữ liệu (Data Deletion với grace period). | Import hàng loạt từ CSV/Excel kèm phát hiện trùng lặp (Bulk Import), đính kèm ảnh hóa đơn. |

---

## 4. Phân tầng Mức độ Ưu tiên (Prioritized Backlog)

| Mức độ | Epic / Hạng mục | Lý do ưu tiên |
| :--- | :--- | :--- |
| **P0 (MVP Core)** | **1. Identity, Auth & Preferences** | Nền tảng bảo mật, phân quyền sở hữu và xác định ranh giới ngày/tiền tệ. |
| **P0 (MVP Core)** | **2. Accounts Management** (CRUD, Opening Balance, Archive) | Mọi giao dịch đều phải gắn với tài khoản sở hữu hợp lệ. |
| **P0 (MVP Core)** | **3. Income Management** (Module riêng, Categories, States, Idempotency) | Năng lực cốt lõi thứ nhất của sản phẩm. |
| **P0 (MVP Core)** | **4. Expense Management** (Module riêng, Categories, States, Idempotency) | Năng lực cốt lõi thứ hai của sản phẩm. |
| **P0 (MVP Core)** | **5. Internal Transfers** (Cùng & khác tiền tệ, Atomic execution) | Bắt buộc có ở MVP để người dùng không ghi chuyển khoản thành thu/chi giả. |
| **P0 (MVP Core)** | **6. Core Financial Reports** (Số dư, Thu/Chi, Net Cash Flow tách tiền tệ, Drill-down) | Mang lại giá trị quan sát ngay từ dữ liệu đã nhập. |
| **P1 (MVP Complete)** | **7. Expense Refunds & Reimbursements** (Gắn giao dịch gốc) | Đảm bảo độ chính xác chi tiêu ròng trong thực tế. |
| **P1 (MVP Complete)** | **8. Transfer Fees** (Tự động tách thành Expense) | Hoàn thiện bài toán chuyển khoản thực tế. |
| **P1 (MVP Complete)** | **9. Balance Adjustments** (Điều chỉnh đối soát số dư) | Xử lý lệch sổ sách thực tế mà không làm bẩn báo cáo Thu/Chi. |
| **P1 (MVP Complete)** | **10. Monthly Budgets & Alerts** (80% / 100%, tách tiền tệ) | Nhu cầu quản lý chi tiêu chủ động cao nhất của người dùng. |
| **P1 (MVP Complete)** | **11. Data Export (CSV/JSON) & Account Deletion** | Đảm bảo quyền kiểm soát dữ liệu cá nhân. |
| **P2 (Phase 2+)** | **12. Recurring Transactions** (User-confirmed drafts/reminders) | Giảm thao tác nhập liệu lặp lại (lương, tiền nhà). |
| **P2 (Phase 2+)** | **13. Bulk CSV Import** (Preview + Duplicate detection) | Hỗ trợ chuyển dữ liệu từ sao kê ngân hàng / app khác. |
| **P2 (Phase 2+)** | **14. Attachments / Receipts** & **MFA (TOTP/Passkeys)** | Lưu trữ chứng từ an toàn và tăng cường bảo mật tài khoản. |
