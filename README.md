# Mezon Lieng Bot

Bot chơi game bài Liêng (Three-card Poker) tích hợp trên nền tảng Mezon.

## Tính năng

### Liêng (Three-card Poker)
*   **Chế độ chơi:** 2-8 người.
*   **Luật chơi:**
    *   Mỗi người chơi được chia 3 lá bài.
    *   **Thứ tự mạnh yếu:** Sáp (3 lá giống nhau) > Liêng (3 lá liên tiếp) > Ảnh (3 lá đầu người) > Điểm (Tổng điểm mod 10).
    *   **Vòng cược:** 1 vòng cược duy nhất (Theo/Tố/Bỏ/Tất tay).
*   **Lệnh:** `*lieng start [bet] @users`

## Cài đặt và Chạy

### Yêu cầu
*   Node.js >= 20
*   PostgreSQL
*   Mezon Token

### Các bước cài đặt
1.  **Clone repo:** `git clone ...`
2.  **Cài đặt dependencies:** `npm install`
3.  **Cấu hình .env:** (Xem `env.example`)
4.  **Chạy server:** `npm run dev`

## Hướng dẫn sử dụng

### Lệnh Liêng
*   `*lieng start 5000 @user1 @user2`: Tạo bàn Liêng 3 người với mức cược 5000.
*   Game sẽ gửi tin nhắn mời. Người chơi bấm "Tham gia" để vào bàn.
*   Sau khi chia bài, người chơi sẽ nhận bài qua tin nhắn riêng (Ephemeral).
*   Đến lượt, sử dụng các nút bấm trên kênh chat:
    *   **Theo (Call):** Cược bằng người trước.
    *   **Tố (Raise):** Tố thêm tiền (mặc định +1 lần cược bàn).
    *   **Bỏ (Fold):** Bỏ bài, chấp nhận mất tiền cược.

## Cấu trúc dự án
*   `src/bot/base/`: Chứa `GameBaseService` (Logic chung cho các game bài).
*   `src/bot/commands/lieng/`: Module game Liêng.
*   `src/mezon/`: Client SDK integration.

## Kiểm thử
Chạy unit test cho logic game:
```bash
npm test
```
