# ARPG Survivor – Giai đoạn 1 (Lõi ARPG)

**20 màn chơi** (4 chương × 5 màn, mỗi màn 10 phút), **2 lớp nhân vật**: Pháp sư Nguyên tố (Lửa / Băng / Sét) và Chiến Binh cận chiến (Vũ Khí / Tiếng Thét / Huyết Chiến), mỗi lớp 3 nhánh × 6 kỹ năng. Có đồ đạc 4 bậc, kho đồ, làng, rương chung, lưu game, xuất/nhập mã nhân vật. Chạy trên trình duyệt, HTML5 Canvas + JavaScript thuần, không cần build, không có thư viện ngoài. Đồ hoạ vẽ bằng hình khối: nhân vật có thân, tay, đầu và chân chạy theo nhịp bước.

## Chạy game

Cần Node.js 18 trở lên (chỉ dùng làm máy chủ tĩnh):

```bash
npm start
```

Mở `http://localhost:8080/`. Thêm `?debug` (`http://localhost:8080/?debug`) để bật sẵn bảng debug.

Không mở thẳng `index.html` bằng `file://`, vì trình duyệt chặn đọc file JSON. Máy chủ tĩnh nào cũng dùng được, ví dụ `python3 -m http.server`.

## Chạy online (GitHub Pages)

Workflow `.github/workflows/pages.yml` tự chạy `tools/test.mjs` rồi đưa game lên GitHub Pages mỗi khi có code mới trên `main`. Lần đầu cần bật Pages: **Settings → Pages → Source: GitHub Actions**. Sau đó game chạy ở `https://<tên-tài-khoản>.github.io/<tên-repo>/`.

Có thể chạy tay ở thẻ **Actions → Deploy GitHub Pages → Run workflow**.

Repo riêng tư chỉ dùng được GitHub Pages khi tài khoản có gói trả phí. Nhân vật lưu theo từng trình duyệt và từng tên miền, nên muốn chuyển nhân vật từ `localhost` lên bản online thì dùng Xuất mã / Nhập mã.

## Điều khiển

| Phím | Tác dụng |
|---|---|
| WASD / phím mũi tên | Di chuyển. Kỹ năng tự kích hoạt |
| Tab, C hoặc nút **+** | Bảng nhân vật: thuộc tính + cây kỹ năng (thẻ Lửa / Băng / Sét). Game dừng hẳn khi bảng mở |
| I | Thẻ Đồ đạc (trang bị + kho đồ) |
| Shift + bấm "+" | Cộng 5 điểm thuộc tính một lần |
| Bấm đúp vào món đồ | Mặc / tháo; ở thẻ Rương thì chuyển giữa kho và rương |
| Esc | Đóng bảng |
| 1 / 2 / 3 / 4 | Cộng nhanh 1 điểm Sức mạnh / Nhanh nhẹn / Thể lực / Năng lượng (không mở bảng) |
| F2 hoặc \` | Ẩn/hiện bảng debug |
| Điện thoại | Cần ảo ở nửa trái màn hình, nút + ở bên phải |

## Cấu trúc

```
index.html, css/style.css
data/                 ← TOÀN BỘ số liệu, sửa không cần đụng code
  config.json         chỉ số nhân vật, thuộc tính, công thức, đóng băng, testMode, khoá lưu
  classes.json        2 lớp nhân vật: chỉ số khởi đầu, máu/mana/giáp riêng, các nhánh kỹ năng
  skills.json         6 nhánh × 6 kỹ năng (3 nhánh mỗi lớp), synergy, mốc mở (thật + thử nghiệm)
  monsters.json       quái thường, tinh anh, trùm nhỏ, boss; kháng Lửa/Băng/Sét/Độc của từng quái
  items.json          ô trang bị, bậc đồ, đồ gốc, dòng chỉ số, 10 món độc nhất, tỉ lệ rơi, giá bán, giá tẩy điểm
  maps/1-1.json       màn gốc: kích thước, vật cản, nhịp sinh quái, sự kiện theo thời gian
  maps/campaign.json  danh sách 20 màn, chương, độ khó tăng dần, vật cản ngẫu nhiên
src/core/             lõi, không dùng DOM (chạy được trong Node)
  game.js             một lượt chơi: sinh quái, AI, kỹ năng, sát thương, đóng băng, rơi đồ, boss
  progression.js      nhân vật: cấp, điểm, kỹ năng, chỉ số từ đồ, tẩy điểm, hoàn tác
  items.js            sinh đồ ngẫu nhiên, yêu cầu để mặc, kho đồ / trang bị / rương
  save.js             lưu trên trình duyệt, mã sao lưu (xuất/nhập)
  bot.js              bot di chuyển, tự cộng điểm theo nhánh, tự mặc đồ
src/ui/sprites.js     hình nhân vật có chân chạy (quái vẽ sẵn thành sprite 8 khung × 2 hướng × 4 màu)
src/ui/               vẽ canvas, HUD, bảng nhân vật/đồ đạc/rương, cần ảo, debug, ghi log
tools/
  serve.mjs           máy chủ tĩnh
  sim.mjs             mô phỏng nhiều lượt 10 phút bằng bot
  balance.mjs         so sánh DPS 3 nhánh ở cùng cấp, cùng số điểm
  test.mjs            kiểm tra công thức và hệ thống
```

Đặt `"testMode": false` trong `config.json` để dùng mốc mở kỹ năng thật (Lửa 1/1/6/12/18/24, Băng và Sét 1/6/12/12/18/24) thay cho mốc nén (Lửa 1/1/2/4/6/8, Băng và Sét 1/2/4/4/6/8).

## Chọn nhân vật và lớp Chiến Binh

Mở game sẽ vào **màn chọn nhân vật** trước, sau đó mới tới làng (chọn màn, cộng điểm, đồ đạc).

- **Màn chọn nhân vật:** danh sách nhân vật đã tạo (lớp, cấp, số màn đã qua, vàng), có nút Chơi và Xoá.
- **Tạo nhân vật mới:** chọn lớp và đặt tên.
- **Mỗi nhân vật lưu riêng** cấp, điểm, kỹ năng, đồ và tiến độ 20 màn. Rương chung dùng cho mọi nhân vật.
- Ở làng có nút **Đổi / tạo nhân vật** để quay lại màn này.
- Dữ liệu cũ (một nhân vật, trước khi có lớp) tự chuyển thành nhân vật Pháp sư.
- **Nhập mã** sẽ thêm nhân vật vào danh sách (trùng nhân vật thì ghi đè); đồ trong rương của mã được thêm vào ô trống của rương chung.

**Chiến Binh** đánh cận chiến, gây sát thương vật lý tăng theo Sức mạnh (+1% mỗi điểm, trong khi Năng lượng chỉ cho pháp sư +0,5%).

Chỉ số cấp 1 so với pháp sư:

| | Chiến Binh | Pháp sư |
|---|---|---|
| Máu | 163 | 87 |
| Giáp | 15 | 0 |
| Mana | 41 | 92 |
| Hồi mana | 10%/giây | 5%/giây |
| Máu mỗi điểm Thể lực | +4 | +3 |
| Tốc độ di chuyển | 165 | 160 |

| Nhánh | Kỹ năng |
|---|---|
| Vũ Khí | Chém Bổ (vòng cung trước mặt) · Lốc Xoáy (xoay liên tục) · Thông Thạo Vũ Khí · Nhảy Đập (nhảy vào cụm quái, bất tử khi nhảy) · Ném Rìu (xuyên 2 quái) · Cuồng Sát (giết quái tăng sát thương, tối đa 10 tầng) |
| Tiếng Thét | Gầm Chiến (đẩy lùi, làm quái sợ; tự dùng khi bị vây hoặc máu thấp) · Thét Xung Trận (tăng sát thương) · Da Thép (giáp, kháng) · Dậm Đất (gây choáng) · Động Đất (vùng sát thương liên tục) · Ý Chí Bất Khuất (hồi máu) |
| Huyết Chiến | Đâm Xuyên (đường thẳng xuyên quái) · Hút Máu · Chém Liên Hoàn (lướt chém nhiều quái) · Cuồng Huyết (tăng mạnh sát thương, mất nửa giáp) · Thông Thạo Huyết (chí mạng) · Huyết Bạo (quái chết có thể nổ) |

Đồ có thêm: Kiếm Ngắn, Rìu Chiến, Đại Kiếm (cần Sức mạnh); các dòng "+% sát thương vật lý" và "+cấp kỹ năng Vũ Khí / Tiếng Thét / Huyết Chiến"; thêm 2 món độc nhất cho Chiến Binh (tổng 12 món).

**So sánh sát thương** bằng `node tools/balance.mjs --arena close`, trong đó mọi lớp đứng cùng khoảng cách gần, cùng cấp, cùng số điểm. Số liệu là trung bình 3 nhánh của mỗi lớp:

| Cấp | Đám đông (CB / PS) | Đơn mục tiêu (CB / PS) | Hạ tinh anh 600 máu (CB / PS) |
|---|---|---|---|
| 4 | 211 / 239 (−12%) | 75 / 50 (+50%) | 20 / 27 giây |
| 10 | 438 / 378 (+16%) | 171 / 121 (+41%) | 5,8 / 7,7 giây |
| 14 | 423 / 432 (−2%) | 239 / 177 (+36%) | 4,3 / 5,2 giây |

## 20 màn chơi

Danh sách màn nằm trong `data/maps/campaign.json`. Mỗi màn = màn gốc `1-1.json` + thay đổi của chương (màu nền, kiểu vật cản) + thay đổi riêng của màn (nếu có).

- **Độ khó tăng 5% mỗi màn, cộng dồn:** máu và sát thương của mọi quái, kể cả trùm nhỏ và boss, nhân `1,05^(số thứ tự màn − 1)`. Màn 2 là ×1,05, màn 5 là ×1,22, màn 10 là ×1,55, màn 20 là ×2,53.
  - Đổi bước tăng ở `difficultyStep`.
  - Muốn một màn có độ khó riêng thì ghi `"difficulty"` vào màn đó.
- **Phần thưởng tăng theo:** kinh nghiệm của quái +5% mỗi màn (`rewardStep`), cấp đồ rơi +1 mỗi màn (`itemLevelPerMap`).
- **Mở khoá theo thứ tự:** hạ boss màn hiện tại thì mở màn sau.
  - Màn đã mở có thể chơi lại bất kỳ lúc nào.
  - Tiến độ lưu cùng nhân vật và đi kèm mã xuất/nhập.
- **Vật cản ngẫu nhiên mỗi lượt:** vị trí của bia mộ, cây và đầm lầy khác nhau mỗi lần vào màn, số lượng dao động ±30% (`randomObstacles`). Vùng xuất phát luôn trống.
- **4 chương có màu nền và tỉ lệ vật cản khác nhau:**
  - Chương 2 nhiều bia mộ.
  - Chương 3 nhiều cây.
  - Chương 4 nhiều đầm lầy.
- **Thêm hoặc sửa màn mà không cần code:** thêm một dòng vào mảng `maps`. Có thể ghi đè bất kỳ phần nào của màn gốc (`phases`, `events`, `obstacles`…), hoặc dùng `"template": "<tên file>"` để lấy một màn gốc khác trong `data/maps/`.

Mô phỏng một nhân vật chơi lần lượt cả 20 màn (thua thì chơi lại; cấp và đồ giữ nguyên giữa các lượt):

```bash
node tools/sim.mjs --campaign --build cold --items
```

| Bot | Kết quả |
|---|---|
| Có né đòn, cả 3 nhánh | Qua 20/20 màn ngay lần đầu, kết thúc ở cấp 38–39 |
| Không né đòn (Lửa) | Qua dễ tới hết chương 3; chương 4 bắt đầu khó (4-1 mất 14 lần thử, 4-3 mất 18 lần); sau 60 lượt vẫn chưa qua 4-4 |

## Hệ thống Giai đoạn 1

- **3 nhánh kỹ năng**, mỗi nhánh 6 kỹ năng, đúng bảng trong tài liệu. Vẫn tối đa 4 ô chủ động, lấy từ nhánh nào cũng được (build lai).
- **Đóng băng:** 3 đòn băng liên tiếp (cách nhau không quá 2 giây) đóng băng quái 1 giây; tinh anh và trùm nhỏ 0,5 giây; boss miễn nhiễm. Sau khi tan băng, quái được miễn đóng băng 1 giây.
- **Kháng nguyên tố của quái:** mỗi quái có kháng Lửa/Băng/Sét/Độc trong `monsters.json` (chương 1 đều bằng 0). Giới hạn từ −50% đến 75%.
- **Đồ đạc:** 4 bậc (Thường, Ma thuật 1–2 dòng, Hiếm 3–4 dòng, Độc nhất), 20 đồ gốc, 25 loại dòng chỉ số, 10 món độc nhất (6 chung/Lửa, 2 Băng, 2 Sét).
  - Có dòng +% sát thương băng/sét và +cấp kỹ năng Băng/Sét.
  - Đồ có yêu cầu cấp; một số đồ gốc cần thêm Sức mạnh.
  - Cấp của đồ rơi = cấp bản đồ + số phút đã chơi (+2 với tinh anh, +3 với trùm nhỏ, +5 với boss).
  - +cấp kỹ năng từ đồ chỉ cộng cho kỹ năng đã học. Synergy chỉ tính điểm cộng thật, giống Diablo 2.
- **Kho đồ 30 ô, 10 ô trang bị:** khi chọn một món sẽ thấy so sánh với món đang mặc (chỉ số tăng/giảm). Món không đủ yêu cầu hiện nền đỏ và không mặc được.
- **Làng:** bán đồ lấy vàng (có nút bán nhanh mọi món Thường), tẩy điểm (40 vàng × cấp), rương chung 50 ô.
- **Lưu game:** tự lưu trên trình duyệt khi đóng bảng, nhặt đồ, lên cấp, kết thúc lượt và trước khi đóng tab.
- **Xuất / nhập mã nhân vật:** mã dạng `ARPG1.<dữ liệu>.<mã kiểm tra>`, gồm nhân vật và rương chung. Mã bị sửa hoặc chép thiếu sẽ bị từ chối.

## Cân bằng 3 nhánh

```bash
node tools/balance.mjs --level 10
```

Công cụ đặt 3 nhân vật cùng cấp, cùng số điểm (thuộc tính chia giống nhau, mỗi nhánh học đủ kỹ năng của mình rồi dồn vào kỹ năng chính), không mặc đồ, đứng yên và bất tử. Có 3 bài đo, đều chỉ tính sát thương thực (không tính phần thừa khi quái đã hết máu):

1. **Đám đông:** luôn có 40 quái đứng yên.
2. **Đơn mục tiêu:** 1 boss.
3. **Tinh anh:** số giây để hạ 1 tinh anh Vỏ Đá 600 máu.

Kết quả hiện tại, tính chênh lệch so với trung bình 3 nhánh:

| Cấp | Đám đông | Đơn mục tiêu |
|---|---|---|
| 4 | ±10% | ±9% |
| 6 | ±10% | ±20% |
| 10 | ±15% | ±15% |
| 14 | ±20% | ±20% |

Mô phỏng cả lượt 10 phút có nhặt và tự mặc đồ (`--items`): Lửa, Băng, Sét và build lai Băng+Lửa đều hạ boss 3/3 lượt.

**Sét khắc chế tinh anh:**

- Mọi sát thương sét gây thêm **+60%** lên tinh anh và trùm nhỏ. Boss và quái thường không được cộng, nên các mức DPS ở trên giữ nguyên.
- Đồ có thêm dòng chỉ số "+% sát thương sét lên tinh anh" (10–20% từ cấp đồ 3, 21–35% từ cấp đồ 10) để cộng tiếp.
- Mức +60% đặt trong `config.json` (`eliteDmgBonus`).

Thời gian hạ một tinh anh Vỏ Đá 600 máu:

| Cấp | Lửa | Băng | Sét |
|---|---|---|---|
| 10 | 8,6 giây | 9,0 giây | 6,7 giây |
| 6 | 20 giây | 20 giây | 15 giây |

## Chế độ debug

Bảng debug có:

- Nhảy đến phút bất kỳ.
- +1 cấp, +5 điểm thuộc tính, +1 điểm kỹ năng, +500 vàng.
- Rơi 5 đồ, rơi 1 món độc nhất.
- Bất tử, hiện FPS/DPS, bật/tắt số sát thương, tăng tốc ×2/×4.
- Sinh 300 quái, giết hết quái.
- Bot tự chơi (chọn nhánh Lửa / Băng / Sét / lai).
- Bỏ lượt.

Lượt nào có dùng debug sẽ được đánh dấu `debugUsed: true` trong log.

## Ghi nhận buổi chơi thử

Mỗi lượt tự ghi vào `localStorage`:

- Kết quả, thời gian sống, cấp đầu/cuối, số quái đã giết, nguyên nhân chết.
- Điểm đã cộng vào đâu, số lần và tổng thời gian mở bảng, thời điểm lên cấp.
- Máu boss còn lại, sát thương nhận theo từng nguồn, số giây thiếu mana.
- Phần bổ sung ở Giai đoạn 1: đồ nhặt được, vàng, số lần đóng băng, sát thương gây ra theo nguyên tố, 4 ô kỹ năng lúc kết thúc.

**Xuất log (JSON)** tải toàn bộ log và góp ý về máy.

## Mô phỏng và kiểm tra

```bash
node tools/test.mjs
```

```bash
node tools/sim.mjs --runs 4 --build cold --items --verbose
```

Tuỳ chọn của `sim.mjs`:

- `--map 2-3`: chọn màn.
- `--campaign`: chơi lần lượt các màn.

- `--build fire|fire_ring|cold|lightning|hybrid|weapon|shout|blood` (3 kiểu sau là Chiến Binh)
- `--items`: bot nhặt và tự mặc đồ.
- `--persist`: giữ cấp giữa các lượt.
- `--no-dodge`: bot không né đạn, vũng độc hay cú vồ.
- `--god`, `--seed N`.

## Những chỗ tài liệu chưa nói rõ: lựa chọn đang dùng

Tất cả đều nằm trong JSON, đổi được ngay.

**Giai đoạn 1**

- **Khởi đầu:** nhân vật mới không có kỹ năng sẵn mà có 1 điểm kỹ năng để chọn kỹ năng cấp 1 của nhánh nào cũng được. Chưa học kỹ năng chủ động nào thì không vào được bản đồ.
- **Số liệu Băng/Sét** (sát thương, hồi chiêu, mana, bán kính) do mình đặt, rồi chỉnh bằng `balance.mjs` để 3 nhánh tốn khoảng 9–10 mana/giây khi dùng đủ 4 ô. Riêng các con số có trong tài liệu thì giữ nguyên: 40% / 2 giây, 140 px / 50% / 3 giây, 4 giây, 400 px, lan 4 quái +1 mỗi 5 cấp, 15% / 5%, 2,5 giây, +7% / +8%.
- **Synergy:** Tia Băng ← Cầu Băng Xoay; Vòng Sương Giá ← Bão Tuyết; Bão Tuyết ← Vòng Sương Giá + Cầu Băng Xoay; Cầu Băng Xoay ← Tia Băng; Tia Điện Tích ← Sét Lan; Tia Chớp ← Tia Điện Tích + Sét Lan; Sét Lan ← Tia Điện Tích + Tia Chớp; Bão Sấm ← Sét Lan.
- **Vỡ Vụn:** quái đang đóng băng nhận thêm 20% sát thương (+3% mỗi cấp). Quái chết khi đang đóng băng vỡ ra 6 mảnh băng, mỗi mảnh gây 10% máu tối đa của nó.
- **Trường Tĩnh Điện** không chí mạng, không tăng theo hệ số sát thương, nhưng vẫn bị kháng sét của quái giảm. Bán kính 180 px (+6 mỗi cấp).
- **Cầu Lửa** giữ đúng số trong tài liệu. Riêng vết cháy của Mưa Thiên Thạch (số do mình đặt) giảm từ 10 xuống 6 sát thương/giây (+2 mỗi cấp) để Lửa không vượt quá xa ở đơn mục tiêu.
- **Đồ:**
  - Tỉ lệ rơi đồ từ quái thường 0,4%, vàng 2%. Tinh anh rơi 1 món tối thiểu Ma thuật, trùm nhỏ 2 món, boss 3 món (món đầu tối thiểu Hiếm).
  - Một lượt 1-1 thường cho khoảng 10–20 món và 1.000 vàng.
  - Kho đầy thì đồ nằm lại trên đất.
  - Trong trận có thể vứt bỏ đồ; chỉ bán được ở làng.
- **Hoàn tác** chỉ áp dụng cho điểm thuộc tính/kỹ năng, không hoàn tác thay đồ.

**Từ Giai đoạn 0 (vẫn giữ)**

- **Vòng Than** chiếm 1 ô chủ động, tốn 0,5 mana mỗi lần đốt.
- **Hoả Ngục Bùng Nổ:** 10% ở cấp 1, +1% mỗi cấp sau, bán kính 90 px.
- **Tường Lửa** đặt cách người chơi 60–140 px, vuông góc với hướng tới cụm quái đông nhất.
- **Chí mạng** áp dụng cho mọi đòn của kỹ năng, trừ % máu (Trường Tĩnh Điện, Hoả Ngục, Vỡ Vụn).
- **Tinh anh Cường hoá Lửa** nổ sau 0,35 giây có vòng báo trước.
- **Đòn của quái:**
  - Kẻ ném xương chạm gây 2 sát thương, boss chạm gây 8.
  - Cú Vồ gây 20, xen kẽ với Vũng độc mỗi 3,5 giây.
- **Sinh quái:** đàn dơi trừ đúng số con vào ngân sách sinh quái. Quái sinh ra luôn ở ngoài màn hình, và quái bị bỏ xa quá 1.400 px được đưa lại gần.
- **Từ 8:30 quái rút đi** và không cho kinh nghiệm.
- **Boss:** kinh nghiệm của boss cộng thẳng khi boss chết, ngọc còn trong bán kính 700 px được hút về.
- **"Hòm thưởng không chết"** hiện khi hoàn thành 1-1 mà nhân vật chưa chết lần nào ở bản đồ này (chưa có phần thưởng đồ riêng).
- **Hoàn tác** tính máu/mana tương đối với lúc mở bảng.
- **Chuyển sang tab khác:** game tự mở bảng để dừng trận.
