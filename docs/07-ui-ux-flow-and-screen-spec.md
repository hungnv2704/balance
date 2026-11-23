# 07 — Đặc tả Thiết kế UI/UX, Design System Tokens & Screen Specifications

> **Tham chiếu chuẩn:** `ui-ux-rules/rules/AGENTS.md`, `frontend-design-direction`, `01-product-vision-and-mvp.md`, `02-business-domain-and-requirements.md`, `03-architecture-and-tech-stack.md`.  
> **Phạm vi:** Design specification only (chưa code implementation).

---

## 1. Design Direction & Visual Tokens

### 1.1 Typography (1 Font Family, 2 Weights)
- **Font Family:** `Inter`, system-ui, sans-serif (tuyệt đối không trộn serif, không dùng decorative italics).
- **Font Weights:** Chỉ dùng đúng **2 weights**:
  - `400` (Regular): Body text, table cells, helper text, placeholders, metadata.
  - `600` (Semibold): Page titles, section headers, card titles, button labels, active nav items, financial totals.
- **Số liệu tài chính:** Bắt buộc bật `font-variant-numeric: tabular-nums` trên toàn bộ số tiền, tỷ giá, phần trăm, và cột số trong bảng để thẳng cột tuyệt đối.
- **Type Scale:**
  - Page Title: `24px / 32px` (`600`)
  - Section / Card Title: `16px / 24px` (`600`)
  - KPI Hero Number: `24px / 32px` (`600`, `tabular-nums`)
  - Body / Input / Table Cell: `14px / 20px` (`400`)
  - Label / Helper / Badge: `12px / 16px` (`400` hoặc `600` cho badge/label)

### 1.2 Color System (1 Accent + Neutrals + Semantic Meaning)
Mọi cặp màu text/nền đạt chuẩn tương phản **WCAG AA** (`>= 4.5:1` text thường, `>= 3:1` text lớn & UI components).

| Nhóm | Token | Giá trị (Light Mode) | Quy tắc sử dụng |
| :--- | :--- | :--- | :--- |
| **Accent (Actions only)** | `--color-accent` | `#4338CA` (Indigo 700) | **Duy nhất 1 màu nhấn** cho Primary buttons, text links, focus ring, active nav indicator, active tab. **Cấm** dùng cho trang trí hoặc text tĩnh. |
| | `--color-accent-hover` | `#3730A3` (Indigo 800) | Hover state của Primary button / link. |
| | `--color-accent-subtle` | `#EEF2FF` (Indigo 50) | Nền nhẹ cho active nav item / selected option. |
| **Neutrals** | `--bg-canvas` | `#F8FAFC` (Slate 50) | Nền tổng thể ứng dụng. |
| | `--bg-surface` | `#FFFFFF` | Nền card, modal, drawer, table. |
| | `--bg-subtle` | `#F1F5F9` (Slate 100) | Nền skeleton, table header, disabled input. |
| | `--border-hairline` | `#E2E8F0` (Slate 200) | Viền `1px` tách card, row, input border. |
| | `--text-primary` | `#0F172A` (Slate 900) | Tiêu đề, số tiền, nội dung chính. |
| | `--text-secondary` | `#475569` (Slate 600) | Label, mô tả phụ, metadata. |
| | `--text-muted` | `#64748B` (Slate 500) | Placeholder, helper text. |
| **Semantic (Meaning only)** | `--color-success` | `#15803D` / bg `#F0FDF4` | `POSTED`, Thu nhập (Income), Net Cash Flow dương. **Luôn kèm icon/text.** |
| | `--color-warning` | `#B45309` / bg `#FFFBEB` | `PENDING`, Ngân sách `80%–99%`, Soft warning số dư âm. **Luôn kèm icon/text.** |
| | `--color-danger` | `#B91C1C` / bg `#FEF2F2` | Lỗi validation, Destructive actions, Ngân sách `>= 100%`, `VOIDED`/`REVERSED`. **Luôn kèm icon/text.** |
| | `--color-info` | `#334155` / bg `#F1F5F9` | `DRAFT`, `ADJUSTMENT`. |

### 1.3 Layout, Spacing, Surfaces & Alignment
- **Spacing Scale:** Bội số của `4px` / `8px` (`4, 8, 12, 16, 24, 32, 48px`). Nhóm liên quan gần nhau (label-input `4–8px`), tách giữa các nhóm (`16–24px`), row padding tối thiểu `12–16px`.
- **Touch Targets:** Mọi nút bấm, nav item, combobox option, row clickable đạt chiều cao tối thiểu **`44px`**.
- **Alignment:** Căn lề trái (left-aligned) nhất quán theo 1 trục dọc; **chỉ cột số tiền & phần trăm trong bảng căn phải (right-aligned)**.
- **Surfaces (Hairlines over Shadows):** Static cards phẳng với viền **`1px solid var(--border-hairline)`**; shadow nhẹ chỉ dành cho floating layers (dropdown, combobox, modal, toast).

---

## 2. Navigation & Information Architecture

- **6 nhãn điều hướng chính (1–2 từ, nhất quán toàn app):**
  1. **Tổng quan** (`/dashboard`)
  2. **Thu nhập** (`/incomes`)
  3. **Chi tiêu** (`/expenses`)
  4. **Chuyển khoản** (`/transfers`)
  5. **Ngân sách** (`/budgets`)
  6. **Tài khoản** (`/accounts`)
- **Utility Menu:** **Cài đặt** (`/settings` — Múi giờ, Tiền tệ cơ sở, Export CSV/JSON, Xóa tài khoản, Đăng xuất).
- **Responsive:** Desktop (`>= 1024px`) dùng Left Sidebar `240px`; Mobile (`< 1024px`) dùng Bottom Nav Bar (5 mục: `Tổng quan`, `Thu nhập`, `Chi tiêu`, `Ngân sách`, `Thêm` mở drawer chứa `Chuyển khoản`, `Tài khoản`, `Cài đặt`).

---

## 3. Quick-Log / Simple Mode UX vs Multi-Account Mode (`BR-ACC-06`)

| Tiêu chí | Simple Mode (1 Tài khoản `active` — Default `"Sổ chung"`) | Multi-Account Mode (`>= 2` Tài khoản `active`) |
| :--- | :--- | :--- |
| **Form Thu nhập / Chi tiêu** | Trường Tài khoản thu gọn thành 1 dòng: `Tài khoản: Sổ chung (VND) [Thay đổi]`. Mặc định chọn sẵn `"Sổ chung"`. | Trường Tài khoản hiện đầy đủ dạng **Searchable Combobox** (hiển thị kèm số dư hiện tại). |
| **Cảnh báo số dư âm** | **Không hiển thị** cảnh báo đỏ/vàng khi `"Sổ chung"` âm (tránh làm phiền người chỉ ghi chi tiêu). | Hiển thị **Soft Warning** màu Amber kèm icon giải thích số dư sẽ âm sau giao dịch. |
| **Mục Chuyển khoản** | Hiện **Empty Guidance State**: *"Cần ít nhất 2 tài khoản để thực hiện chuyển khoản nội bộ"* + CTA `"Tạo tài khoản thứ 2"`. | Mở khóa đầy đủ Form & Lịch sử chuyển khoản. |
| **Đổi Base Currency** | Nếu `"Sổ chung"` có `0` giao dịch, đổi `base_currency_code` tự cập nhật tiền tệ của `"Sổ chung"`. | Đổi `base_currency_code` chỉ đổi ưu tiên hiển thị báo cáo. |

---

## 4. Screen-by-Screen Spec & Interaction States

1. **Tổng quan (`/dashboard`):**
   - Bộ lọc kỳ + bộ lọc tài khoản + **Currency Tabs** (`VND` | `USD`) khi có đa tiền tệ (không cộng gộp khác tiền tệ).
   - 4 KPI Cards (viền `1px`): `Tổng số dư (Posted)`, `Tổng Thu nhập`, `Chi tiêu ròng`, `Dòng tiền ròng (Net Cash Flow)` (ghi chú loại trừ chuyển khoản & điều chỉnh).
   - Drill-down trực tiếp sang `/incomes` hoặc `/expenses` khi bấm vào KPI hoặc danh mục.
2. **Thu nhập (`/incomes`) & Chi tiêu (`/expenses`):**
   - Tách biệt route, form, và danh mục (`INCOME` vs `EXPENSE`).
   - Form: Số tiền (mask theo `minor_unit`), Danh mục (Searchable + Scrollable Combobox), Tài khoản (Progressive Disclosure), Ngày (`DD/MM/YYYY`), Nguồn thu / Cửa hàng, Ghi chú. Nút hành động rõ nghĩa: `"Lưu & Ghi sổ"`, `"Lưu chờ xử lý"`, `"Lưu nháp"`, `"Hủy"`.
   - Hoàn tiền (`EXPENSE_REFUND`): Mở từ chi tiết giao dịch Chi tiêu `POSTED`, khóa danh mục theo gốc, chặn inline nếu `refund > refundable_remaining`.
   - Hủy/Đảo: `DRAFT`/`PENDING` dùng **Optimistic UI** (rollback + `"Thử lại"` khi lỗi); `POSTED` mở modal xác nhận nhập lý do hủy (`VOIDED`/`REVERSED`).
3. **Chuyển khoản (`/transfers`):**
   - Nguồn & Đích dạng Searchable Combobox (tự loại trừ nguồn khỏi đích).
   - Nếu khác tiền tệ: tự mở trường Số tiền thực nhận & Tỷ giá quy đổi.
   - Tùy chọn Phí chuyển khoản (kèm helper text tách thành `EXPENSE` riêng).
4. **Ngân sách (`/budgets`):**
   - Chọn tháng + Currency Tabs.
   - Progress Bar theo ngưỡng: `< 80%` (Accent), `80%–99%` (Amber + icon + text `"Sắp đạt ngưỡng"`), `>= 100%` (Red + icon + text `"Vượt ngân sách"`).
5. **Tài khoản (`/accounts`):**
   - Tách `Đang hoạt động` và `Đã lưu trữ`. Khóa trường tiền tệ nếu đã có `>= 1` giao dịch; disable nút `"Lưu trữ"` ở tài khoản `active` duy nhất cuối cùng.
   - Modal Điều chỉnh số dư: nhập số dư thực tế -> tự tính chênh lệch `ADJUSTMENT_CREDIT`/`DEBIT`.
6. **Cài đặt (`/settings`):**
   - Múi giờ, Tiền tệ cơ sở, Export CSV/JSON (Progress bar theo bước + ETA nếu `> 10s`), Xóa tài khoản vĩnh viễn 2 bước (Step-up Auth).

---

## 5. Cross-Cutting Interaction Rules

- **4 ngưỡng Loading (Cấm spinner):** `< 1s` không loader (trì hoãn 300ms); `1–10s` dùng **Skeleton** khớp layout; `> 10s` dùng **Progress Bar + ETA**; tap/click nhanh dùng **Optimistic UI + Rollback + Retry**.
- **Input Masking:** `VND`/`JPY` (`minor_unit = 0`) chặn nhập số thập phân; `USD`/`EUR` (`minor_unit = 2`) tối đa 2 số lẻ. Validate `onBlur` và `onChange` (sau blur đầu tiên).
- **Double-submit Prevention:** Sinh `Idempotency-Key` (UUIDv4) theo phiên form; disable nút khi đang gửi; tái sử dụng cùng key khi user bấm `"Thử lại"` sau timeout mạng.
