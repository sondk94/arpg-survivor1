# ARPG Survivor – Giai đoạn 0 (Prototype)

Bản đồ 1-1 *Đồng hoang Mục rữa*, 10 phút, lớp Pháp sư Nguyên tố nhánh Lửa. Chạy trên trình duyệt, HTML5 Canvas + JavaScript thuần, không cần build, không có thư viện ngoài. Đồ hoạ là hình khối đơn giản.

## Chạy game

Cần Node.js 18 trở lên (chỉ dùng làm máy chủ tĩnh):

```bash
npm start
```

Mở `http://localhost:8080/`. Thêm `?debug` (`http://localhost:8080/?debug`) để bật sẵn bảng debug.

Không mở thẳng `index.html` bằng `file://`, vì trình duyệt chặn đọc file JSON. Máy chủ tĩnh nào cũng dùng được, ví dụ `python3 -m http.server`.

## Điều khiển

| Phím | Tác dụng |
|---|---|
| WASD / phím mũi tên | Di chuyển. Kỹ năng tự kích hoạt |
| Tab, C hoặc nút **+** | Mở/đóng bảng cộng điểm. Game dừng hẳn khi bảng mở |
| Shift + bấm "+" | Cộng 5 điểm thuộc tính một lần |
| Esc | Đóng bảng |
| 1 / 2 / 3 / 4 | Cộng nhanh 1 điểm Sức mạnh / Nhanh nhẹn / Thể lực / Năng lượng (không mở bảng) |
| F2 hoặc \` | Ẩn/hiện bảng debug |
| Điện thoại | Cần ảo ở nửa trái màn hình, nút + ở bên phải |

## Cấu trúc

```
index.html, css/style.css
data/                 ← TOÀN BỘ số liệu, sửa không cần đụng code
  config.json         chỉ số nhân vật, thuộc tính, công thức, vật phẩm rơi, testMode
  skills.json         6 kỹ năng nhánh Lửa, synergy, mốc mở (thật + thử nghiệm)
  monsters.json       quái thường, tinh anh + thuộc tính, trùm nhỏ, boss
  maps/1-1.json       kích thước, vật cản, nhịp sinh quái theo giai đoạn, sự kiện theo thời gian
src/core/             lõi mô phỏng, không dùng DOM (chạy được trong Node)
  game.js             một lượt chơi: sinh quái, AI, kỹ năng, sát thương, rơi đồ, boss
  progression.js      nhân vật vĩnh viễn: cấp, kinh nghiệm, cộng điểm, học kỹ năng, hoàn tác
  bot.js              bot di chuyển + tự cộng điểm (mô phỏng và debug)
src/ui/               vẽ canvas, HUD, bảng cộng điểm, cần ảo, debug, ghi log
tools/
  serve.mjs           máy chủ tĩnh
  sim.mjs             mô phỏng nhiều lượt 10 phút bằng bot
  test.mjs            kiểm tra các công thức trong tài liệu
```

Đặt `"testMode": false` trong `config.json` để dùng mốc mở kỹ năng thật (1/1/6/12/18/24) thay cho mốc nén (1/1/2/4/6/8).

## Chế độ debug

Bảng debug có: nhảy đến phút bất kỳ, +1 cấp, +5 điểm thuộc tính, +1 điểm kỹ năng, bất tử, hiện FPS/DPS (DPS trung bình 5 giây gần nhất), bật/tắt số sát thương, tăng tốc ×2/×4, sinh 300 quái để thử tải, giết hết quái, bot tự chơi và bỏ lượt. Lượt nào có dùng debug sẽ được đánh dấu `debugUsed: true` trong log.

## Ghi nhận buổi chơi thử

- Ở màn hình làng, nhập **Tên người chơi thử** trước khi chơi. Mỗi người mới nên bấm **Nhân vật mới**.
- Mỗi lượt tự ghi vào `localStorage` của trình duyệt: kết quả, thời gian sống, cấp đầu/cuối, số quái đã giết, nguyên nhân chết, điểm đã cộng vào đâu, số lần và tổng thời gian mở bảng, thời điểm lên cấp, máu boss còn lại, sát thương nhận theo từng nguồn, bình đã uống, số giây thiếu mana.
- Mục **Góp ý sau buổi chơi** lưu câu trả lời cho 3 câu hỏi.
- Màn hình làng hiện tóm tắt: số người hạ boss ở lượt đầu và thời gian mở bảng trung bình mỗi lần.
- **Xuất log (JSON)** tải toàn bộ log và góp ý về máy.

Nhân vật (cấp, điểm) chỉ giữ trong bộ nhớ của tab. Lưu game nằm ngoài phạm vi giai đoạn 0, nên tải lại trang là mất nhân vật, còn log thì vẫn giữ.

## Mô phỏng và kiểm tra

```bash
node tools/test.mjs
```

```bash
node tools/sim.mjs --runs 4 --build fireball --verbose
```

Tuỳ chọn của `sim.mjs`: `--build fireball|ring|balanced`, `--persist` (giữ cấp giữa các lượt), `--no-dodge` (bot không né đạn, vũng độc hay cú vồ), `--god`, `--seed N`.

## Những chỗ tài liệu chưa nói rõ: lựa chọn đang dùng

Đây là các giả định của bản prototype. Tất cả đều nằm trong JSON, đổi được ngay:

- **Kỹ năng khởi đầu:** nhân vật mới có sẵn Cầu Lửa cấp 1 (không thì cấp 1 không có đòn đánh). Vòng Than phải dùng điểm kỹ năng đầu tiên để học.
- **Vòng Than** chiếm 1 ô kỹ năng chủ động. Nó tốn 0,5 mana mỗi lần đốt (mỗi 0,5 giây) và tắt khi không đủ mana.
- **Vết cháy của Mưa Thiên Thạch:** 10 sát thương/giây (+3 mỗi cấp), đốt mỗi 0,5 giây.
- **Hoả Ngục Bùng Nổ:** tỉ lệ 10% ở cấp 1, +1% mỗi cấp sau đó, bán kính nổ 90 px, nổ dây chuyền được, không chí mạng.
- **Tường Lửa** đặt cách người chơi 60–140 px, nằm vuông góc với hướng tới cụm quái đông nhất (trong 450 px). Tường đốt mỗi 0,25 giây.
- **Chí mạng** áp dụng cho mọi đòn của kỹ năng, kể cả các lần đốt.
- **Tinh anh Cường hoá Lửa** nổ sau 0,35 giây có vòng báo trước, để người chơi kịp tránh.
- **Quái chỉ gây sát thương khi chạm:** Kẻ ném xương chạm gây 2 sát thương. Boss chạm gây 8. Cú Vồ gây 20 và xảy ra 3,5 giây một lần, xen kẽ với Vũng độc. Vũng đầu tiên luôn rơi đúng chỗ người chơi.
- **Đàn dơi** trừ đúng số con vào ngân sách "N con mỗi 0,6 giây".
- **Khoảng cách sinh quái:** 500–700 px nhưng luôn ở ngoài màn hình, kể cả khi màn hình rộng. Quái bị bỏ xa quá 1.400 px được đưa lại gần.
- **Từ 8:30 quái rút đi:** chúng chạy ra xa rồi biến mất và không cho kinh nghiệm. Trùm nhỏ nếu còn sống cũng rút.
- **Boss:** kinh nghiệm của boss cộng thẳng khi boss chết, và các viên ngọc còn trong bán kính 700 px được hút về. Lý do là màn kết thúc ngay lúc boss chết.
- **"Hòm thưởng không chết":** hiện khi hoàn thành 1-1 mà nhân vật chưa chết lần nào ở bản đồ này. Giai đoạn 0 chưa có đồ đạc, nên hòm chỉ là thông báo.
- **Hoàn tác** tính máu/mana tương đối với lúc mở bảng, để không thể cộng–hoàn tác Thể lực liên tục để hồi máu.
- Mở bảng khi chuyển sang tab khác, để game không chạy lúc người chơi không nhìn.
