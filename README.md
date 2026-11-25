# ARPG Survivor – Giai đoạn 1 (Lõi ARPG)

**20 màn chơi** (4 chương × 5 màn, mỗi màn 7 phút), **3 lớp nhân vật**: Pháp sư Nguyên tố (Lửa / Băng / Sét), Chiến Binh cận chiến (Vũ Khí / Tiếng Thét / Huyết Chiến) và Triệu hồi sư Hoang dã (Bầy Sói / Mãnh Thú / Bầy Chim & Côn Trùng), mỗi lớp 3 nhánh × 6 kỹ năng. Có đồ đạc 4 bậc, kho đồ, làng, rương chung, lưu game, xuất/nhập mã nhân vật. Chạy trên trình duyệt, HTML5 Canvas + JavaScript thuần, không cần build, không có thư viện ngoài. Đồ hoạ vẽ bằng hình khối: nhân vật có thân, tay, đầu và chân chạy theo nhịp bước.

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
  items.json          ô trang bị, bậc đồ, đồ gốc, dòng chỉ số, đồ độc nhất, đồ bộ, lỗ, giá lò chế, tỉ lệ rơi
  runes.json          10 loại rune: chỉ số khi ghép vào vũ khí / giáp, cấp rơi
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
  sim.mjs             mô phỏng nhiều lượt chơi bằng bot
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

## Chỉ số đồ theo cấp đồ, rune gộp chồng, khung nổi (bản 1.9)

**Chỉ số đồ tăng theo cấp đồ** (`items.json` → `ilvlScaling`):
- Chỉ số × (1 + hệ số × số cấp đồ vượt yêu cầu cấp gốc của món).

  | Loại đồ | Mỗi cấp vượt | Tối đa |
  |---|---|---|
  | Thường, Ma thuật, Hiếm | +0,5% | +50% |
  | Độc nhất, Đồ bộ | +1,65% | +165% |

  Ví dụ Vương Miện Tro Tàn (cần cấp 6, +20% lửa): rơi ở cấp đồ 46 → +66% → +33% lửa; cấp đồ 80 → +122% → +44% lửa.
- Không tăng: +cấp kỹ năng, giảm số đòn đóng băng, % hồi chiêu, % tốc chạy.
- Món được tăng sức mạnh thì **yêu cầu cấp = cấp đồ − 10** (nếu cao hơn yêu cầu gốc).
- Đồ ma thuật / hiếm: bậc chỉ số cao nhất đã mở có tỉ trọng 3, bậc kế 2, còn lại 1 (trước đây chia đều).
- Thưởng đồ bộ (đủ 2 / 3 món) nhân theo sức mạnh trung bình của các món trong bộ đang mặc.
- Lò chế (đổi dòng, nâng bậc) dùng cùng công thức. Đồ độc nhất / đồ bộ trong save cũ được tính lại theo cấp đồ đã lưu; đồ ma thuật / hiếm cũ giữ nguyên.
- Thẻ đồ ghi "cấp đồ 80 · sức mạnh +122%".

**Rune gộp chồng:**
- Rune cùng loại nằm chung một ô (số ×N ở góc), trong kho đồ, rương chung và túi tạm, không giới hạn số viên.
- Nhặt rune đã có ô thì gộp vào, không cần ô trống. Ghép vào đồ / ghép 3 → 1 trừ dần trong ô; rune mới gộp vào ô có sẵn.
- Ở làng: "Bán 1 viên" hoặc "Bán cả ô". Chuyển rương chuyển cả ô. Save cũ tự gộp các ô rune rời.

**Khung nổi và thẻ gọn:**
- Rê chuột vào đồ (kho, trang bị, rương) hiện khung nổi: tên, loại, cấp đồ, yêu cầu, chỉ số; so sánh với món đang mặc nằm ngay trên từng dòng (▲ / ▼), dòng "mất:" cho chỉ số món đang mặc có mà món này không có. Nhẫn so với chiếc kém hơn. Trên điện thoại: chạm để xem.
- Bấm chọn món: khung bên phải chỉ còn tên và các nút (Mặc, Bán, Khoá…), cùng bán nhanh / bộ lọc nhặt.
- Kỹ năng (khung chi tiết và khung nổi ở các ô kỹ năng đã gắn): một cột; dòng đổi khi lên cấp ghi "hiện tại → cấp sau", các dòng không đổi gộp một dòng; synergy và cộng thẳng rút gọn (rê vào để xem đầy đủ).
- Thuộc tính: một dòng ngắn, chỉ phần có ích cho lớp đang chơi; rê vào ⓘ để xem giải thích đầy đủ. Chỉ số chia 3 nhóm Tấn công / Phòng thủ / Tài nguyên; rê vào từng chỉ số để xem công thức.

## Bình máu / mana (bản 1.8)

- Mỗi bình máu hồi **20 máu**, mỗi bình mana hồi **20 mana**, giống nhau ở mọi cấp (trước đây hồi 30% máu / 40% mana tối đa).
- Tỉ lệ rơi giữ nguyên: 2% mỗi quái thường, tinh anh luôn rơi 1 bình máu.
- Số liệu: `config.json` → `drops.hpPotion.heal`, `drops.manaPotion.restore`.

## Làng gọn và màn chọn nhân vật (bản 1.8)

Chỉ đổi bố cục, mọi chức năng cũ giữ nguyên.

- **Mở game vào thẳng làng** của nhân vật chơi gần nhất. Chưa có nhân vật thì vào màn tạo nhân vật.
- **Màn chọn nhân vật**: một hàng thẻ (chân dung, tên, lớp, cấp, màn đang tới). Bấm thẻ là vào làng; xoá nhân vật nằm trong menu ⋯ của thẻ. Thẻ "+ Tạo mới" mở 3 thẻ lớp và ô tên có gợi ý sẵn theo lớp (Enter để tạo).
- **Làng một màn hình, không cuộn**:
  - Trên cùng: độ khó dạng nút gạt 3 nấc, nút **?** (cách chơi) và **⚙** (khác).
  - Cột trái: thẻ nhân vật (chân dung, cấp, kinh nghiệm, vàng, mảnh, thuộc tính) và 4 nút Nhân vật (số điểm chưa cộng) / Đồ đạc / Rương chung / Lò chế, nút ⇄ đổi nhân vật.
  - Giữa: thẻ 4 chương, 5 màn của chương đang xem nối thành đường đi (✓ đã qua, ● đang mở, 👑 màn cuối chương, 🔒 chưa mở), thông tin màn đang chọn (máu / sát thương quái, số lần qua, kỷ lục) và nút lớn **Vào màn** (phím Enter). Bấm đúp vào màn để vào ngay.
  - Menu ⚙ Khác: bán nhanh đồ thường, quản lý đồ, tẩy điểm, xuất / nhập mã, bảng kỷ lục, log chơi thử và góp ý.
- **Hộp thoại kết quả trận** hiện sau mỗi lượt: thời gian, cấp, số quái, rương thưởng, màn / độ khó mới mở, kỷ lục, túi tạm (giữ / bán). Nút **Chơi tiếp** (Enter) vào ngay màn kế, nút **Về làng** (Esc) đóng hộp thoại. Túi tạm còn đồ thì làng có nút "Túi tạm" để mở lại.
- Trên điện thoại: thẻ nhân vật thu gọn ở trên, 4 nút xếp một hàng, bản đồ và nút Vào màn ở dưới.

## Rương thưởng boss và quản lý đồ (bản 1.7)

**Rương thưởng khi hạ boss cuối màn:**
- Boss chết thì đồ rơi như cũ, cộng thêm một **rương thưởng** phát sáng. Màn chưa kết thúc ngay.
- Ngay khi boss chết: mọi quái còn lại biến mất, không sinh thêm quái, đồng hồ dừng (kỷ lục tính lúc hạ boss), người chơi bất tử.
- Chạm vào rương thì rương mở: phun phần thưởng ra, rồi **mọi đồ, vàng, ngọc trên đất tự bay vào người**. Hiện "Kết thúc màn sau 5 giây", hết giờ thì sang bảng kết quả.
- Không nhặt rương sau 30 giây thì rương tự mở. Bỏ lượt sau khi đã hạ boss vẫn tính thắng và nhận đủ đồ.
- Trong rương: chắc chắn 1 món hiếm trở lên, thêm 1 món ma thuật trở lên, 25% có thêm 1 món độc nhất hoặc đồ bộ, 30% có 1 rune, vàng ×5, 4–10 mảnh lò chế. Lần đầu qua màn (ở độ khó đó) được thêm 1 món hiếm. Cấp đồ +6. Số liệu: `items.json` → `drops.chest`.
- **Kho đầy**: đồ không vừa vào **túi tạm**. Ở làng có mục "Túi tạm" để Giữ (vào kho đồ, đầy thì vào rương chung) hoặc Bán từng món / tất cả. Túi tạm được lưu, không mất đồ.
- Bảng kết quả liệt kê đồ trong rương và số mảnh.

**Quản lý đồ (bảng Đồ đạc):**
1. **Mũi tên so sánh** trên ô đồ: ↑ tốt hơn đồ đang mặc, ↓ kém hơn, ✕ đồ của lớp khác hoặc chưa đủ yêu cầu (chấm điểm theo nhánh nhiều điểm nhất của nhân vật).
2. **Khoá đồ** 🔒: nút "Khoá" trong chi tiết món. Đồ khoá không bị bán / phân giải hàng loạt, không vứt được.
3. **Bán nhanh** (ở làng): Đồ thường, Đồ ma thuật, Kém hơn đồ đang mặc, Đồ của lớp khác. Hộp xác nhận liệt kê từng món và tổng vàng. Mặc định không đụng tới độc nhất, đồ bộ, rune, trừ khi tick "Tính cả độc nhất, đồ bộ, rune".
4. **Phân giải nhanh** ở Lò chế với cùng các bộ lọc (thêm "Đã đánh dấu rác"), ra mảnh.
5. **Ctrl + bấm** (Cmd trên Mac) vào một món: ở làng bán ngay; trong màn đánh dấu rác 🗑. Đồ đánh dấu rác **tự bán khi về làng**.
6. **Mua lại**: 10 món bán gần nhất, mua lại đúng giá đã bán.
7. **Bộ lọc nhặt đồ**: đồ thường Nhặt / Tự bán khi nhặt / Không nhặt; không nhặt đồ ma thuật dưới cấp đồ X. Vàng, rune và đồ hiếm trở lên luôn được nhặt. Đồ bị bỏ qua vẽ mờ trên đất.
8. **Kho đầy giữa màn**: tick "Kho đầy: tự bán món rác rẻ nhất" thì game bán món đồ thường / đánh dấu rác rẻ nhất (chưa khoá) để nhặt món mới.
9. **Sắp xếp** kho đồ: theo thứ tự ô trang bị, rồi độ hiếm (đồ bộ, độc nhất, hiếm, ma thuật, thường), rồi cấp đồ; rune ở cuối.

Bộ lọc, khoá, đánh dấu rác, danh sách mua lại và túi tạm đều được lưu và đi theo mã xuất nhân vật. Mã nguồn: `src/core/loot.js`.

## Triệu hồi sư Hoang dã (bản 1.7)

Lớp thứ ba: gọi bầy thú đánh thay mình. Chỉ số chính là **Năng lượng**.

- Khởi đầu: Sức mạnh 15, Nhanh nhẹn 20, Thể lực 20, Năng lượng 25. Máu và mana ở mức giữa Pháp sư và Chiến Binh.
- **Sức mạnh vật triệu hồi**: mỗi điểm Năng lượng cộng thêm cho thú +1 sát thương mỗi đòn (nhân `flatScale` của kỹ năng) và +1% máu. Thú dùng chỉ số "+% sát thương vật triệu hồi" (Năng lượng +0,5% mỗi điểm, đồ, bị động), không dùng %vật lý của Sức mạnh.
- **Quái nhắm mục tiêu gần nhất**: người chơi hoặc thú mặt đất, tuỳ cái nào gần hơn. Gấu **khiêu khích** quái trong 170 px. Boss và quái ném xương vẫn nhắm người chơi. Chim bay không bị quái đánh.
- Thú đi theo người chơi, tự chọn quái gần trong vùng 380 px quanh người chơi. Bị bỏ xa quá 600 px thì dịch chuyển về. Thú chết thì kỹ năng tự gọi lại khi hết hồi chiêu. Tổng tối đa 10 con (`config.json` → `summons`).
- Sát thương thú ngang các lớp khác (theo yêu cầu "giữ nguyên"), không giảm 10–15%.

| Nhánh | Kỹ năng (cấp mở) |
|---|---|
| Bầy Sói | Gọi Sói (1, thêm sói ở cấp kỹ năng 4/8/12, tối đa 4) · Tiếng Hú Bầy Đàn (6, thú đánh và chạy nhanh hơn) · Thông Thạo Thú (12, bị động: +sát thương, +máu thú) · Sói Đầu Đàn (12, cắn lan, sói thường +15%) · Cuồng Bạo Bầy Sói (18, cả bầy lao vào cụm quái) · Nanh Độc (24, bị động: độc cộng dồn 5 tầng) |
| Mãnh Thú | Gọi Gấu (1, khiêu khích, vả vùng; thêm 1 gấu ở cấp 10) · Vỏ Gai (6, bị động: phản sát thương) · Da Dày (12, bị động: máu, giáp, kháng của thú) · Đập Đất (12, gấu đập đất gây choáng) · Hồi Sinh Hoang Dã (18, hồi máu thú và bạn) · Thú Bất Tử (24, bị động: thú chết có tỉ lệ sống lại với 50% máu) |
| Bầy Chim & Côn Trùng | Đàn Quạ (1, 3 con, thêm ở cấp 5/10/15) · Bầy Ong (6, đám ong bay theo quái, sát thương theo giây) · Thông Thạo Hoang Dã (12, bị động: +sát thương thú bay, +chí mạng thú) · Đại Bàng (12, bổ nhào vào tinh anh / quái nhiều máu nhất) · Linh Hồn Thú (18, bị động: mỗi thú đang sống tăng hồi mana và +1% kháng) · Bão Lông Vũ (24, quét một vệt dài 520 px) |

Đồ mới: Trượng Thú, Cột Vật Tổ, Vật Tổ Nguyên Thuỷ (vũ khí, +% sát thương vật triệu hồi), Bùa Xương, Bùa Linh Hồn (tay phụ, +% máu vật triệu hồi); các dòng "+% sát thương / máu vật triệu hồi", "+cấp kỹ năng Bầy Sói / Mãnh Thú / Bầy Chim & Côn Trùng"; 2 món độc nhất (Nanh Sói Trưởng, Bùa Linh Thú) và 3 bộ đồ (Tiếng Gọi Bầy Đàn, Ý Chí Mãnh Thú, Đôi Cánh Hoang Dã).

Hình vẽ: Triệu hồi sư mặc áo choàng lông, mũ da sói có gạc hươu, cầm gậy vật tổ. Sói, sói đầu đàn (trắng, mắt đỏ), gấu có chân chạy; quạ và đại bàng vỗ cánh; ong là đám chấm vàng. Thú của mình có vòng xanh dưới chân và thanh máu nhỏ khi bị thương.

**Cân bằng** (`balance.mjs --arena close`, trung bình 3 nhánh mỗi lớp, sát thương mỗi giây):

| Cấp | Đám đông (PS / CB / TH) | Đơn mục tiêu (PS / CB / TH) | Hạ tinh anh 600 máu (PS / CB / TH) |
|---|---|---|---|
| 4 | 290 / 255 / 151 | 74 / 94 / 77 | 14 / 16 / 18 giây |
| 10 | 523 / 523 / 356 | 227 / 256 / 199 | 4,0 / 4,3 / 5,4 giây |
| 20 | 693 / 572 / 538 | 694 / 535 / 525 | 1,7 / 2,1 / 2,1 giây |

Đám đông của Triệu hồi sư thấp hơn ở cấp thấp vì thú phải chạy tới quái và bài đo dùng quái 36 máu (đòn lớn bị thừa sát thương). Bù lại thú đỡ đòn cho người chơi. Mô phỏng cả 60 màn có đồ (`sim.mjs --campaign --items`): Bầy Sói, Mãnh Thú, Bầy Chim đều qua hết Bình thường, Ác mộng, Địa ngục ngay lần đầu (cấp 85–86), giống Pháp sư Lửa (cấp 86). Chiến Binh Vũ Khí cần 71 lượt (cấp 94).

## Sát thương cộng thẳng từ Sức mạnh / Năng lượng và máu quái +10% mỗi màn (bản 1.5–1.6)

**Cộng thẳng mỗi đòn:**
- Mỗi điểm **Sức mạnh cộng thêm** cho +1 sát thương mỗi đòn của kỹ năng vật lý. Mỗi điểm **Năng lượng cộng thêm** cho +1 sát thương mỗi đòn của kỹ năng phép, hoặc của vật triệu hồi với Triệu hồi sư. (Bản 1.5–1.6 là +2; bản 1.7 giảm về +1 cho mọi lớp vì game quá dễ: mọi lối chơi qua hết 60 màn gần như ngay lần đầu.)
  - "Cộng thêm" là phần vượt mức khởi đầu của lớp, tính cả điểm tự cộng lẫn điểm từ đồ.
  - Phần cộng thẳng được cộng vào sát thương gốc trước khi nhân hệ số %.
- Số liệu: `config.json` → `attributes.str.physFlatPerPoint`, `attributes.ene.spellFlatPerPoint`.
- **Hệ số `flatScale` của từng kỹ năng** (`skills.json`): kỹ năng đánh nhanh hoặc nhiều đòn nhỏ chỉ nhận một phần, để phần cộng thẳng không lấn át sát thương gốc:

  | Kỹ năng | Hệ số |
  |---|---|
  | Đòn đơn, đòn chính (Cầu Lửa, Tia Băng, Tia Chớp, Sét Lan, Mưa Thiên Thạch, Vòng Sương Giá, Bão Sấm, Nhảy Đập, Ném Rìu, Dậm Đất, Đâm Xuyên…) | 100% |
  | Chém Bổ | 60% |
  | Tia Điện Tích | 35% |
  | Lốc Xoáy | 35% |
  | Vòng Than | 25% |
  | Mảnh Cầu Băng Xoay | 10% |

  Vùng gây sát thương theo giây (Bão Tuyết, Tường Lửa, Động Đất, vết cháy thiên thạch) nhận phần cộng thẳng tính theo giây. Mô tả kỹ năng trong bảng ghi rõ tỉ lệ nhận.
- Bảng nhân vật hiện dòng "Sát thương vật lý / phép mỗi đòn".
- So sánh hai lớp ở bản 1.6, khi còn +2 mỗi điểm (`balance.mjs --arena close`, trung bình 3 nhánh mỗi lớp, Chiến Binh / Pháp sư; số mới của bản 1.7 ở mục Triệu hồi sư):

  | Cấp | Một mục tiêu | Đám đông | Hạ tinh anh 600 máu |
  |---|---|---|---|
  | 4 | 110 / 92 | 256 / 311 | 18,1 / 11,1 giây |
  | 10 | 331 / 318 | 526 / 539 | 3,3 / 2,9 giây |
  | 14 | 480 / 502 | 524 / 597 | 2,3 / 1,9 giây |

  Hai lớp giờ gần ngang nhau. Chiến Binh không còn sát thương cao hơn rõ rệt như trước (trước khi có phần cộng thẳng, hơn khoảng 40%). Muốn Chiến Binh nhỉnh hơn thì giảm `spellFlatPerPoint` hoặc tăng `physFlatPerPoint`.

**Máu quái +10% mỗi màn** (`campaign.json`):
- `hpStep` = 0,10: máu quái ×1,1 mỗi màn, cộng dồn. Màn 10 ×2,36, màn 20 ×6,12.
- `dmgStep` = 0,05: sát thương quái giữ +5% mỗi màn, màn 20 ×2,53.
- Áp dụng cho mọi quái, kể cả trùm nhỏ và boss, và nhân chồng lên hệ số của độ khó (Ác mộng, Địa ngục).
- Ô chọn màn hiện riêng mức tăng máu và mức tăng sát thương.

## Thời lượng màn và kinh nghiệm (bản 1.4)

- **Mỗi màn 7 phút** (`config.json` → `run.duration`). Mọi mốc thời gian trong `maps/1-1.json` rút về khoảng 70%:
  - Tinh anh: 1:25, 2:25, 4:10, 4:55, 5:35.
  - Trùm nhỏ: 3:30.
  - Quái rút đi: 5:55.
  - Boss: 6:15.
  - Boss nổi điên: 7:00.
- **Kinh nghiệm ×2** cho mọi quái (`monsters.json`):

  | Quái | Kinh nghiệm |
  |---|---|
  | Xác sống | 4 |
  | Dơi | 2 |
  | Kẻ ném xương | 10 |
  | Tinh anh | 80 |
  | Trùm nhỏ | 400 |
  | Boss | 800 |

- **Cấp đồ rơi tăng 1,4 mỗi phút** (trước là 1) để đồ rơi cuối màn vẫn có cấp tương đương.
- **Kết quả mô phỏng:**
  - Một lượt màn 1-1 kết thúc khoảng 6:25 với cấp 12–13, so với cấp ~11 sau 10 phút trước đây.
  - Bot chơi hết 20 màn Bình thường đạt cấp 45 (trước khoảng 39–41).

## Rune, đồ bộ, lò chế

- **Lỗ:** đồ rơi ra có thể có 1–3 lỗ (vũ khí, áo: tối đa 3; mũ, tay phụ: tối đa 2). Đồ Thường hay có lỗ nhất (35%), Ma thuật 15%, Hiếm 10%. Đồ Độc nhất và đồ bộ không có lỗ.
- **10 loại rune** (`data/runes.json`), từ Rune Tro (bậc 1) đến Rune Vĩnh Hằng (bậc 10).
  - Rune ghép vào vũ khí cho một chỉ số; ghép vào mũ, áo hoặc tay phụ cho chỉ số khác. Ví dụ Rune Tro: vũ khí +10% sát thương lửa, giáp +12% kháng lửa.
  - Rune bậc cao chỉ rơi ở cấp đồ cao. Quái thường rơi rune 0,25%, tinh anh 12%, trùm nhỏ 50%, boss luôn rơi.
- **6 bộ đồ, mỗi bộ 3 món**, mỗi nhánh kỹ năng một bộ. Mặc đủ 2 món và đủ 3 món được thêm thưởng (ví dụ +1 cấp kỹ năng của nhánh). Thẻ đồ hiện các món đang mặc và các mức thưởng của bộ.
- **Lò chế** (thẻ trong bảng, chỉ có ở làng). Nguyên liệu là **mảnh**, có được khi phân giải đồ. Món càng hiếm, càng cao cấp thì ra càng nhiều mảnh.
  - Nâng bậc: Thường → Ma thuật (5 mảnh), Ma thuật → Hiếm (15 mảnh).
  - Đổi dòng chỉ số của đồ Ma thuật hoặc Hiếm: 6 mảnh + 15 vàng × cấp đồ.
  - Đục thêm 1 lỗ: 10 mảnh.
  - Gỡ hết rune: 60 vàng, rune bị mất.
  - Ghép 3 rune cùng loại thành 1 rune bậc cao hơn: 40 vàng × bậc.
- Giá và tỉ lệ nằm trong `items.json` (`crafting`, `socketChance`, `sets`).

## Độ khó Ác mộng / Địa ngục và bảng kỷ lục

- **3 mức độ khó**, mỗi mức có đủ 20 màn và tiến độ riêng. Qua hết 20 màn Bình thường thì mở Ác mộng; qua hết Ác mộng thì mở Địa ngục.

  | | Bình thường | Ác mộng | Địa ngục |
  |---|---|---|---|
  | Máu quái | ×1 | ×5 | ×14 |
  | Sát thương quái | ×1 | ×3 | ×6 |
  | Kháng nguyên tố của quái | 0 | +20% | +35% |
  | Kháng vật lý của quái | 0 | +10% | +17,5% |
  | Trừ kháng của người chơi | 0 | −25% | −50% |
  | Kinh nghiệm | ×1 | ×2 | ×3,5 |
  | Cấp đồ rơi | +0 | +18 | +32 |
  | Đồ Hiếm / Độc nhất | ×1 | ×1,5 | ×2 |

  Số liệu nằm trong `config.json` (`difficulties`).
- **Bậc chỉ số mới:** đồ cấp cao có thêm bậc chỉ số 4–5 (cần cấp 25 / 40), +3 cấp kỹ năng (cần cấp 30), và 10 đồ gốc cấp cao (cần cấp 22–35).
- **Bảng kỷ lục:** mỗi lần hạ boss sẽ ghi thời gian, và lưu thời gian nhanh nhất theo từng màn, từng độ khó. Thời gian kỷ lục hiện trên ô màn. Mục "Bảng kỷ lục" ở làng liệt kê thời gian nhanh nhất của mọi nhân vật trên trình duyệt này. Bảng xếp hạng chung với người chơi khác cần có server, chưa có.
- **Mô phỏng cả 3 độ khó** (bot có né đòn, tự mặc đồ, tự ghép rune):

  ```bash
  node tools/sim.mjs --campaign --build weapon --items
  ```

  | Nhánh | Kết quả |
  |---|---|
  | Lửa | Qua hết 60 màn sau 61 lượt, cấp 77 |
  | Chiến Binh (Vũ Khí) | Qua hết sau 112 lượt, chạm cấp 99; cuối Địa ngục rất khó (4-4: 20 lần thử, 4-5: 13 lần) |
  | Băng | Vấp ở Địa ngục 4-1 |

## 20 màn chơi

Danh sách màn nằm trong `data/maps/campaign.json`. Mỗi màn = màn gốc `1-1.json` + thay đổi của chương (màu nền, kiểu vật cản) + thay đổi riêng của màn (nếu có).

- **Độ khó tăng dần, cộng dồn:** máu quái +10% mỗi màn (`hpStep`), sát thương quái +5% mỗi màn (`dmgStep`). Muốn một màn có hệ số riêng thì ghi `"hpMult"` / `"dmgMult"` vào màn đó.
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
- `--campaign`: chơi lần lượt các màn qua cả 3 độ khó (`--until nightmare` để dừng sớm).
- `--difficulty nightmare`: chọn độ khó khi chạy một màn.

- `--build fire|fire_ring|cold|lightning|hybrid|weapon|shout|blood|pack|beast|swarm` (weapon/shout/blood là Chiến Binh, pack/beast/swarm là Triệu hồi sư)
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
- **Từ 5:55 quái rút đi** và không cho kinh nghiệm.
- **Boss:** kinh nghiệm của boss cộng thẳng khi boss chết, ngọc còn trong bán kính 700 px được hút về.
- **"Hòm thưởng không chết"** hiện khi hoàn thành 1-1 mà nhân vật chưa chết lần nào ở bản đồ này (chưa có phần thưởng đồ riêng).
- **Hoàn tác** tính máu/mana tương đối với lúc mở bảng.
- **Chuyển sang tab khác:** game tự mở bảng để dừng trận.
