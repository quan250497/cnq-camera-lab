# Mẫu HLV

1. Mở trang → **Ghi mẫu HLV** → chọn bài, góc (chính diện / bên hông) → **Ghi mẫu đúng**: máy đọc nhịp Chậm, HLV làm đúng ~10 lần.
2. (Tuỳ chọn) chọn pha, gõ câu sửa → **Ghi lỗi mẫu**: HLV cố ý làm sai 6 giây. Máy sẽ nhận lỗi này và đọc đúng câu đó.
3. **Tải file JSON** → đặt file vào thư mục này và thêm tên vào `index.json` → `"files": ["mau-bai1-chinh-dien-2026-11-20.json"]`.
4. Video thị phạm (nếu có): đặt vào `mau/video/` và khai báo `"video": {"1": "video/bai1.mp4"}`.

File mẫu chứa: thống kê góc từng pha (trung bình ± độ lệch), lỗi mẫu, và chuỗi tọa độ khớp chuẩn hóa theo độ rộng vai.
