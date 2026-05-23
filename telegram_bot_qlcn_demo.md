# Cấu Trúc Xây Dựng Bot Telegram (Google Apps Script)

Tài liệu này tóm tắt toàn bộ kiến trúc và cách xây dựng bot Telegram trong dự án hiện tại. Bạn có thể dùng tài liệu này làm tham khảo (blueprint) để phát triển các dự án bot Telegram khác trên nền tảng Google Apps Script (GAS) tương tác với Google Sheets.

Tài liệu tập trung vào **mô hình và nguyên lý** hoạt động thay vì cách đọc/ghi các cột cụ thể trong Sheet.

---

## 1. Tổng Quan Kiến Trúc (Architecture Overview)

Dự án sử dụng kiến trúc **Serverless** thông qua Google Apps Script, nhận luồng dữ liệu (Webhook) trực tiếp từ Telegram API. 

- **Điểm vào (Entry point):** Hàm `doPost(e)` nhận POST request từ Telegram.
- **Xử lý State (Trạng thái đa bước):** Quản lý phiên qua `CacheService` để nhận diện ngữ cảnh người dùng (đang nhập dở bước nào).
- **Tương tác UI:** Sử dụng triệt để *Inline Keyboard* để điều hướng và giới hạn thao tác sai của người dùng.
- **Tối ưu tốc độ (Caching):** Dùng biến toàn cục (in-memory) và `CacheService` để tránh quá tải hạn ngạch (quota) của Google Sheets API.
- **Phân quyền (Authorization):** Tách biệt quyền User, Admin và Shareholder (Cổ đông).

---

## 2. Cấu Trúc Thư Mục & Modules

Hệ thống được chia thành các file/module chuyên biệt (Separation of Concerns) để dễ bảo trì:

| Module | Chức Năng Chính |
| :--- | :--- |
| **Main.gs** | Chứa `doPost` nhận webhook. Điều hướng xử lý `CallbackQuery` (khi bấm nút) và `TextMessage` (khi gõ chữ). |
| **Router.gs** | Xử lý định tuyến nhanh cho các menu tĩnh (stateless) và quyết định khi nào cần gửi hiệu ứng `typing` (với các hàm xử lý nặng). |
| **Telegram.gs** | Wrapper giao tiếp với Telegram API (`sendMessage`, `editMessage`, `deleteMessage`, `answerCallback`, `sendChatAction`). Quản lý xoá tin nhắn cũ để dọn dẹp UI chat. |
| **StateManager.gs** | Quản lý state của người dùng (Session). Hỗ trợ quá trình nhập liệu nhiều bước (chọn khách hàng -> nhập ngày -> nhập tiền). |
| **Sheets.gs** | Lớp Data Access. Chịu trách nhiệm tương tác trực tiếp với Google Sheets (lấy dữ liệu, ghi dữ liệu, xoá dòng). |
| **Config.gs** | Quản lý cấu hình lấy từ `ScriptProperties`. Chứa danh sách ID Chat được phép, Token Bot, cấu hình Sheet IDs. |
| **Menu.gs** | Chuyên tạo cấu trúc JSON cho các bàn phím Telegram (InlineKeyboardMarkup). |
| **Admin.gs** | Chứa các tính năng dành riêng cho Admin (ví dụ broadcast tin nhắn, clear cache...). |
| **Logger.gs** | Quản lý ghi nhật ký (error, info) vào Google Sheet riêng hoặc stackdriver để dễ debug. |
| **Trigger.gs** | Cài đặt các tác vụ chạy theo lịch (cron job) như gửi báo cáo định kỳ hàng ngày (`sendDailyDebtReport`). |

---

## 3. Quản Lý Phiên (State & Session Management)

Khi làm bot trên Telegram, việc nhập liệu thường cần qua nhiều bước. Vì HTTP Webhook là stateless (không trạng thái), bot cần biết người dùng đang ở bước nào.

**Cơ chế hoạt động của `StateManager`:**
1. Khi người dùng bấm nút "Thêm dữ liệu" và chọn "Khách Hàng A", bot lưu một Object State:
   ```json
   {
       "step": "enterAmount1",
       "customerName": "Khách Hàng A",
       "messageId": 1234
   }
   ```
2. State này được lưu vào bộ nhớ tạm thời (`_tempStates`) và `CacheService` (thời hạn sống thường là vài tiếng).
3. Khi người dùng gõ tin nhắn số tiền, `Main.gs` sẽ gọi `StateManager.load(chatId)` để lấy State trên.
4. Bot biết được số tiền này là của "Khách Hàng A" do state lưu trữ. Sau khi ghi vào Google Sheets thành công, gọi `StateManager.clear(chatId)` để kết thúc phiên.

---

## 4. Xử Lý Luồng Giao Tiếp (Webhook Workflow)

Quá trình luân chuyển dữ liệu từ Telegram đến Apps Script như sau:

1. **Nhận Webhook (`doPost`)**: Phân tách data JSON từ Telegram ra thành hai luồng chính: `callback_query` (người dùng bấm nút Inline) hoặc `message` (người dùng gửi text/ảnh).
2. **Kiểm tra Quyền (Auth Check)**: 
   - `Config.isAuthorizedChat(chatId)`: Kiểm tra chatId có trong danh sách được phép không. Tránh người lạ vào sử dụng bot.
3. **Định tuyến Callback (`handleCallbackQuery`)**:
   - Nếu bấm menu điều hướng -> Gửi menu mới.
   - Nếu bấm chọn dữ liệu -> Cập nhật State (`StateManager.save()`) và yêu cầu người dùng nhập text.
4. **Định tuyến Text (`handleTextMessage`)**:
   - Lấy State của người dùng để biết họ đang gõ chữ cho mục đích gì (ví dụ: `state.step === 'awaitingCustomerName'`).
   - Chạy logic kiểm tra chuỗi regex định dạng (đúng cấu trúc ngày tháng, số tiền không...).
   - Nếu thành công -> Tương tác với `Sheets.gs` -> Xóa State.

---

## 5. Kỹ Thuật Tối Ưu Caching & Hiệu Năng

Google Apps Script rất dễ bị chậm hoặc lỗi vượt quá số lần gọi API nếu không tối ưu. Dự án sử dụng các chiến lược sau:

- **Cache Config & Properties**: Các dữ liệu cấu hình như Telegram Token, Mảng Chat ID... được load 1 lần và lưu trên RAM trong suốt chu kỳ chạy của file (`_configCache`).
- **Data Cache (CacheService)**: Dữ liệu lớn ít thay đổi (ví dụ: Danh sách khách hàng, Hạn mức nợ) được lưu bằng `CacheService` để bot có thể tạo Inline Keyboard ngay lập tức thay vì phải tốn 2-3s tải lại bảng tính mỗi lần bấm.
- **In-Memory Logic**: Thay vì xử lý công thức toán học và thống kê trên Sheet (gây xung đột onEdit hoặc tốc độ chậm), bot lấy khối lượng dữ liệu lớn xuống mảng JavaScript `getDataRange().getValues()`, tính toán báo cáo trong bộ nhớ rồi nhả ra chuỗi markdown gửi đi.

---

## 6. Xử Lý Giao Diện Telegram (UI/UX)

- **Edit Message thay vì Send Message**: Để tránh làm đầy màn hình chat, bot sử dụng hàm `Telegram.editMessageText` để thay đổi nội dung tin nhắn hiện tại khi người dùng bấm các phím điều hướng qua lại (Back, Next).
- **Cleanup Trashed Messages**: Telegram API cung cấp file_id hoặc message_id. Dự án lưu mảng các `message_id` vào `PropertiesService` để có hàm `cleanupTrackedMessages` dọn dẹp các thông báo lỗi, rác mà bot sinh ra sau 1 thời gian.
- **Menu System linh hoạt**: Menu được xây dựng thành các cụm nút rõ ràng, tái sử dụng (trong `Menu.gs`), sử dụng `callback_data` có các tiền tố định dạng như `customer_ABC`, `year_2023`, `confirm_delete_123` để nhận diện dễ dàng ở hàm router.

---

## Tóm Lại Để Áp Dụng Cho Dự Án Khác:

1. **Copy Khung Sườn**: Bê nguyên cấu trúc các file `Main`, `Router`, `Telegram`, `StateManager`, `Config`, `Menu`.
2. **Tuỳ Biến Sheets.gs**: Trong dự án mới, viết lại toàn bộ logic trong `Sheets.gs` (cách tính toán mảng, cột A, cột B tuỳ theo cấu trúc sheet mới).
3. **Cập Nhật Menu**: Thay đổi nội dung các nút bấm trong `Menu.gs` và các case điều hướng `callback_data` trong `Main.gs` sao cho phù hợp với flow của dự án mới.
4. **Giữ Nguyên Flow**: Flow tạo State -> Bấm nút cập nhật State -> Gõ chữ hoàn tất State vẫn sẽ không thay đổi bất kể dự án là quản lý kho, nhân sự hay chấm công.
