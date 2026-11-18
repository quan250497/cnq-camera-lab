# cnq-camera-lab — Huấn luyện viên camera · Bơi ếch trên cạn

Mở: https://quan250497.github.io/cnq-camera-lab/ (điện thoại & máy tính, Chrome/Safari).

- Nhận diện tư thế bằng MediaPipe Pose chạy **ngay trên máy** (thư viện `lib/mediapipe/`, mô hình `models/` nằm trong kho, không gọi CDN). Không gửi ảnh/video đi đâu.
- 4 bài: 1 Tay ếch đứng · 2 Chân ếch một chân · 3 Thở + đầu · 4 Phối hợp. 5 màn: Chọn bài → Chuẩn bị → Xem mẫu → Tập → Kết quả.
- Ngưỡng chấm hiện là **ngưỡng tạm** (theo mô tả HLV). Có mẫu HLV (`mau/`) thì tự dùng mẫu.
- `?mo-phong=1`: chạy bằng khung xương mô phỏng, không cần camera (để thử giao diện).

## Mã nguồn
- `js/engine.js` — tính góc khớp, nhận pha, đếm lần, nhắc lỗi (hàm thuần).
- `js/demo.js` — khung xương mẫu động + dữ liệu mô phỏng.
- `js/app.js` — giao diện; `js/pose.js` — camera + MediaPipe; `js/voice.js` — giọng đọc.
- Kiểm thử: `node tests/sim.test.mjs`

## Khoảng cách đặt máy tối thiểu (ước tính hình học, người lớn 1,65 m / trẻ 1,30 m)
| Bài | ĐT dọc, cam trước | Webcam laptop | Cam sau góc rộng |
|---|---|---|---|
| 1 Tay (đầu→hông, tay giơ) | 1,5 m / 1,2 m | 2,0 m / 1,6 m | 0,9 m / 0,7 m |
| 2 Chân (hông→bàn chân) | 1,1 m / 0,8 m | 1,4 m / 1,1 m | 0,6 m / 0,5 m |
| 3 Đầu (đầu→vai) | 0,7 m / 0,6 m | 0,7 m / 0,6 m | 0,4 m / 0,3 m |
| 4 Phối hợp (cả người, tay giơ) | 1,9 m / 1,5 m | 3,3 m / 2,6 m | 1,0 m / 0,8 m |
