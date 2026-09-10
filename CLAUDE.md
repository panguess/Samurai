# Samurai Project Context

## ⚠️ Repo นี้มี 2 แอปแยกกันโดยสิ้นเชิง — ห้ามข้ามแตะกันเว้นแต่ผู้ใช้สั่งชัดเจน

| | แอปเช็คสต๊อก | แอปสั่งของ (order web app) |
|---|---|---|
| ไฟล์หน้าเว็บ | `stock-check.html` | `index.html` |
| ไฟล์ backend | `Code.gs` | `order-app-Code.gs` (เก็บใน repo ตั้งแต่ 8 ก.ย. 69 — ดูคำเตือนเรื่อง sync ด้านล่าง) |
| ใช้โดย | ลูกจ้างเช็คสต๊อก + เจ้าของสั่งของกับซัพพลายเออร์ | ลูกค้าสั่งซื้อสินค้า + แอดมินจัดการออเดอร์/จัดส่ง/ชำระเงิน |
| Google Sheet | คนละไฟล์สเปรดชีตกับแอปสั่งของ | คนละไฟล์สเปรดชีตกับแอปเช็คสต๊อก |

**กติกา**: ทำงานกับแอปไหน ห้ามอ่าน/แก้/อ้างอิงไฟล์ของอีกแอปโดยไม่ถูกขอ แม้จะดู "เกี่ยวข้องกัน" ก็ตาม
(ทั้งสองแอปเคยถูกโยงกันผิดพลาดมาแล้ว — ผู้ใช้ต้องเตือนหลายรอบ) ถ้าไม่แน่ใจว่ากำลังคุยเรื่องแอปไหน ให้ถามก่อน
ไม่ต้องเดา

## แอปเช็คสต๊อก (stock-check.html + Code.gs) — บริบทที่ต้องรู้ก่อนแก้

### Deploy `Code.gs` ต้องแปะเองเสมอ
`git push` **ไม่มีทาง** deploy `Code.gs` ให้ — มันรันอยู่ใน Google Apps Script Editor คนละที่กับ repo
ทุกครั้งที่แก้ `Code.gs` ต้องส่งไฟล์เต็มให้ผู้ใช้ผ่าน SendUserFile เพื่อให้เขาก็อปไปแปะใน Apps Script Editor แล้วกด Save/Deploy เอง —
ห้ามบอกว่า "push แล้วเสร็จ" เฉยๆ ถ้าไฟล์ที่แก้คือ `Code.gs`

### กติกาการทำงานที่ผู้ใช้กำหนดไว้ (ยึดตลอด ไม่ใช่แค่ session เดียว)
1. แก้ `Code.gs` เมื่อไหร่ → ส่งไฟล์เต็มทาง SendUserFile ทุกครั้ง (ตามข้อบนสุด)
2. ห้าม push ขึ้น GitHub โดยไม่ถูกขอ ต้องรอให้ผู้ใช้พิมพ์บอกให้ push ก่อนเสมอ แม้จะเพิ่งแก้เสร็จก็ตาม
3. การเปลี่ยนแปลงที่กระทบ UI/หน้าตา หรือมีหลายตัวเลือกให้เลือก → ทำ demo เป็น Artifact ให้ดูก่อน แล้วค่อย implement ในโค้ดจริง (หรือรอผู้ใช้เลือกตัวเลือกก่อน)
4. ก่อนบอกว่า "เช็คแล้วไม่มีบั๊ก" ต้องตรวจสอบอย่างจริงจัง (syntax check, เทส E2E จริงด้วย Playwright ที่ mock API, ไล่ดู edge case) ไม่ใช่อ่านโค้ดผ่านๆ แล้วสรุปว่าโอเค

### Permission model: `PRIVILEGED_STAFF_NAME = 'Mile'`
ฟีเจอร์ฝั่งลูกจ้างบางอย่าง (แก้ชื่อหน่วยนับ, เพิ่มสินค้าใหม่) ถูกจำกัดให้ทำได้เฉพาะพนักงานที่ชื่อ "Mile" เท่านั้น —
ฝั่งลูกจ้างต้องส่ง `staffName` มาด้วยเสมอ และ backend เช็คว่าต้องตรงกับ `PRIVILEGED_STAFF_NAME` เป๊ะๆ

ฝั่งเจ้าของ (owner) ไม่มี concept "staffName" เลย — auth ของฝั่งเจ้าของคือ PIN screen (`renderOwnerPin`/`checkPin`) ที่กันแค่การเข้าหน้า SPA เท่านั้น
ฟังก์ชัน backend ที่เจ้าของเรียกได้ (เช่น `setSupplierCoverPhoto`, `createOrderBatch`, `setSupplierOrderConfirm`, `setProductSkipDate`, และตอนนี้รวม `setUnitLabel` เมื่อเรียกแบบไม่มี `staffName`) ไม่มีการเช็คสิทธิ์ฝั่ง server เพิ่มเติม — เป็น pattern เดิมของทั้งแอป ไม่ใช่ช่องโหว่ที่พึ่งเกิด
ดังนั้นถ้าจะเปิดฟีเจอร์ไหนให้เจ้าของใช้ได้ด้วย ให้ยึด pattern นี้: เช็คเฉพาะเมื่อมี `staffName` ส่งมา (`if (body.staffName && body.staffName !== PRIVILEGED_STAFF_NAME) throw ...`) อย่าบังคับให้ฝั่งเจ้าของต้องส่ง staffName ปลอมๆ

### Helper ป้องกันบั๊กที่ห้ามลบ/ห้าม bypass
`Code.gs` มี helper 3 ตัวที่แก้บั๊กจริงที่เคยเกิดจาก Google Sheets แปลงชนิดข้อมูลเองแบบเงียบๆ (auto-type เป็น Date/Number เวลาเจ้าของพิมพ์มือ) — ถ้าจะแก้โค้ดส่วนที่เกี่ยวข้อง ต้องใช้ helper เหล่านี้ต่อ ไม่ใช่เขียนโค้ดอ่านค่าตรงๆ แบบเดิม:
- `isActiveFlag(v)` — เช็คคอลัมน์ Active/boolean-like จาก Sheet อย่างถูกต้อง (กัน bug ที่ string `"FALSE"`/`"0"` เป็น truthy ใน JS)
- `normalizeSkipDatesCell(raw)` — แปลงค่าคอลัมน์ SkipDates ให้เป็น array ของ string `yyyy-MM-dd` เสมอ ไม่ว่า cell จะถูก Sheets แปลงเป็น native Date object หรือพิมพ์เป็น string ก็ตาม ใช้ทั้งตอนอ่าน (`bootstrap`) และตอนเขียน (`setProductSkipDate`) เพื่อให้ข้อมูลเก่าที่พังซ่อมตัวเองได้ทุกครั้งที่ถูกแตะ (self-healing) — ห้ามย้อนกลับไปใช้ `String(dateObj)` ตรงๆ เด็ดขาด เพราะจะได้ format แบบ `"Tue Sep 01 2026 07:00:00 GMT+0700 (เวลาอินโดจีน)"` ที่ผิด
- ใน `checkPin(pin)` — การ pad PIN ด้วย `.padStart(4, '0')` เมื่อ Sheet เก็บ PIN เป็น number (กัน PIN ที่ขึ้นต้นด้วย 0 หายไป)

### สถานะล่าสุด (อัปเดต 5 ก.ย. 69) — แยกป้ายหน่วย + performance ตอนโหลด/บันทึก

**แยกป้ายหน่วยเช็คสต๊อกออกจากป้ายหน่วยสั่งของเสร็จแล้ว** — ตอนนี้มี 2 ฝั่ง 3 จุด:
1. หน้าเช็คของฝั่งลูกจ้าง (หน่วยเล็ก+ใหญ่ ใช้ฟิลด์ `label` / คอลัมน์ `UnitLabel`) แก้ได้เฉพาะ Mile
2. หน้าสั่งของฝั่งเจ้าของ ฝั่งซ้าย "คงเหลือ" — **mirror จุดที่ 1 ตรงๆ** (อ่าน `u.label` เหมือนกัน) แก้จุด 1 กระทบจุดนี้ด้วยเสมอ ตั้งใจให้เป็นแบบนั้น ไม่ใช่บั๊ก
3. หน้าสั่งของฝั่งเจ้าของ ฝั่งขวา (หน่วยที่จะสั่ง supplier) — ใช้ฟิลด์แยก `orderLabel` / คอลัมน์ `OrderLabel` แก้ผ่าน action `setOrderUnitLabel` ไม่กระทบจุด 1/2 เลย

⚠️ **ถ้าสินค้าตัวไหนยังไม่เคยกดตั้งชื่อฝั่งสั่งของเองสักครั้ง `OrderLabel` จะว่าง แล้ว `bootstrap()` จะ fallback ไปยืม `UnitLabel` มาโชว์แทน** — เจอบั๊กจริงจากจุดนี้เมื่อ 4 ก.ย. 69 (แก้ป้ายฝั่งเช็คสต๊อกแล้วป้ายฝั่งสั่งของขยับตาม) แก้แล้วด้วย `backfillOrderLabels()` (ฟังก์ชัน one-off ใน `Code.gs`) ที่ต้องรันครั้งเดียวหลังอัปเดตโค้ดชุดนี้เพื่อ "ตรึง" ค่าเดิมลง `OrderLabel` ให้สินค้าเก่าทุกตัว — **ถ้าเจอ Code.gs เวอร์ชันเก่าที่ไม่มีฟังก์ชันนี้ หรือผู้ใช้บอกว่ายังไม่เคยรัน ให้เตือนก่อนแก้เรื่องหน่วยต่อ** สินค้าใหม่ที่สร้างผ่าน `addProductFromApp`/`submitNewProduct` ตั้ง `OrderLabel` ให้อัตโนมัติตั้งแต่สร้างแล้ว ไม่ต้องรอ backfill

**Retry-on-timeout** — `API_TIMEOUT_MS` เดิม 25 วิ พบว่า cold connection ครั้งแรกของ session (ไม่มี sessionStorage cache) มักหลุดเวลานี้บ่อย (DNS+TLS 2 โดเมนซ้อนกันเพราะ `script.google.com` redirect ไป `script.googleusercontent.com` + Apps Script อาจ cold start) ทั้งที่ backend ไม่มีปัญหาเลย (ยืนยันจาก Executions log สะอาดทุกครั้งที่ไล่บั๊กนี้) แก้โดย:
- `apiGet`/`apiPost` รับ parameter เพิ่ม (`timeoutMs` / `retryOnTimeout`) — `bootstrap()` เรียกรอบแรกด้วย timeout สั้น (10 วิ) ถ้าพังจะ retry เงียบๆ อีกรอบด้วย timeout เต็ม (25 วิ) ก่อนค่อยโชว์ error จริง
- `apiPost` เพิ่ม flag `retryOnTimeout` (ใส่ `true` เป็น argument ที่ 3) — **ใช้ได้เฉพาะ action ที่ "set" ค่าตรงๆ เรียกซ้ำแล้วผลเหมือนเดิม** (`setProductSkipDate`, `setUnitLabel`, `setOrderUnitLabel`, `setSupplierCoverPhoto`, `setSupplierOrderConfirm`) — **ห้ามใส่กับ action ที่สร้างแถวใหม่/อัปโหลดไฟล์ทุกครั้งที่เรียก** (`createOrderBatch`, `addProduct`, `saveStock`, `saveProductPhotos`, `saveStaffAvatar`) เพราะ retry ซ้ำจะสร้างข้อมูล/ไฟล์ซ้อนจริง (เทียบเคส `createOrderBatch` ไม่ idempotent ที่แอปสั่งของเคยเจอปัญหาเดียวกันมาแล้ว)
- เพิ่ม `<link rel="preconnect">` ให้ `script.google.com` และ `script.googleusercontent.com` ใน `<head>` ให้เริ่ม DNS/TLS ตั้งแต่หน้าเพิ่งโหลด ไม่ต้องรอ JS ท้าย body เรียก fetch ก่อน

⚠️ **เคย "แก้ไม่ครบ" มาก่อน 1 ครั้งในหัวข้อ OrderLabel** (fallback ทำให้ยังเชื่อมกันอยู่จนกว่าจะรัน backfill) ทำให้ผู้ใช้เสียเวลาไล่บั๊กเดิมซ้ำและหงุดหงิดมาก — ก่อนบอกว่าแก้เรื่องหน่วยเสร็จ ต้องเช็คให้แน่ใจว่าไม่มี fallback ที่ยังโยงสองฟิลด์เข้าด้วยกันเหลืออยู่

**เรื่อง "หมดเวลาเชื่อมต่อ" ที่ไล่กันมายาวมาก (4-5 ก.ย. 69) — สรุปแล้วไม่เกี่ยวกับโค้ด**: มีรอบหนึ่งที่ผู้ใช้เจอ error ซ้ำๆ แม้จะมี retry แล้ว ไล่จนพิสูจน์ได้ว่า**ไม่ใช่บั๊กแอป** เพราะยิง URL ตรงๆ ใน Safari (ไม่ผ่านแอปเลย) ก็ยังค้างเหมือนกัน ทั้งที่ Executions log โชว์ backend รับ request สำเร็จเร็วต่อเนื่องตลอดเวลานั้น — สรุปว่าเป็นปัญหาเน็ต/อุปกรณ์เฉพาะจุดที่เกิดขึ้นเป็นครั้งคราว (ท้ายที่สุดหายเองหลังรีสตาร์ทอุปกรณ์ ไม่ได้แก้ตั้งค่าอะไรเลย) **ถ้าเจอรายงาน "โหลด/บันทึกไม่สำเร็จ" อีก ให้ขอเช็ค Executions log ก่อนเป็นอันดับแรกเสมอ** (ถ้า backend ตอบเร็ว/สำเร็จตลอดช่วงเวลานั้น แปลว่าไม่ใช่โค้ดเราแน่ๆ ไม่ต้องรีบแก้โค้ดเพิ่ม) และลองให้ผู้ใช้เปิดลิงก์ `?action=bootstrap` ตรงๆ บนเครื่อง/เน็ตเดียวกับที่เจอปัญหาเทียบดูก่อนเสมอ

### สถานะล่าสุด (อัปเดต 6 ก.ย. 69) — เตรียมทดสอบอ่านบิลเก่าย้อนหลัง 101 ใบ + ไล่บั๊กความเสถียรของ analyzeBillPhoto

**บริบท**: ผู้ใช้มีรูปบิลเก่าสะสมอยู่ใน Google Drive 3 โฟลเดอร์ ("รูปบิลซามูไร 1/3, 2/3, 3/3" — id `19aAyJ_sGYq8hjp2irKjROL1il6sB2cue`, `1_jBi8QE9aphajIECq_mEq9hHjJipRU0a`, `12NIYMiA85R1vcoTBtxsjNjRHR0eH-hmL` รวม ~101 ใบ) ต้องการเอาเข้าฟีเจอร์ "รับของ — ถ่ายบิล" ทีละใบเพื่อให้ `ProductAlias` เรียนรู้การจับคู่สินค้าล่วงหน้า **ยังไม่ได้เริ่มไล่ backlog จริงจังเลยจนจบ session นี้** (ทั้ง session ใช้ไปกับการแก้บั๊ก/เช็คความเสถียรของฟีเจอร์นี้ก่อน) — session ถัดไปเริ่มไล่ backlog ได้เลย

⚠️ **ข้อควรจำสำคัญเรื่อง backlog นี้**:
- ต้องทำ**ทีละบิล/ทีละวันเท่านั้น** ห้ามใส่รูปบิลหลายวัน/หลายใบพร้อมกันในการอัปโหลดครั้งเดียว — `analyzeBillPhoto` ถูกออกแบบให้อ่าน "เอกสาร 1 ใบ" ต่อครั้ง (รูปหลายใบพร้อมกัน = หน้าเดียวกันของบิลใบเดียวกันเท่านั้น ไม่ใช่บิลคนละใบ) ใส่ปนกันจะทำให้ AI อ่านวันที่/ยอดรวม/รายการปนกันเละ
- เป้าหมายจริงคือให้ `ProductAlias` เรียนรู้ ไม่ได้ต้องการให้บิลเก่า 101 ใบเป็นประวัติซื้อจริงถาวรใน `PurchaseReceipts` — แผนคือ finalize ให้ครบทุกใบก่อน (เพื่อให้ ProductAlias เขียนจริง) แล้ว**ค่อยลบแถวที่มาจาก batch นี้ออกจาก PurchaseReceipts ทีหลัง** (ลบแค่ PurchaseReceipts ไม่กระทบ ProductAlias เพราะคนละชีต ไม่ผูกกัน) — ผู้ใช้ยังไม่ได้ขอให้เขียนฟังก์ชันลบเป็นชุดจริงๆ ถ้าถึงตอนนั้นให้เสนอ/เขียนให้ (ระบุ BatchID หรือช่วงวันที่)

**บั๊ก/การแก้ไขที่ทำไปจริงใน session นี้** (commit `ae604fb` → `3873db7`, push แล้วทุกอัน):
1. ปุ่ม "ถ่ายรูป"/"เลือกจากคลังภาพ" แยกกัน 2 ปุ่ม (เดิมเป็นปุ่มเดียว "ถ่ายรูป / เลือกไฟล์" ที่เปิดเมนูกลางของเบราว์เซอร์) + แก้บั๊ก `capture` attribute ให้ใช้ `setAttribute('capture','environment')` แทน property assignment (2 จุด: `renderBillCapture` และหน้าเช็คสต๊อกหลักที่ปิดใช้งานอยู่ตอนนี้ `CAMERA_PER_PRODUCT_ENABLED=false`) — ทดสอบผ่าน Playwright E2E จริงแล้ว
2. `ProductAlias`: เดิม `analyzeBillPhoto` อ่านทั้งชีตทุกครั้งที่มีคนถ่ายบิล + `upsertProductAlias` (เดิม) อ่านทั้งชีตซ้ำทุกรายการในบิล — เปลี่ยนเป็น `getProductAliasIndex(supplierId)` (cache ผ่าน `cacheGet/cacheSet` เดิมของไฟล์ 10 นาทีต่อซัพพลายเออร์) + `batchUpsertProductAlias()` อ่าน/เขียนครั้งเดียวต่อบิล invalidate cache ทันทีตอนเรียนรู้ alias ใหม่
3. `finalizePurchaseReceipt`: คอลัมน์ `Date` เดิม hardcode เป็นวันนี้เสมอ (ปัญหาตรงๆ กับ backlog บิลเก่า — จะทำให้ยอดซื้อ "วันนี้"/"เดือนนี้" พุ่งผิดปกติ) เปลี่ยนเป็น parse จาก `billHeader.billDate` จริง (`parseBillDateToSheetFormat()` รองรับปี พ.ศ./ค.ศ.) fallback เป็นวันนี้เฉพาะ parse ไม่ได้ (บิลเขียนมือไม่มี header)
4. `analyzeBillPhoto` timeout ฝั่งเว็บ: ไล่ขยับ 90 วิ → 150 วิ → **270 วิ (ปัจจุบัน)** ตามหลักฐานจริงใน Executions log (เจอ doPost ใช้เวลาถึง 88-113 วิ ทั้งที่ backend สำเร็จ แต่หน้าเว็บตัดก่อน)
5. `callGemini()`: เพิ่ม retry อัตโนมัติ 1 ครั้ง (รอ 3 วิ) เมื่อเจอ Gemini 503 "high demand" หรือตอบ 200 แต่ parse ไม่ได้ข้อความเลย (พบทั้งคู่จริงคืนนี้ น่าจะอาการเดียวกันจากโหลดสูงชั่วคราวฝั่ง Google) ทำฝั่ง backend ไม่ใช่ client auto-retry เพราะยังไม่เขียนอะไรลงชีตตอนนั้น ปลอดภัย

⚠️ **เหตุการณ์แปลกที่ยังไม่รู้สาเหตุแน่ชัด**: ระหว่างไล่บั๊กคืนนี้ ผู้ใช้เปิด Apps Script Editor แล้วพบว่า `Code.gs` **ว่างเปล่าไม่มีโค้ดเลย** ทั้งที่เพิ่งแปะไปไม่นาน (ทำให้ error ทุกครั้งเป็น "Load failed" เพราะไม่มี `doGet`/`doPost` ให้เรียก) แก้โดยส่งไฟล์ใหม่ให้แปะซ้ำ + ย้ำขั้นตอน Deploy ที่ถูกต้อง (**Manage deployments → แก้ deployment เดิม → New version** ไม่ใช่ "New deployment" ที่จะได้ URL ใหม่คนละอันไม่อัปเดต URL เดิม) หลังจากนั้นกลับมาใช้งานได้ปกติ — ไม่ทราบสาเหตุที่แท้จริงว่าไฟล์หายไปได้ยังไง ถ้าเจอซ้ำอีกให้สังเกตว่าเกิดจากอะไร

**ปัญหาที่เจอแล้วสรุปว่าไม่ใช่บั๊กโค้ด**: error "Load failed" อีกครั้งหนึ่งที่เจอทั้งที่ Executions log โชว์ backend สำเร็จเร็ว (27.82 วิ) — สงสัยว่าเกี่ยวกับ iOS Safari ตัด network ของแท็บที่ถูกส่งไปพื้นหลัง (ล็อกจอ/สลับแอประหว่างรอ AI อ่านบิลซึ่งกินเวลาเป็นนาที) ยังไม่ได้ยืนยันจากผู้ใช้ชัดเจนว่าใช่สาเหตุนี้จริงไหม — ถ้าเจอ "Load failed" อีกครั้งที่ backend สำเร็จเร็วใน log ให้ถามผู้ใช้ว่าล็อกจอ/สลับแอประหว่างรอไหมเป็นอันดับแรก

**ค้างไว้ยังไม่ตัดสินใจ**: เสนอเพิ่ม `LockService` กันข้อมูลชนกันตอนใช้แอปพร้อมกันหลายคน (`saveStock`/`batchUpsertProductAlias` ไม่มีการล็อกตอนนี้ ความเสี่ยงต่ำมากในการใช้งานจริงเพราะมักแตะคนละแถวคนละสินค้า) ผู้ใช้ยังไม่ตอบว่าจะทำหรือไม่ทำ — ถ้าคุยเรื่องนี้ต่อให้หยิบมาถามใหม่

### สถานะล่าสุด (อัปเดต 7 ก.ย. 69) — ฟีเจอร์ใหม่: แยกบิลอัตโนมัติเมื่อถ่ายหลายบิลพร้อมกัน

**บริบท**: ระหว่างเริ่มไล่ backlog 101 ใบ ผู้ใช้เจอ error `[analyzeBillPhoto] อ่านบิลไม่สำเร็จ` เพราะเผลอถ่ายบิลคนละใบ/คนละวันปนกันมาในการอัปโหลดครั้งเดียว (ตรงกับกติกาเดิมที่ห้ามไว้) แต่ผู้ใช้ชี้ว่านี่เป็น use case จริงที่เกิดซ้ำได้ ไม่ใช่แค่ backlog — ซัพพลายเออร์บางรายเอาบิลตกหล่นจากรอบก่อนมาพร้อมบิลวันนี้ พนักงานอยากสแกนพร้อมกันได้เลยไม่ต้องแยกทีละใบ

**ออกแบบ 3 ชั้นความเสี่ยง** (คุยผ่าน Artifact demo ก่อนได้ผู้ใช้เห็นชอบแล้วค่อย implement จริงตาม workflow เดิม):
1. **แยก action ใหม่ทั้งหมด** — `analyzeBillBatch` ใน `Code.gs` **ไม่แก้ `analyzeBillPhoto` เดิมแม้แต่บรรทัดเดียว** เส้นทางถ่ายบิลปกติทุกวันไม่ถูกกระทบเลย
2. **คนต้องตรวจ/ยืนยันก่อนเขียนจริงเสมอ** — `analyzeBillBatch` แค่เสนอการแบ่งกลุ่มรูป ไม่เขียนชีตเลย ฝั่งเว็บบังคับให้ตรวจทีละบิล (`renderBillBatchItemReview`) ก่อนกด "ส่งทั้งหมด" ซึ่งก็แค่เรียก `submitBillForReview` เดิมวนหลายรอบ (ไม่มี action ใหม่เขียน `PurchaseReceipts`/`PendingBillReceipts` ตรงๆ)
3. **backlog 101 ใบเป็นสนามทดสอบจริงก่อนเปิดใช้กว้าง** — ยังไม่ได้เริ่มใช้งานจริงกับ backlog เลย

**กลไกแก้ไขเมื่อ AI แบ่งกลุ่มผิด** (`renderBillBatchRegroup`): **ไม่พยายาม "หั่น" รายการที่ AI อ่านมาแล้วเอง** (ไม่รู้ว่าแต่ละรายการมาจากรูปไหนในกลุ่มที่ผสมกันไปแล้ว) — ให้คนเลือกรูปที่ควรเป็นบิลเดียวกันเอง แล้ว**เรียก `analyzeBillPhoto` ตัวเดิมที่ใช้งานจริงทุกวันซ้ำ** กับรูปที่เลือกเท่านั้น รับประกันผลลัพธ์ถูกต้องเสมอแทนที่จะเดา

**Deploy/push รอบแรก (เวอร์ชัน single-call) เจอบั๊กจริงตอนทดสอบ**: หลัง deploy+push แล้วผู้ใช้ทดสอบโหมดหลายบิลจริง เจอ "Load failed" ซ้ำๆ **ทุกรอบ** — ไล่ผ่าน Executions log เจอว่า backend สำเร็จจริง (ไม่มี error) แต่คำขอ `analyzeBillBatch` เดิม (ให้ Gemini ทั้งแยกกลุ่ม+อ่านรายการทุกบิลพร้อมกันในคำขอเดียว) กินเวลาถึง **103.8 วิ** เทียบกับ `analyzeBillPhoto` บิลเดี่ยวที่ 45-49 วิแล้วผ่านทุกครั้งในช่วงเวลาเดียวกัน — สรุปว่าการเชื่อมต่อ ทนคำขอที่ยาวขนาด 100+ วิไม่ไหว (ไม่ว่าจะเพราะเน็ตมือถือ/ไวไฟตอนนั้น หรือ backgrounding — ยังไม่ยืนยันสาเหตุแน่ชัด แต่ตัวเลขเวลาสัมพันธ์ตรงกับผลลัพธ์ชัดเจน)

**แก้แล้ว (7 ก.ย. 69 เวอร์ชัน 2)**: ตัดขอบเขตงานของ `analyzeBillBatch` ให้เหลือแค่ "แยกกลุ่มรูป" อย่างเดียว (สั่ง Gemini ห้ามอ่านรายการสินค้าเลย เร็วขึ้นมาก) แล้วให้ `renderBillBatchAnalyzing` ฝั่งเว็บวนเรียก `analyzeBillPhoto` ตัวเดิม (พิสูจน์แล้วว่านิ่ง ~45-49 วิ) **ทีละกลุ่มเป็นคำขอสั้นๆ หลายครั้งแทน** — ผลลัพธ์/หน้าจอเหมือนเดิมทุกอย่าง เปลี่ยนแค่จำนวน/ความยาวของคำขอเบื้องหลัง **ยังไม่ได้ทดสอบซ้ำกับของจริงหลัง fix รอบนี้**

**สิ่งที่ทำไปแล้วใน session นี้**:
- `Code.gs`: เพิ่ม `analyzeBillBatch(body)` (action ใหม่ใน `doPost`, แก้ 2 รอบตามที่เล่าด้านบน) — ไม่แตะ `analyzeBillPhoto` เลยตลอดทั้ง session กันรูปตกหล่น/รูปซ้ำข้ามกลุ่มจากการแบ่งของ Gemini ด้วย + เพิ่มความละเอียด timestamp ของ `submitBillForReview`'s BatchID เป็นระดับมิลลิวินาที (เดิมระดับวินาที เสี่ยงชนกันตอนโหมดใหม่เรียกซ้ำเร็วๆ ให้ซัพพลายเออร์เดียวกัน)
- `stock-check.html`: เพิ่ม toggle "โหมดหลายบิลรวมกัน" ใน `renderBillCapture` (ปิดโดย default) + หน้าจอใหม่ 5 หน้า: `renderBillBatchAnalyzing` (2 phase: แยกกลุ่มเร็วๆ แล้ววนอ่านรายการทีละบิล), `renderBillBatchReview` (การ์ดต่อบิล พร้อมปุ่ม "แก้กลุ่มรูป"/"ตรวจสอบรายการ"/"ส่งทั้งหมด"), `renderBillBatchItemReview` (โครงเดียวกับ `renderBillReview` เดิม คัดลอกมาแยกต่างหาก), `renderBillBatchRegroup`, `renderBillBatchSuccess`
- ทดสอบผ่าน Playwright E2E จริง 2 ไฟล์ (mock request ที่ `page.route()` เหมือนแพทเทิร์นเดิมของแอปสั่งของ, อัปเดตให้ตรงกับ contract ใหม่ของ `analyzeBillBatch` แล้ว): (1) flow เต็มของโหมด batch รวม regroup-correction + จำลอง `submitBillForReview` พังกลางทางแล้วกด "ส่งทั้งหมด" ซ้ำเพื่อลองบิลที่เหลือ (2) regression เช็คว่า flow บิลเดี่ยวเดิม (toggle ปิด) ยังทำงานถูกต้องเป๊ะเหมือนก่อนแก้ — **แต่ทั้งหมดนี้คือ mock ฝั่ง Playwright เท่านั้น ยังไม่ได้ทดสอบกับ Gemini จริง/เน็ตจริงหลัง fix เวอร์ชัน 2**

**ขั้นต่อไป**: ผู้ใช้ต้อง deploy `Code.gs` ใหม่ (แปะทับใน Apps Script Editor → New version) แล้วทดสอบโหมดหลายบิลอีกรอบ ถ้ายัง "Load failed" อยู่ ให้เช็ค Executions log ก่อนเป็นอันดับแรกเสมอตามธรรมเนียม (ครั้งนี้จะเห็นเป็น `doPost` หลายรายการสั้นๆ แทนที่จะเป็นรายการเดียวยาว — ถ้ายังหลุดแม้แต่คำขอสั้นๆ แปลว่าไม่ใช่เรื่องความยาวคำขอแล้ว ต้องหาสาเหตุใหม่)

### สถานะล่าสุด (อัปเดต 7 ก.ย. 69 — ต่อ) — deploy จริง + บั๊กที่เจอจากการใช้งานจริงครั้งแรก + บั๊กค้าง 1 ตัวที่สำคัญ

**บริบท**: ต่อจากหัวข้อด้านบน (โหมดแยกหลายบิล) — session นี้ผู้ใช้ deploy `Code.gs` เวอร์ชันที่มีโหมดแยกหลายบิลจริงแล้ว เริ่มทดสอบกับบิลจริงเป็นครั้งแรก เจอบั๊ก/ปัญหาจริงหลายจุดเรียงกัน แก้ไปแล้ว 5 อัน ยังค้างอยู่ 1 อันที่สำคัญ (ดูหัวข้อสุดท้าย)

**สิ่งที่แก้ไปแล้ว push แล้วทั้งหมด (commit `85f71f2` → `df03723`)**:

1. **แจ้งเตือนซัพพลายเออร์ไม่ตรง** — เพิ่มเข้า `analyzeBillPhoto` (จุดเดียวที่แตะฟังก์ชันนี้ตั้งใจ ตามคำขอผู้ใช้ตรงๆ) คืนค่า `supplierMismatchWarning` (string หรือ null) เทียบโลโก้/ชื่อบริษัทบนบิลกับซัพพลายเออร์ที่เลือกไว้ ฝั่งเว็บโชว์ banner สีแดงพร้อมปุ่ม "เลือกซัพพลายเออร์ใหม่" ทั้งในหน้ารีวิวปกติและโหมดหลายบิล
2. **รูปบิลฝั่งเจ้าของไม่ขึ้น (broken image)** — บั๊กเดิมที่ไม่เคยถูกเจอมาก่อน (ทางฝั่งพนักงานถ่ายบิลใหม่ใช้ base64 data URL ไม่เคยผ่านโค้ดจุดนี้) `saveBillPhotosOrganized` เดิม `return file.getUrl()` คืน URL หน้า viewer ของ Drive ที่ embed เป็น `<img>` ไม่ได้ — เปลี่ยนเป็น `https://drive.google.com/thumbnail?id=X&sz=w2000` + เพิ่ม `toEmbeddableDriveUrl()` normalizer ใน `getPendingBillReceipts()` ให้ซ่อม URL แบบเก่าที่เก็บไว้แล้วอัตโนมัติตอนอ่าน (self-healing แบบเดียวกับ `normalizeSkipDatesCell`)
3. **VAT-inclusive mismatch false positive** — บิลบางเจ้า (ยืนยันแล้วกับ PFP) พิมพ์ราคาต่อหน่วยรวม VAT ไว้แล้ว ทำให้ยอดรวมรายการที่คำนวณเองตรงกับ "ยอดหลังแวต" ไม่ใช่ "ยอดก่อนแวต" ที่ `updateBillHeaderMismatch()` เดิมเทียบอย่างเดียว เลยเตือนหลอกทุกครั้ง แก้โดยเทียบกับทั้ง `subtotal` และ `total` ตรงอันใดอันหนึ่งถือว่าไม่ผิด (ผู้ใช้ยืนยันให้ apply กับทุกบิลเพราะ logic เดียวกัน ไม่ใช่เฉพาะ PFP) แก้พร้อมกัน 2 จุด (`renderBillReview` + `renderBillBatchItemReview` มีฟังก์ชันนี้แยกกันคนละชุด)
4. **หน้า "บิลรอตรวจสอบ" ฝั่งเจ้าของไม่มี retry เลย** — ต่างจากทั้งแอปที่มี retry-on-timeout กันไว้แล้ว (ดู bootstrap) จุดนี้ `apiGet('pendingBills')` ยิงครั้งเดียวจบ พังแล้วไม่มีแม้แต่ปุ่ม "ลองใหม่" ต้องกดย้อนกลับแล้วเข้าใหม่เอง (เจอจริง 3 รอบติด ทั้งที่ Executions log ยืนยันว่า backend ตอบเร็ว <3 วิสำเร็จตลอด) แก้โดยใส่ retry แบบเดียวกับ `bootstrap()` (สั้นก่อน 10 วิ ไม่ทันค่อยลองเต็ม 25 วิ) + เพิ่มปุ่ม "ลองใหม่" ถ้ายังพังทั้งสองรอบ
5. **ซูมรูปบิลไม่ได้บนคอมพิวเตอร์** — มือถือบีบนิ้วซูมได้เองอยู่แล้ว (ความสามารถเบราว์เซอร์ ไม่เกี่ยวกับโค้ด เพราะ viewport meta ไม่ได้ปิด user-scalable) แต่คอมไม่มีนิ้วให้บีบ เพิ่มดับเบิลคลิก/สกอลล์เมาส์ซูมให้ พร้อมรวมโค้ด lightbox ที่ซ้ำกัน 2 จุด (หน้ารีวิวปกติ/โหมดหลายบิล) เป็นฟังก์ชันเดียว `openBillPhotoLightbox(urls)`

⚠️ **บั๊กค้างที่สำคัญที่สุด ยังไม่เจอสาเหตุ — ต้องแก้ก่อนไล่ backlog 101 ใบต่อ**: เจอ error `The string did not match the expected pattern.` (ไม่มี `[analyzeBillPhoto]` นำหน้า แปลว่าพังฝั่ง client ไม่ใช่ backend) ตอนอ่านบิลจริง (ทดสอบกับบิล TVI) **เกิดซ้ำ 3 ครั้งติดกัน ทั้งที่ Executions log ยืนยันว่า backend สำเร็จทุกครั้ง** (doPost 64.35s, 50.29s = เวลาปกติของการอ่านบิลสำเร็จ ไม่มี error เลย) แปลว่า**บิลถูกอ่านสำเร็จแล้วจริง แต่หน้าเว็บพังตอนเอาผลลัพธ์มาแสดง/ประมวลผล** — ไล่โค้ดหาสาเหตุตรงๆ แล้วยังไม่เจอจุดที่ชัดเจน (ไม่ใช่ querySelector ที่เห็นได้ชัด, ไม่ใช่ regex ที่หาเจอ) เพิ่ม stack trace โชว์ในหน้า error ชั่วคราวไว้แล้ว (`renderBillAnalyzing`'s catch + batch mode's `showError`) แต่**ยังไม่ได้รับ screenshot ของ stack trace จริงกลับมาดู** ข้อสังเกตสำคัญ: ข้อความ error นี้เคยเจอมาก่อนแล้วครั้งหนึ่งที่หน้า `bootstrap()` (ดูหัวข้อ 5 ก.ย. 69 ด้านบน — ตอนนั้นสรุปว่าเป็นปัญหา cold-connection timeout แล้วแก้ด้วย retry ไม่ได้ยืนยันสาเหตุ query selector จริงๆ) **ถ้าเจอ error นี้อีกครั้งพร้อม stack trace ให้ไล่ตามบรรทัดที่ระบุในนั้นตรงๆ ก่อนเดาอย่างอื่น** เป็นไปได้ว่าสาเหตุจริงอาจไม่ใช่โค้ดของแอปเลยก็ได้ (ดู pattern ปัญหาเน็ต/อุปกรณ์เฉพาะจุดที่เคยสรุปไว้ก่อนหน้านี้) แต่ยังฟันธงไม่ได้จนกว่าจะเห็น stack trace จริง

**เรื่องแคชที่พบเพิ่ม**: นอกจากไอคอนหน้าโฮมที่เคยรู้แล้วว่าแคชเหนียว **แท็บที่ปักหมุด (pinned tab) ก็แคชเหนียวแบบเดียวกัน** — ยืนยันแล้วจากผู้ใช้จริงว่าเปิดผ่านแท็บปักหมุดเจอโค้ดเก่าค้างอยู่ ทั้งที่ deploy ใหม่ถูกต้องแล้ว (เช็คโค้ดที่ deploy จริงบน Vercel ผ่าน `mcp__Vercel__web_fetch_vercel_url` ยืนยันว่าถูกต้อง) แก้โดยเปิดผ่าน URL ตรงๆ ในแท็บใหม่แทน — **ถ้าเจอรายงานว่า "แก้แล้วแต่ยังเหมือนเดิม" อีก ให้ถามก่อนเสมอว่าเปิดผ่านแท็บ/ไอคอนที่ปักหมุด/บันทึกไว้หรือเปล่า**

**สถานะ backlog 101 ใบ**: ยังไม่ได้เริ่มไล่จริงจังเลย ถูกบั๊ก "did not match expected pattern" ขวางอยู่ (ทดสอบอ่านบิลจริงกี่ครั้งก็ชนบั๊กนี้) — **session ถัดไปควรขอ screenshot ของ error พร้อม stack trace จากผู้ใช้เป็นอันดับแรกก่อนทำอย่างอื่น** ถ้าแก้ได้แล้วค่อยเริ่มไล่ backlog จริง

## Order Web App (`index.html`) — รายละเอียดเชิงลึก

**Production**: https://samurai-murex.vercel.app/ (frontend hosted บน Vercel, deploy จาก repo นี้) ต่อกับ
backend Google Apps Script — โค้ดเก็บไว้ใน repo นี้แล้วที่ `order-app-Code.gs` (ตั้งแต่ 8 ก.ย. 69 อย่าสับสนกับ
`Code.gs` ที่ root ซึ่งเป็นของแอปเช็คสต๊อกคนละแอป)

⚠️ **`order-app-Code.gs` ใน repo อาจไม่ตรงกับตัวจริงที่ deploy อยู่เสมอ** — `git push` **ไม่มีทาง** deploy ให้
(เหมือนกับ `Code.gs` ของแอปเช็คสต๊อกทุกประการ) ผู้ใช้ต้องแก้ผ่าน Apps Script Editor เองแล้วก็อปกลับมาเขียนทับไฟล์นี้ใน
repo (หรือขอให้ผมช่วยแก้แล้ว SendUserFile ให้เอาไปแปะ + อัปเดตไฟล์ใน repo ให้ตรงกันในคราวเดียว) — **ถ้าผู้ใช้บอกว่าแก้
backend เองนอกเซสชั่นแล้ว ห้ามเชื่อว่าไฟล์ใน repo ตรงกับของจริงโดยอัตโนมัติ ให้ถามหรือขอไฟล์ล่าสุดมาเทียบก่อนเสมอ**
ก่อนแก้ backend action ไหนต่อ ให้เปิด `order-app-Code.gs` ในนี้ดูก่อนเป็นจุดเริ่ม แต่ถ้าเนื้อหาดูไม่สอดคล้องกับที่ผู้ใช้
อธิบายพฤติกรรมจริง ให้สงสัยว่าไฟล์เก่ากว่าของจริง แล้วขอไฟล์ปัจจุบันมาเทียบ

### Routing (query params บน `index.html`)
- `?admin=true&key=shop123` → เปิดหน้าแอดมิน (ADMIN_KEY ฝังในโค้ดตรงๆ ที่ตัวแปร `ADMIN_KEY`)
- `?ref=<customer_id>` → เปิดหน้าสั่งของของลูกค้าคนนั้นโดยเฉพาะ (ลิงก์แต่ละคนอยู่ใน sheet "Link for Customers")
- ไม่มี param เลย → error screen

### Google Sheet data model (1 workbook หลายแท็บ — คนละไฟล์กับ Sheet ของแอปเช็คสต๊อก)
- `Customer`: `customer_id, name, product_group` — `product_group` คือกลุ่มราคา (A-Z)
- `Product`: `product_id, name, price, group, image_url` — สินค้าชื่อเดียวกันมีได้หลายแถว แถวละ 1 กลุ่มราคา
  (ระบบ per-customer-segment price list ผ่าน `group` — อย่าเข้าใจผิดว่าเป็นข้อมูลซ้ำ/ขยะ)
- `Order_<ปีพ.ศ.>` (ปีปัจจุบัน = `Order_2569`, sheet เก่าสุดที่ไม่มีปีต่อท้ายชื่อ `Order` ก็ยังใช้ fallback ได้):
  `order_id, customer_id, customer_name, items, total, note, status, timestamp, payment_status,
  delivery_status, packing_at, done_at, customer_group`
  - `status` และ `payment_status` **ไม่ได้ใช้งานจริงแล้ว** ค้างค่า `pending` ทุกแถวเสมอ (เพราะฟังก์ชันที่เคยอัปเดตค่าพวกนี้ถูกลบไปแล้ว — ดูหัวข้อ backend actions ด้านล่าง) — ตัวที่บอกสถานะจริงคือ `delivery_status` (`pending`/`packing`/`done`/`cancelled`)
- `BusinessNote`: `note_id, date, text` — โน้ตอิสระของแอดมิน ไม่ผูกกับเดือน
- `Link for Customers`: `customer_id, name, link` — ลิงก์สั่งของเฉพาะตัว (`?ref=...`) ของลูกค้าแต่ละคน

### Backend actions ปัจจุบัน (ยืนยันตรงกับ `order-app-Code.gs` ที่ผู้ใช้ส่งมา 8 ก.ย. 69)
- `doGet`: `getCustomer, getProducts, getOrders, getAdminOrders, getAdminOrdersFull, getBusinessNotes, getThaiHolidays`
  - `getAdminOrders` ตอนนี้กรองช่วงย้อนหลังแล้ว (ดูหัวข้อ `ADMIN_ORDERS_WINDOW_DAYS` ด้านล่าง) — `getAdminOrdersFull`
    คือตัวที่ไม่กรอง ใช้เฉพาะหน้า "ภาพรวม/แดชบอร์ด" (`renderAdminOverview`)
- `doPost`: `createOrder, updateOrder, updateDelivery, cancelOrder, addBusinessNote, deleteBusinessNote`
  - `updateDelivery` มี guard กันเรียกซ้ำอยู่แล้ว: ถ้า `delivery_status` ที่ส่งมาตรงกับค่าปัจจุบันในชีต จะ skip ทั้งหมด
    (ไม่เขียนซ้ำ ไม่ยิง Telegram ซ้ำ) — ดูหัวข้อ "บั๊กแจ้งเตือนซ้ำ" ด้านล่างเรื่องช่องโหว่ race condition ที่ guard นี้ยังกันไม่หมด
- **ลบไปแล้ว** เพราะไม่มี frontend เรียกใช้: `getOwnerOrders, updateStatus, updatePayment, uploadSlip, verifyPayment`
  (ตัวหลังสุดเคยเรียก Claude API ตรวจสลิปโอนเงิน มีค่าใช้จ่ายต่อครั้ง) พร้อม helper ที่กลายเป็นขยะไปด้วย
  (`checkNameMatch`, ตัวแปร `CLAUDE_API_KEY`) — **ถ้าเจอโค้ดพวกนี้ในไฟล์ `.gs` ที่ผู้ใช้อัปโหลดมาใหม่ แปลว่ายังไม่ได้อัปเดตเป็นเวอร์ชันล่าสุด ให้แจ้งผู้ใช้ก่อนแก้อย่างอื่นต่อ**

### Known quirks / เรื่องที่ควรรู้ก่อนแก้ index.html
- Sticky header (`.admin-sticky-wrap`) ทับด้านบนของหน้าแอดมินตลอดเวลา — ถ้าจะทำ scroll-to-element (เช่น การ์ดกดแล้วเลื่อนไป section อื่น) ต้องคำนวณเผื่อ offset ความสูงของมันเองด้วย (`el.offsetHeight`) ไม่งั้นหัวข้อ section ที่เลื่อนไปจะโดนบัง — ห้ามใช้ `scrollIntoView` เปล่าๆ
- `openOwnerDashboard()` เช็ค `window.innerWidth<768` เพื่อกันไม่ให้เปิดแดชบอร์ดบนจอเล็ก — เวลาทดสอบผ่าน artifact/หน้าต่างที่ถูก embed อาจโดน false positive เพราะเฟรมแคบกว่าหน้าจอจริงของผู้ใช้ (แม้เปิดจาก iPad)
- เขียน `<div style="...">` แบบ generate ด้วย string ต้องระวังไม่ใส่ attribute `style="..."` ซ้ำสองรอบในแท็กเดียวกัน (เช่น อันจากปุ่ม/helper ทับกับอันเดิมของการ์ด) — เบราว์เซอร์เก็บแค่ attribute แรกแล้วทิ้งอันหลัง ทำให้ style เงียบๆ หายไปทั้งดุ้นโดยไม่มี error ให้เห็น

### ข้อจำกัดของ sandbox นี้ (สำคัญมาก อ่านก่อนลงมือ)
- เชื่อมต่อโดเมน `google.com` ทั้งหมด (รวม `script.google.com`, `docs.google.com`) ไม่ได้เลย ถูก network policy บล็อกไว้แบบ organization-wide — **ห้ามเสียเวลาลอง curl/fetch ไปหา backend หรือ Google Sheet ตรงๆ** ให้ขอผู้ใช้ export ข้อมูลเป็นไฟล์ (.xlsx/.csv) หรืออัปโหลดไฟล์ `.gs` มาแทนเสมอ
- อยากทำเดโม่ UI ที่มี "ข้อมูลจริงหรือใกล้เคียงจริง" ให้ทำเป็น Claude Artifact ที่ override ฟังก์ชัน `safeFetchJSON`/`postAction` ของแอปตรงๆ ด้วยข้อมูลจำลอง (ประกาศ `function` ซ้ำหลัง script หลักเพื่อ overwrite) — **ห้าม patch `window.fetch`** เพราะ artifact sandbox บล็อกการเชื่อมต่อโดเมนนอกแบบเงียบๆ ไม่มี error ให้เห็น ทำให้ patch ไม่มีผลจริงและข้อมูลจะว่างเปล่าหมด (0 ทุกช่อง) โดยไม่รู้สาเหตุ

### Workflow ที่ผู้ใช้ย้ำไว้หลายรอบ
- **ห้าม commit/push เข้า `main` โดยไม่ถามก่อนเด็ดขาด** ต้องส่งเดโม่ให้ดูก่อนเสมอ — และเดโม่ที่ผู้ใช้ต้องการคือ
  **ลิงก์ที่กดแล้วเปิดเป็นหน้าเว็บใช้งานได้จริง (Claude Artifact)** ไม่ใช่แค่ screenshot ภาพนิ่ง รอ approve ชัดเจนเป็นคำพูดก่อนถึงจะ commit/push ได้ (แม้ stop hook จะเตือนให้ commit ก็ต้องรอ user ยืนยันก่อน ไม่ใช่ทำตาม hook ทันที)
- ก่อน merge ให้รัน code review เช็คความเรียบร้อยของ diff ก่อนเสมอ (ใช้ syntax check + ไล่ diff เทียบว่าไม่มีโค้ดเดโม่/mock หลุดเข้ามาปนในไฟล์จริง)

### สถานะล่าสุด (อัปเดต 4 ก.ย. 69) — สรุปงานประสิทธิภาพ + แจ้งเตือนของ Order Web App

**ช่องทางแจ้งเตือนออเดอร์ปัจจุบันคือ Telegram** (ไม่ใช่ LINE OA แล้ว) — ย้ายเพราะ LINE OA แผนฟรีมีโควต้าข้อความ/เดือน
หมดไวเกินไป (แจ้งเตือนได้แค่ 2-3 วันแรกของเดือน) `Code.gs` มีฟังก์ชัน `sendTelegramNotify(message)` เรียกใน 3 จุด:
`createOrder` (🛒 ออเดอร์ใหม่), `updateDelivery` เมื่อ status เป็น `done` (✅ จัดเสร็จแล้ว), `cancelOrder` (❌ ยกเลิกออเดอร์)
— **ไม่มี event แจ้งตอนเข้าสถานะ `packing`** ต้องตั้งค่า Script Property 2 ตัวก่อนใช้งานได้: `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID` (ไม่มี fallback ไป LINE แล้ว ถ้าเจอโค้ด `sendLineNotify`/`LINE_CHANNEL_ACCESS_TOKEN` ในไฟล์ `.gs`
ที่ผู้ใช้อัปโหลดมาใหม่ แปลว่าเป็นเวอร์ชันเก่าก่อนย้าย ให้แจ้งผู้ใช้ก่อนแก้อย่างอื่นต่อ)

✅ **เรื่อง Telegram ปิดถาวรแล้ว (อัปเดต 7 ก.ย. 69)** — ผู้ใช้ยืนยันว่าใช้งานได้ปกติ **ห้ามหยิบเรื่องนี้ขึ้นมาพูดอีกโดยไม่ถูกถาม**
(เคยมีช่วงสับสนว่า "ไม่ดัง" แต่ที่จริงหมายถึงฟีเจอร์เสียงในแอปเว็บที่ถูกลบไปแล้ว ไม่เกี่ยวกับ Telegram — ดูหัวข้อถัดไป)

**เสียงแจ้งเตือนในแอปเว็บ (`index.html`) ถูกลบทิ้งไปแล้วตามคำขอ** — เคยมีฟีเจอร์ `playNewOrderChime()`/`orderChimeCtx`
(สร้างเสียงด้วย Web Audio API ตอนหน้าแอดมิน auto-refresh เจอ order_id ใหม่) ถูก revert ออกทั้งหมด **อย่าเพิ่มกลับเข้าไป
โดยไม่ถูกขอใหม่**

**แก้ปัญหาออเดอร์ซ้ำ** (ลูกค้ากดสั่งแล้วเกิดออเดอร์ซ้ำ 2-3 อันราคา/รายการเดียวกัน) — สาเหตุคือ `postAction` มี
auto-retry ในตัว แต่ `createOrder` ที่ backend ไม่ idempotent (ยิงกี่ครั้งก็สร้างแถวใหม่เสมอ) ถ้า response หลุด/ช้าเกิน
timeout ทั้ง auto-retry และการกดซ้ำของลูกค้าจะสร้างออเดอร์ซ้ำได้ แก้ที่ `index.html`/`placeOrder()`:
1. เรียก `postAction(...,'placeOrder',15000,0)` ปิด auto-retry เฉพาะ `createOrder` (retries=0)
2. ก่อนแจ้ง fail จะเรียก `findRecentMatchingOrder(itemsText,total)` เช็คก่อนว่ามีออเดอร์ของลูกค้าคนนี้ที่รายการ+ยอดตรงกันเป๊ะ
   ภายใน 3 นาทีที่ผ่านมาหรือยัง (ไม่นับที่ถูกยกเลิก) ถ้าเจอ ถือว่าสำเร็จแล้ว ไม่ยิงซ้ำ
- Trade-off ที่ผู้ใช้ยอมรับแล้ว: ถ้าลูกค้าสั่งของเซตเดียวกัน ยอดเท่ากันเป๊ะ ภายใน 3 นาที จะถูกมองเป็นออเดอร์เดียวกัน
- ทดสอบผ่าน Playwright E2E จริง (mock request ที่ระดับ `page.route()` ไม่ใช่ mock ฟังก์ชัน) ครอบคลุม 6 เคส — ดูรูปแบบ
  การทดสอบนี้เป็นตัวอย่างอ้างอิงได้เวลาต้องเทส `placeOrder`/`postAction` อีก

**Performance fixes อื่นๆ ที่ทำไปแล้ว**:
- `index.html`: เพิ่ม `loading="lazy"` ในรูปสินค้าทุกจุด, auto-refresh หน้าแอดมิน 10s → 30s
- `Code.gs`: `findOrderLocation()` เรียง sheet ปีปัจจุบันไว้ค้นหาก่อนเสมอ (ใช้ `getOrderSheetByYear()`) ลด scan cost
  ที่โตขึ้นเรื่อยๆ ตามอายุร้าน — ใช้กับทุก action ที่แก้ไข order ที่มีอยู่ (`updateOrder`/`updateDelivery`/`cancelOrder`)

**Backlog ที่ยังไม่ทำ (ตั้งใจพักไว้)**: จำกัดช่วงข้อมูลย้อนหลังที่ `getAdminOrders()` ส่งกลับ (ตอนนี้ส่งออเดอร์ทั้งหมด
ทุกปีทุกครั้ง ไม่มี limit) — ตอนคุยกันข้อมูลมีแค่ ~3 เดือนยังไม่กระทบมาก แต่จะเป็นปัญหาความเร็วเพิ่มขึ้นเรื่อยๆ ตามอายุร้าน
ถ้าจะทำต้องคุยก่อนว่าฟีเจอร์ "ภาพรวม/กราฟยอดขาย" (`renderAdminOverview`) ต้องดูย้อนหลังกี่เดือน ไม่งั้นจะพังฟีเจอร์นั้น
**(อัปเดต 7 ก.ย. 69: ทำเสร็จแล้ว ดูหัวข้อด้านล่าง — backlog นี้ปิดแล้ว)**

### สถานะล่าสุด (อัปเดต 7 ก.ย. 69) — ตรวจสอบ performance/security ทั้งไฟล์ + แยก endpoint โหลดข้อมูลแอดมิน

**Telegram ปิดเคสแล้ว** (รายละเอียดอยู่ด้านบนแล้ว หัวข้อ "เรื่อง Telegram ปิดถาวรแล้ว")

**ตรวจโค้ดทั้ง `index.html` (3,008 บรรทัด) และ `Code.gs` จริงที่ผู้ใช้อัปโหลดมา** ตามคำขอ "เช็คว่ามีจุดไหนทำให้แอปเร็วขึ้นได้อีก มีบั๊กไหม มีจุดเสี่ยงตรงไหนอีก" สรุปที่ยืนยันแล้วว่าเป็นเรื่องจริง (ไม่ใช่แค่สงสัย):

⚠️ **[ยังไม่แก้] ช่องโหว่ความปลอดภัยสำคัญที่สุด**: `doGet`/`doPost` ใน `Code.gs` ไม่มีการเช็คสิทธิ์/key ใดๆ เลยแม้แต่จุดเดียว
(`ADMIN_KEY='shop123'` ใน `index.html` เป็นแค่ตัวกรอง UI ฝั่ง browser เท่านั้น ไม่เคยถูกส่งไปเช็คที่ backend) — ใครก็ตามที่รู้ URL
ของ `API` (เปิดเผยอยู่ใน `index.html` บน GitHub) ยิง `getAdminOrders`/`getAdminOrdersFull` ตรงๆ จะดึงชื่อ+ออเดอร์ลูกค้าทั้งร้าน
ออกมาได้หมด และยิง `updateOrder`/`updateDelivery`/`cancelOrder`/`addBusinessNote`/`deleteBusinessNote` แก้ไขข้อมูลได้อิสระ
โดยไม่ต้องผ่านหน้าเว็บเลย — pattern เดียวกับที่แอปเช็คสต๊อกเป็น แต่แอปนี้เก็บข้อมูลลูกค้าจริงจึงเสี่ยงกว่า

⚠️ **[ยังไม่แก้] Stored XSS ผ่านช่องโน้ต**: `note` (ลูกค้าพิมพ์ตอนสั่งของ) และ `text` (โน้ตแอดมิน) ถูกเขียนลง Sheet ตรงๆ
ไม่มีการ sanitize ทั้งฝั่ง frontend/backend แล้ว render ผ่าน `innerHTML` แบบไม่ escape ในหลายจุด (`buildHistoryCard`,
`buildPendingAdminCard`, `buildDoneAdminCard`, `renderOverviewNotePanel`) — รวมกับข้อบนที่ backend ไม่เช็คสิทธิ์เลย
ทำให้คนนอกยิง `createOrder`/`addBusinessNote` พร้อม payload สคริปต์ตรงๆ แล้วไปรันในเบราว์เซอร์แอดมินได้ทันที
ไม่ต้องผ่านฟอร์มสั่งของด้วยซ้ำ

⚠️ **[ยังไม่แก้] `total` ไม่ถูกคำนวณใหม่ที่ backend**: `createOrder`/`updateOrder` เชื่อค่า `data.total` จาก client 100%
ไม่มีการ recompute จากราคาสินค้าจริงใน Sheet เลย

⚠️ **[ยังไม่แก้] `parseItems` เปราะบาง**: เก็บรายการสินค้าเป็น string `"ชื่อ xจำนวน, ชื่อ xจำนวน"` แล้ว `split(', ')` กลับ
— ถ้าตั้งชื่อสินค้าที่มี comma อยู่ในชื่อ การ parse จะพังแบบเงียบๆ (ยอด/รายการผิดโดยไม่มี error ให้เห็น)

✅ **[ทำเสร็จแล้ว] แยก endpoint โหลดข้อมูลแอดมิน** (ปิด backlog เดิมจาก 4 ก.ย.) — ก่อนแก้ทำเดโม่เทียบ performance ด้วยข้อมูลจำลอง
เป็น Claude Artifact ให้ดูก่อน (ตามที่ผู้ใช้ขอ "ต้องแก้เรื่องมีผลต่อความหน่วงของแอปก่อน") ได้รับ approve แล้วค่อย implement จริง:
- `Code.gs`: เพิ่ม `filterAdminOrdersWindow()` + ค่าคงที่ `ADMIN_ORDERS_WINDOW_DAYS=60` — `getAdminOrders()` (เดิม) ตอนนี้ส่งแค่
  pending/packing (ทุกอายุ) + done/cancelled ย้อนหลัง 60 วัน ใช้กับแท็บหลัก (รอจัด/กำลังจัด/เสร็จวันนี้) และ auto-refresh ทุก 30 วิ
- `Code.gs`: เพิ่ม action ใหม่ `getAdminOrdersFull()` ส่งข้อมูลเต็มทุกปีแบบเดิม ใช้เฉพาะตอนแอดมินเปิดแท็บ "ภาพรวม"/แดชบอร์ดเท่านั้น
- `index.html`: เพิ่มตัวแปร `allAdminOrdersFull` + ฟังก์ชัน `fetchFullAdminOrders()` — `switchAdminTab('overview')` และ auto-refresh
  ตอนอยู่แท็บภาพรวม จะเรียก `getAdminOrdersFull` แยกต่างหาก ส่วนจุดที่ใช้ `allAdminOrders` (windowed) เดิมทั้งหมด
  (`renderAdminOrders`, การหา order ด้วย id ในแท็บหลัก) ไม่ต้องแก้เพราะข้อมูลที่ต้องใช้อยู่ในหน้าต่าง 60 วันอยู่แล้วเสมอ
  ส่วนที่ต้องดูย้อนหลังได้ไกลกว่านั้น (`getAvailableOverviewMonths`, `ov_doneOrdersInRange`, `renderAdminOverview`'s
  `activeOrders`, `db_doneOrders`) เปลี่ยนไปอ่านจาก `allAdminOrdersFull` แทน
- ทดสอบผ่าน Playwright E2E จริง (mock API ที่ `page.route()`) ยืนยันว่า: เปิดแอดมินครั้งแรกยิงแค่ `getAdminOrders` ไม่ยิง Full
  โดยไม่จำเป็น, เปิดแท็บภาพรวมยิง `getAdminOrdersFull` แค่ 1 ครั้งและเห็นออเดอร์เก่ากว่า 60 วันได้ถูกต้องเมื่อเลือกฟิลเตอร์ "ทั้งหมด",
  สลับกลับแท็บหลักใช้งานปกติไม่มี JS error
- Push แล้ว (commit `17e7ef1` บน `main`) และผู้ใช้ deploy `Code.gs` ใหม่ผ่าน Apps Script Editor (Manage deployments → New version) แล้ว

**Backlog ที่ยังไม่ทำ (เรียงตามความสำคัญ ตกลงกันไว้ว่าจะทำต่อ)**:
1. เพิ่ม key check ที่ backend สำหรับ action ฝั่งแอดมินทั้งหมด (`getAdminOrders`, `getAdminOrdersFull`, `updateOrder`,
   `updateDelivery`, `cancelOrder`, `addBusinessNote`, `deleteBusinessNote`) — เก็บ key ไว้ใน Script Properties เหมือน
   `TELEGRAM_BOT_TOKEN`, ฝั่ง action ของลูกค้า (`getCustomer`/`getProducts`/`getOrders` เฉพาะ id ตัวเอง/`createOrder`) ปล่อยผ่านได้ตามเดิม
2. Escape user input (`note`, business note `text`) ก่อน render ด้วย `innerHTML` ทุกจุดที่ระบุไว้ด้านบน
3. คำนวณ `total` ใหม่ที่ backend จากราคาสินค้าจริงใน Sheet แทนเชื่อค่าจาก client
4. กันชื่อสินค้ามี comma ปนใน `parseItems`/รูปแบบเก็บ `items`
ข้อ 1-2 ควรทำพร้อมกันก่อนเป็นอันดับแรก เพราะเป็นช่องโหว่จริงที่ยืนยันแล้วทั้งสองฝั่ง

### สถานะล่าสุด (อัปเดต 8 ก.ย. 69) — เก็บ backend เข้า repo + แก้บั๊กแจ้งเตือนซ้ำ

**`order-app-Code.gs` ถูกเก็บเข้า repo แล้ว** (ก่อนหน้านี้ไม่เคยอยู่ใน repo เลย ต้องขอผู้ใช้อัปโหลดทุกครั้ง) สแกนหา
secret/hardcoded key ก่อนแล้ว ไม่พบ (Telegram token/chat id ดึงผ่าน `PropertiesService` ทั้งคู่) —ดูคำเตือนเรื่อง sync
สองทางที่ย่อหน้า Production ด้านบน

✅ **บั๊กแจ้งเตือน Telegram ซ้ำตอน "จัดเสร็จ" — แก้ในโค้ดแล้ว ผู้ใช้ deploy แล้ว**: พบจากภาพแชท (ออเดอร์เดียวกัน แจ้ง
"จัดเสร็จแล้ว" 2 ครั้งเวลาเดียวกัน) ต้นตอคือ `updateDelivery` มี guard กันเรียกซ้ำอยู่แล้ว (skip ถ้า `delivery_status`
ที่ส่งมาตรงกับค่าปัจจุบันในชีต) แต่ guard เช็คก่อนเขียนเท่านั้น ไม่ได้ล็อกอะไรเลย (ไฟล์ไม่เคยมี `LockService`) — ถ้า 2
request มาถึงพร้อมกัน (เช่น `postAction` auto-retry ยิงซ้ำตอน execution แรกยังเขียนไม่เสร็จ หรือแตะปุ่มรัว) ทั้งคู่อ่าน
`currentStatus` เดิมพร้อมกันได้ก่อนฝ่ายใดเขียนทัน → ผ่าน guard ได้ทั้งคู่ → เขียน `done` ซ้ำ + ยิง Telegram ซ้ำ
**แก้แล้ว**: ห่อทั้งฟังก์ชัน `updateDelivery` ด้วย `LockService.getScriptLock()` (`lock.waitLock(10000)` ก่อนเริ่ม,
`lock.releaseLock()` ใน `finally`) ทำให้ทุกคำขอ `updateDelivery` ประมวลผลทีละคำขอเท่านั้น ปิด race นี้ที่ต้นตอ — syntax
check ผ่านแล้ว (`node --check`), ส่งไฟล์เต็มให้ผู้ใช้แปะ Apps Script Editor แล้ว และผู้ใช้ยืนยันว่า deploy แล้ว
⚠️ หมายเหตุ: fix นี้ยังไม่ได้ทำกับ `cancelOrder` (มี pattern คล้ายกันแต่ยังไม่มีรายงานบั๊กจริงที่จุดนั้น — ตั้งใจพักไว้
ตามที่ผู้ใช้ขอให้ไล่แก้ทีละเรื่อง)

✅ **[ทำเสร็จแล้ว] ข้อ 1+2 ของ backlog — auth check ฝั่งแอดมิน + escape note กัน stored XSS (8 ก.ย. 69)**:

**ออกแบบ** (คุยผ่าน `AskUserQuestion` ก่อน implement เพราะพบว่า backlog เดิมสโคปผิด — `updateOrder`/`cancelOrder`
ไม่ใช่ action ฝั่งแอดมินล้วนอย่างที่บันทึกไว้ แต่ถูกเรียกจากฝั่งลูกค้าด้วย เช่น หน้า track order ของลูกค้ามีปุ่ม
"แก้ไข"/"ยกเลิก" ออเดอร์ตัวเอง — ถ้าบังคับ `ADMIN_KEY` ตรงๆ ตาม list เดิมจะพังฟีเจอร์ลูกค้า และเจอเพิ่มว่าเดิมทั้งคู่
ไม่เช็ค ownership เลยด้วยซ้ำ ไม่ใช่แค่ไม่มี key):
- **Action แอดมินล้วน** (`getAdminOrders`, `getAdminOrdersFull`, `updateDelivery`, `addBusinessNote`,
  `deleteBusinessNote`) — ต้องมี `ADMIN_KEY` ที่ถูกต้องเท่านั้น เก็บ key ไว้ใน Script Properties (ฟังก์ชันใหม่
  `isValidAdminKey(key)` อ่านจาก `PropertiesService`) ไม่ hardcode ในไฟล์
- **`updateOrder`/`cancelOrder`** (ใช้ร่วมกันทั้งแอดมินและลูกค้า) — ยอมผ่านถ้ามี `ADMIN_KEY` ถูกต้อง **หรือ**
  `customer_id` ที่ส่งมาตรงกับเจ้าของออเดอร์จริงในชีต (เทียบจาก `findOrderLocation` ที่อ่านมาแล้ว) — ปิดทั้ง 2 ช่องโหว่
  พร้อมกัน (ไม่มี key เลย + ไม่เช็ค ownership เลย)

**Backend (`order-app-Code.gs`)**: เพิ่ม `isValidAdminKey(key)`, `doGet` ส่ง `e.parameter.key` ให้
`getAdminOrders`/`getAdminOrdersFull`, ทั้ง 7 ฟังก์ชันข้างต้นเช็คสิทธิ์ก่อนทำงานจริงทุกตัว

**Frontend (`index.html`)**:
- `postAction()` แนบ `key:ADMIN_KEY` อัตโนมัติให้ทุกคำขอที่ยิงตอน `isAdmin===true` (ครอบคลุม `updateDelivery`,
  `addBusinessNote`, `deleteBusinessNote`, และ `updateOrder` ที่แอดมินเรียก — ไม่ต้องแก้ทีละจุดเรียก)
- 4 จุดเรียก GET (`getAdminOrders`×3, `getAdminOrdersFull`×1) เติม `&key=${ADMIN_KEY}` ในสตริง URL ตรงๆ
- 2 จุดเรียกฝั่งลูกค้า (`saveEdit`→`updateOrder`, `cancelOrder()`) เพิ่ม `customer_id:customer.customer_id`
- เพิ่ม `escapeHtml()` helper แล้ว escape ทุกจุดที่ render `note`/business-note `text` ผ่าน `innerHTML` — **จริงๆ มี
  5 จุด ไม่ใช่ 4 จุดตามที่ backlog เดิมระบุ** (`buildHistoryCard`, `buildPendingAdminCard` ที่ backlog เดิมไม่ได้แยก
  จากจุดเรียกใน `renderAdminOrders` ที่ใช้กับแท็บ packing ให้ถูก, `buildDoneAdminCard`, `renderOverviewNotePanel`,
  และจุดที่ backlog เดิมไม่เคยพูดถึงเลยคือ textarea `editNote` ใน `renderEditModal` ที่ pre-fill note เดิมของลูกค้า
  ตอนเปิดหน้าแก้ไข) — **เจอจุดที่ 5 (`buildPendingAdminCard`) จากการรัน Playwright test จริงเท่านั้น** ตอนแรกไล่ด้วยตาเปล่า
  แล้วคิดว่าครบ 4 จุดตาม backlog แต่เทสจริงจับได้ว่า XSS payload ยังทำงานได้จากแท็บ "รอจัด" (default tab ของแอดมิน)

**ทดสอบแล้ว**:
- `node --check` ผ่านทั้ง 2 ไฟล์
- ทดสอบ logic `isValidAdminKey`/authorization ของ `updateOrder`/`cancelOrder` แยกใน Node (mock `PropertiesService`)
  ครบ 10 เคส ผ่านหมด
- Playwright E2E จริง (mock `page.route()`): ยืนยันว่า GET แอดมินแนบ `key=` ใน URL, POST แอดมินแนบ `key` ใน body,
  POST ลูกค้าแนบ `customer_id` ไม่มี `key`, และ XSS payload (`<img onerror>`) ไม่ทำงานในการ์ดแอดมิน render เป็น
  escaped text แทน — **เจอบั๊กจริงระหว่างเทส (จุดที่ 5 ด้านบน) แก้แล้วรันซ้ำผ่านหมด**

**พักไว้ไม่ทำ (ผู้ใช้ตัดสินใจแล้ว 8 ก.ย. 69)**: backlog ข้อ 4 (กัน comma ใน `parseItems`) — ผู้ใช้บอกว่าไม่สำคัญ
ไม่ต้องหยิบขึ้นมาเสนออีกโดยไม่ถูกถาม

✅ **[ทำเสร็จแล้ว] ข้อ 3 — คำนวณ `total` ใหม่ที่ backend (8 ก.ย. 69)**: เดิม `createOrder`/`updateOrder` เชื่อค่า
`data.total` จาก client 100% (คำนวณจาก `items.reduce` ฝั่ง browser แล้วส่งมาตรงๆ) ใครก็เปิด DevTools/ยิง API ตรงๆ
แก้ยอดก่อนส่งได้ — เพิ่ม `computeOrderTotal(itemsText, customerGroup)` คำนวณจากราคาสินค้าจริงใน Sheet "Product"

⚠️ **สำคัญที่พบระหว่างคุย**: ระบบราคาผูกกับ `customer_group` (per-customer-segment price list — สินค้าชื่อเดียวกันมี
หลายแถวคนละราคาต่อกลุ่ม) ถ้าคำนวณ total ใหม่แต่ยังเชื่อ `customer_group` ที่ client ส่งมา ช่องโหว่จะไม่ปิดจริง (แค่
เปลี่ยนจาก "โกหกยอดรวม" เป็น "โกหกกลุ่มราคา" แทน) แก้โดย:
- `createOrder`: เพิ่ม `findCustomerRow(id)` ดึง `product_group` จริงจาก Sheet "Customer" ตรงๆ ไม่เชื่อ
  `data.customer_group` เลย (fallback ไปใช้ `data.customer_group` เฉพาะกรณี `customer_id` หาไม่เจอในชีต)
- `updateOrder`: ใช้ `customer_group` ที่บันทึกไว้แล้วในแถวออเดอร์นั้น (ยืนยันความถูกต้องไปแล้วตอน `createOrder`)
  ไม่รับค่าจาก `data` เลย
- `computeOrderTotal` group-aware ตาม pattern เดียวกับ `getOrderProdMap()`/`getOrderProdFullMap()` ฝั่ง
  `index.html` เป๊ะ (filter ตาม group ก่อน, fallback ไปสินค้าทั้งหมดถ้า group นั้นไม่มีสินค้าเลย)

**ทดสอบแล้ว**: `node --check` ผ่าน, unit test แยกใน Node ครอบคลุมกรณี group-aware pricing ตรงๆ (สินค้าชื่อเดียวกัน
คนละราคาคนละกลุ่ม ต้องไม่ leak ราคากลุ่มอื่น), fallback เมื่อ group ไม่มีสินค้า, และสินค้าที่หาชื่อไม่เจอ (ราคา 0 ไม่ throw)
— ผ่านหมดทุกเคส **ไม่ได้แก้ frontend เลยรอบนี้** (`index.html` ยังส่ง `total`/`customer_group` แบบเดิม แค่ backend
เพิกเฉยแล้วคำนวณเองแทน) — จุดนี้ไม่กระทบ UX ปกติเลย

⚠️ **Trade-off ที่ยังไม่ได้แก้ (ความเสี่ยงต่ำ ไม่ได้ทำอะไรเพิ่ม)**: `findRecentMatchingOrder()` ฝั่ง `index.html`
(กันออเดอร์ซ้ำตอน retry) เทียบ `total` ที่ client คำนวณเองกับ `o.total` ที่ตอนนี้เป็นค่าที่ backend คำนวณใหม่แล้ว —
ปกติสองค่านี้ตรงกันเสมอเพราะข้อมูลราคามาจากแหล่งเดียวกัน มีโอกาสไม่ตรงกันเฉพาะกรณีที่ราคาสินค้าถูกแก้ในชีตระหว่าง
ที่ลูกค้ากำลังสั่งของพอดี (หน้าต่างเวลาแคบมาก) ถ้าเกิดขึ้นจริง dedup check จะไม่เจอออเดอร์เดิม ทำให้เกิดออเดอร์ซ้ำได้ตอน
retry — ยังไม่ได้แก้เพราะเป็น edge case ที่โอกาสเกิดต่ำมาก ถ้าเจอปัญหาออเดอร์ซ้ำอีกให้กลับมาดูจุดนี้ก่อน

✅ **Script Property `ADMIN_KEY` ตั้งค่าแล้ว + deploy แล้ว + frontend push แล้ว (ยืนยันจากผู้ใช้ 8 ก.ย. 69)** —
ลำดับ deploy ที่ใช้จริง (ปลอดภัย ไม่มีช่วงพัง): push frontend เข้า `main` ก่อน (Vercel auto-deploy, ส่ง key แต่
backend เก่ายังไม่เช็คเลยไม่กระทบอะไร) รอ deploy เสร็จ แล้วค่อยตั้ง Script Property + แปะ `order-app-Code.gs` +
deploy backend ทีหลัง — **ถ้าแก้ auth/key เรื่องนี้ต่อในอนาคต ให้แนะนำลำดับเดียวกันนี้เสมอ (frontend ก่อน backend
เสมอเมื่อ backend กำลังจะเริ่มบังคับ requirement ใหม่ที่ frontend เก่ายังไม่รู้จัก)**

### สถานะล่าสุด (อัปเดต 8 ก.ย. 69) — แก้การเทียบยอดขาย MoM/YoY ให้ตัดช่วงวันเท่ากัน

**ปัญหาที่พบ**: หน้าแดชบอร์ด "ภาพรวม → ยอดขาย" (`renderDashboardSales`) เทียบยอดขายเดือนที่ยังไม่จบ (เช่นวันนี้อยู่
วันที่ 8-9 ของเดือน) กับยอดขาย**เต็มเดือน**ก่อนหน้าตรงๆ — ทำให้ % เปลี่ยนแปลงดูแย่เกินจริงเสมอ (เทียบข้อมูล ~9 วัน
กับ ~30 วัน) ผู้ใช้เจอจากภาพจริง (เดือนนี้ 9 วันแรก ฿113,236 เทียบกับเดือนก่อนเต็มเดือน ฿448,070 → โชว์ "ลดลง 75%"
ทั้งที่ไม่ได้แย่ขนาดนั้นจริง)

**แก้แล้ว**: เพิ่ม `isInProgressMonth(y,m)` เช็คว่าเดือนที่กำลังดูอยู่คือเดือนปัจจุบันจริงๆ (ยังไม่จบ) หรือไม่ — ถ้าใช่
ตัดช่วงเดือนที่เอามาเทียบ (`prevE`) ให้เหลือแค่ "วันที่ 1 ถึงวันเดียวกับวันนี้" เท่านั้น (cap ไม่ให้เกินจำนวนวันจริงของ
เดือนที่เทียบ เผื่อกรณีเทียบกับเดือน ก.พ.) แทนที่จะเอาทั้งเดือนมาเทียบ — ใช้ได้ทั้งโหมด "เทียบเดือนก่อน" และ
"เทียบปีก่อน" (logic เดียวกัน ไม่ต้องแยก) เพิ่มข้อความ periodNote ต่อท้าย insight บอกช่วงวันที่กำลังเทียบให้ชัดเจน
เช่น "(เทียบเฉพาะวันที่ 1-8 เท่ากันทั้งสองช่วง เพราะเดือนนี้ยังไม่จบ)"

**เดือนที่จบแล้วไม่กระทบเลย** — เทียบเต็มเดือนต่อเต็มเดือนเหมือนเดิมทุกอย่าง (`isInProgressMonth` return false)
ปัญหานี้เกิดเฉพาะตอนดูเดือนที่ยังไม่จบเท่านั้น

**ทำไมไม่ใช้การหารเฉลี่ยต่อวันแทน** (ผู้ใช้เสนอมาเองว่าอาจต้องหารเฉลี่ยเพราะแต่ละเดือนวันไม่เท่ากัน) — ตัดช่วงให้
จำนวนวันเท่ากัน (day-range capped) แก้ปัญหา "จำนวนวันไม่เท่ากัน" ได้ในตัวอยู่แล้ว โดยไม่ต้องหารเฉลี่ยเพิ่ม การหารเฉลี่ย
จะจำเป็นก็ต่อเมื่อยืนกรานเทียบกับเต็มเดือนก่อน (จำนวนวันไม่เท่ากันจริง) ซึ่งไม่ใช่สิ่งที่ต้องการ

**ทำเดโม่ก่อน implement ตาม workflow**: ใช้ไฟล์ `index.html` จริงทั้งไฟล์ทับ (ไม่ใช่ mockup) override
`safeFetchJSON`/`postAction` ด้วยข้อมูลจำลอง (เดือนก่อนเต็มเดือน + เดือนนี้ถึงแค่วันนี้จริงตาม `new Date()`) แล้ว
override `renderDashboardSales` ด้วย logic ใหม่ ให้ดูผลจริงก่อน ได้ approve แล้วค่อย implement ใน `index.html` จริง

**ทดสอบแล้ว**: `node --check` ผ่าน + Playwright E2E จริง (mock `page.route()`) ยืนยัน 2 เคส — (1) เดือนที่ยังไม่จบ
โชว์ periodNote ถูกต้อง และ prevTotal คำนวณจากแค่ N วันแรกจริง ไม่ใช่เต็มเดือน (2) เดือนที่จบแล้ว **ไม่**โชว์
periodNote และยังเทียบกับเต็มเดือนก่อนเหมือนเดิม (regression check) — ผ่านหมดทุกเคส

### สถานะล่าสุด (อัปเดต 8 ก.ย. 69 — ต่อ) — ตรวจสอบฝั่งลูกค้า: ลบฟีเจอร์รีวิวปลอม + แก้ประสิทธิภาพ `getOrders`

**ตามคำขอ "ตรวจสอบแอปฝั่งลูกค้าว่ามีช่องโหว่/บั๊ก/หน่วงตรงไหนอีก"** ไล่โค้ดฝั่งลูกค้าทั้งหมด (ไม่ใช่แค่อ่านผ่านๆ —
ไล่ทุกจุดที่ยิง network call จริง) เจอ 3 จุด แก้ครบทั้ง 3 แล้ว:

✅ **[ลบแล้ว] ฟีเจอร์ "ให้คะแนน/ติชม" เป็นของปลอม ไม่เคยถูกต่อเข้าเมนูเลย** — `feedbackSection`/`reviewSection`
(รวม `setupReview`/`rateReview`/`submitReview`/`currentRating`) มีโค้ดสมบูรณ์ (ให้ดาว, คอมเมนต์, แยกร้าน/พนักงานคนที่
1/2) แต่ **ไม่มีทางเข้าถึงจากเมนูไหนในแอปเลยสักจุด** (เช็คแล้ว: ไม่มี `goSection('feedback')` เรียกจากที่ไหนนอกจาก
ปุ่มย้อนกลับที่วนกลับมาหน้าเดียวกันเอง) — ต่อให้เข้าถึงได้ก็เป็นของปลอมอยู่ดี (`submitReview()` แค่โชว์ "ขอบคุณ" ไม่เคย
ส่งข้อมูลไปไหนเลย ไม่มี action/sheet เก็บรีวิวใน backend เลยสักตัว) ผู้ใช้ยืนยันให้ลบทิ้งทั้งหมด (ไม่ต่อให้ใช้งานได้จริง)
— ลบ HTML 2 section + ฟังก์ชัน JS 3 ตัว + ตัวแปร 1 ตัว + จุดอ้างอิงใน `goHome()`/`goSection()` ครบ เช็คแล้วไม่มี
ที่ไหนอ้างอิงเหลือค้าง (`grep` ทั้งไฟล์ = 0 ผลลัพธ์)

✅ **[แก้แล้ว] `getOrders` ฝั่งลูกค้าไม่มี limit เลย — เหมือน `getAdminOrders` ก่อนแก้เป๊ะ แต่หนักกว่า**: เรียกจาก
6 จุดในแอป ส่งประวัติ**ทั้งหมดตลอดชีพ**ของลูกค้าทุกครั้ง จุดที่หนักสุดคือหน้า track ที่ auto-refresh ทุก **10 วิ**
(เร็วกว่า `getAdminOrders` เดิมที่เป็น 30 วิ) — ยิ่งลูกค้าสั่งสะสมมานาน ยิ่งช้าลงเรื่อยๆ เฉพาะคนนั้น เพิ่ม action ใหม่
`getTrackOrders(customer_id)` ใน `order-app-Code.gs` ทำ filter ที่ backend ให้ตรงกับที่ frontend กรองทิ้งอยู่แล้ว
(active/pending/packing ทุกอันไม่ว่าจะเก่าแค่ไหน + เสร็จ/ยกเลิกล่าสุดอย่างละ 5 อัน — ค่าคงที่
`TRACK_ORDERS_RECENT_LIMIT`) — สลับไปใช้ตัวใหม่ 4 จาก 6 จุด (`loadTrackSection`, auto-refresh, dedup-check ใน
`findRecentMatchingOrder`, `openReorderModal`) **`loadHistory()` (แท็บ "ประวัติทั้งหมด") ยังคงใช้ `getOrders` เดิม
ตั้งใจไม่แตะ** เพราะจุดนั้นต้องการเห็นทุกออเดอร์จริงๆ ตามชื่อฟีเจอร์ ไม่ได้ auto-refresh ถี่เหมือนหน้า track เลยความเสี่ยง
ต่ำกว่ามาก — **หน้าตาที่ลูกค้าเห็นเหมือนเดิมทุกอย่าง ไม่เปลี่ยนอะไรที่มองเห็นได้เลย** เปลี่ยนแค่ปริมาณข้อมูลที่ส่งมา

✅ **[แก้แล้ว] `placeOrder()` ยิง `getOrders` ซ้ำโดยไม่จำเป็นหลังสั่งของสำเร็จ**: `createOrder` คืน `order_id` จริง
มาให้ในตัวอยู่แล้วตอนสำเร็จ (`result.order_id`) แต่โค้ดเดิมไม่ใช้ค่านั้น กลับไปยิง `getOrders` (ตอนนี้คือ
`getTrackOrders` แล้ว) ซ้ำเพื่อ "เดา" เอาจาก `orders[0]` แทน — ตัดการยิงซ้ำทิ้งทั้งก้อน ใช้ `result.order_id` ตรงๆ
(fallback เป็น `pendingOid` เดิมเฉพาะกรณี `result.order_id` หายไปจริงๆ) ปิดทั้งการยิง request เปล่าประโยชน์ในจุดที่
ลูกค้าใช้บ่อยที่สุดของแอป และปิดความเสี่ยงที่เคยมีว่า `orders[0]` อาจไม่ใช่ออเดอร์ที่เพิ่งสั่งจริงถ้ามีออเดอร์อื่นแทรกมา

**ทดสอบแล้ว**: `node --check` ผ่านทั้ง 2 ไฟล์ + unit test แยกของ `getTrackOrders()` ใน Node (mock ข้อมูล 8 done/
8 cancelled/2 active คนละอายุ ยืนยันว่ากรองเหลือแค่ active ทั้งหมด+ล่าสุดอย่างละ 5 ถูกต้อง และไม่หลุดข้อมูลลูกค้าอื่นมา
ปนด้วย) + Playwright E2E จริงยืนยัน 12 เคสครบทั้ง 3 เรื่อง (ฟีเจอร์รีวิวหายสนิท, 4 จุดใหม่เรียก `getTrackOrders` ไม่ใช่
`getOrders`, `loadHistory` ยัง unaffected เหมือนเดิม, `placeOrder` เรียกแค่ `createOrder` ไม่มี fetch ซ้ำ และโชว์
order_id ที่ถูกต้องจาก response จริง) — ผ่านหมดทุกเคส

### สถานะล่าสุด (อัปเดต 8 ก.ย. 69 — ต่อ) — แก้เข้าแอปแบบไม่มี `?ref=` โชว์ error ผิดเรื่อง

**พบระหว่างไล่หา "จุดที่ enhance ได้อีก" ตามคำขอผู้ใช้**: เปิด `index.html` แบบไม่มี query string เลย (เช่น
`https://samurai-murex.vercel.app/` เฉยๆ) จะเห็นหน้า home ที่ดูใช้งานได้ปกติ (โชว์ "สวัสดีครับ" เฉยๆ ไม่มีชื่อ) แต่
`customer` เป็น `null` อยู่เบื้องหลัง — กดปุ่ม "สั่งสินค้า" จะเห็นร้านว่างเปล่า (ไม่มี error) และกดปุ่ม "ติดตามสถานะ"
**ไม่ได้พัง/ไม่มี JS error เต็มจอ** (แก้คำพูดตัวเองจากตอนแรกที่บอกว่า "พัง" — เกินจริง) เพราะ `loadTrackSection()`
อ่าน `customer.customer_id` อยู่ใน `try{}` block ที่ดักไว้อยู่แล้ว — สิ่งที่เกิดขึ้นจริงคือ**โชว์ข้อความ "โหลดข้อมูลไม่ได้"**
ซึ่งหลอกลูกค้าว่าเน็ตมีปัญหา ทั้งที่จริงๆ ไม่เกี่ยวเน็ตเลย (สาเหตุจริงคือไม่มีข้อมูลลูกค้าอยู่เบื้องหลังต่างหาก) — ยืนยันด้วย
เทส before/after เทียบโค้ดจริง 2 เวอร์ชันแล้ว (ดูหัวข้อทดสอบด้านล่าง) ไม่ใช่แค่เดา

**ทำไมเกิดขึ้นได้ทั้งที่ลิงก์ที่ให้ลูกค้ามี `?ref=` เสมอ**: `manifest.json` (ผู้ใช้ตั้งใจทำไอคอน PWA ไว้เอง — มี
`icon-192.png`/`icon-512.png`/เวอร์ชัน black ครบ) ตั้ง `start_url: "/"` — ไม่มี `?ref=` ติดไปด้วย เพราะเป็นไฟล์เดียว
ใช้ร่วมกันทุกคน ใส่ค่าเฉพาะคนไม่ได้ — พฤติกรรมมาตรฐานของ PWA คือตอนลูกค้ากด "ติดตั้งแอป"/"เพิ่มหน้าจอโฮม"
เบราว์เซอร์จะจำแค่ `start_url` จาก manifest ไปใช้เปิดทุกครั้งในอนาคต **ไม่ได้จำ URL ที่กดติดตั้งตอนนั้น** — แปลว่า
ลูกค้าคนไหนก็ตามที่กด "ติดตั้งแอป" จากลิงก์ส่วนตัวของตัวเอง ไอคอนที่ได้จะพาไปหน้าที่พังแบบนี้ทุกครั้งที่เปิดในอนาคต

✅ **แก้แล้ว**: `initCustomer()` จำ `customerRef` ที่เพิ่งเข้าสำเร็จไว้ใน `localStorage`
(`samurai_customer_ref`) — `window.onload` เมื่อเจอ query string ว่างเปล่าเลย จะลองอ่านค่านี้ก่อน ถ้ามีจะ
`location.replace` เด้งกลับไปที่ `?ref=<ค่าที่จำไว้>` อัตโนมัติ (โหลดร้านของลูกค้าคนนั้นได้ปกติ ไม่ต้องเจอข้อความ error
ผิดเรื่องอีกต่อไป) ถ้าไม่มีเลย (เครื่องใหม่/ล้าง storage) แสดง `showError(false)` (หน้า "ลิงค์นี้อาจไม่ถูกต้อง กรุณาติดต่อ
ร้านค้าครับ" — ข้อความตรงประเด็นจริง) แทนที่จะปล่อยให้ไปเจอหน้า home ที่ดูปกติแต่กดอะไรก็ได้ข้อความหลอก —
ไม่ได้แตะ backend เลย แก้แค่ `index.html`

**ทดสอบแล้ว 2 รอบ**:
1. Playwright E2E จริง (ใช้ browser context เดียวกันเพื่อให้ localStorage ข้ามหน้าได้เหมือนอุปกรณ์จริง) ยืนยัน 3 เคส:
   เข้าด้วย `?ref=` ปกติแล้ว ref ถูกจำไว้ / เข้าแบบไม่มี query string ทีหลัง (จำลองเปิดผ่านไอคอน PWA) เด้งกลับไปโหลด
   ร้านถูกต้องอัตโนมัติ / browser context ใหม่ที่ไม่เคยมี ref จำไว้เลยโชว์หน้า error ที่ตรงประเด็น
2. **ผู้ใช้ขอให้ทดสอบเทียบก่อน-หลังให้เห็นผลต่างจริงก่อนอนุญาตไปต่อ** — ทำเทส before/after รันโค้ดจากคอมมิตล่าสุด
   (ยังไม่มี fix) เทียบกับโค้ดที่แก้ในเครื่อง (มี fix) ด้วยสถานการณ์เดียวกันเป๊ะ ผลคือก่อนแก้: ลูกค้าค้างอยู่หน้า home
   ที่ไม่มีข้อมูล กด "ติดตามสถานะ" โชว์ "โหลดข้อมูลไม่ได้" (ข้อความหลอก) — หลังแก้: เด้งกลับไปโหลดร้านสำเร็จอัตโนมัติ
   ไม่มี JS error ทั้งสองเวอร์ชัน (ยืนยันว่าไม่ใช่ "crash" แบบที่เคยพูดผิดไปตอนแรก) — ผ่านหมดทุกเคสทั้ง 2 รอบ

### สถานะล่าสุด (อัปเดต 10 ก.ย. 69) — ออเดอร์ซ้ำจริงจาก cold-connection timeout + แก้ด้วย idempotency key

**บริบท**: ลูกค้ารายงานเจอ alert "บันทึกคำสั่งซื้อไม่สำเร็จ" ตอนสั่งของ (~07:39) ตรวจสอบแล้วพบว่า `createOrder`
บันทึกสำเร็จจริง (ร้านเห็นออเดอร์) แต่ response หลุด/timeout กลับมาหา client (cold connection ปัญหาเดิมที่เคย
บันทึกไว้แล้วในไฟล์นี้) — ลูกค้าเห็น alert เลยกดสั่งซ้ำเอง ยืนยันจาก Telegram ที่แจ้งเตือน "ออเดอร์ใหม่" 2 รอบ ->
**เกิดออเดอร์ซ้ำจริงในชีต** ไม่ใช่แค่ false-alarm ทาง UX เท่านั้น (ตรงกับ trade-off ที่เคย flag ไว้ตอนแก้เรื่อง
คำนวณ `total` ใหม่ที่ backend เมื่อ 8 ก.ย. 69 — แต่ครั้งนี้ต้นตอเป็น connection ล้มเหลวทั้ง `createOrder` และ
`findRecentMatchingOrder`'s dedup check พร้อมกัน ไม่ใช่กรณี `total` ไม่ตรงกันตามที่เคยคาดไว้)

**Vercel logs ไม่เกี่ยวข้องกับบั๊กประเภทนี้เลย**: แอปนี้เป็น static site ล้วน ยิง request ตรงจาก browser ไปหา
Google Apps Script โดยไม่ผ่าน Vercel backend ใดๆ — ถ้าเจอรายงาน "สั่งของ/บันทึกไม่สำเร็จ" ในอนาคต ไม่ต้องเสียเวลา
เช็ค Vercel runtime logs/errors เลย ให้เช็ค Apps Script Executions log แทน (ตามธรรมเนียมเดิมของแอปเช็คสต๊อก)

**แก้แล้ว (ยังไม่ deploy backend — รอผู้ใช้แปะ `order-app-Code.gs` ใหม่)**: เพิ่ม idempotency key กัน
`createOrder` สร้างแถวซ้ำ:
- `index.html`: `showConfirm()` สร้าง `orderIdemKey` ใหม่ทุกครั้งที่เข้าหน้ายืนยันออเดอร์ (คู่กับ `pendingOid` เดิม)
  ส่งไปกับ payload ของ `placeOrder()` — key เดิมนี้ถูกใช้ซ้ำทั้งตอน auto-retry ของ `postAction` และตอนลูกค้ากดปุ่ม
  "ยืนยันสั่งซื้อ" ซ้ำเองด้วยมือ (เพราะไม่ได้เรียก `showConfirm()` ใหม่) จนกว่าจะสำเร็จจริงหรือกลับไปเริ่มออเดอร์ใหม่
  (`showOrderSuccessScreen()` reset เป็น `''`) — เปิด auto-retry ให้ `createOrder` แล้ว (`postAction(...,15000,1)`
  จากเดิม `retries=0`) เพราะตอนนี้ปลอดภัยแล้วที่ backend
- `order-app-Code.gs`: `createOrder` ห่อด้วย `LockService.getScriptLock()` (pattern เดียวกับ `updateDelivery`)
  เช็ค `CacheService` ก่อนว่าเคยสร้างออเดอร์ด้วย `idempotency_key` นี้แล้วหรือยัง (TTL 5 นาที) ถ้าเจอคืน `order_id`
  เดิมกลับไปเลยไม่ `appendRow` ซ้ำ — **ไม่บังคับว่าต้องมี key** (frontend เก่าที่ cache ค้างยังทำงานได้ปกติ แค่ไม่มี
  dedup protection ให้ เหมือนพฤติกรรมเดิมก่อนแก้)

**ทดสอบแล้ว**:
- `node --check` ผ่านทั้ง 2 ไฟล์
- Unit test แยกใน Node (mock `LockService`/`CacheService`/`SpreadsheetApp`) ครอบคลุม 4 เคส: key เดิมซ้ำ ->
  ได้ `order_id` เดิม + `appendRow` แค่ 1 ครั้ง, key ต่างกัน -> คนละออเดอร์, ไม่มี key เลย -> พฤติกรรมเดิม (ไม่ dedup,
  backward compat), lock ชนกัน -> คืน error สุภาพไม่เขียนแถว — ผ่านหมด
- Playwright E2E จริง (mock `page.route()`) 3 เคส: (1) attempt แรกพัง auto-retry สำเร็จ -> ไม่โชว์ alert เลย
  ทั้ง 2 ครั้งส่ง key เดียวกัน (2) ทั้ง 2 attempt พังหมด -> โชว์ alert ไม่สำเร็จ แล้วกดปุ่มซ้ำเอง (manual retry) ->
  ยังใช้ key เดิมทุกครั้งทั้ง 4 คำขอ (3) สั่งสำเร็จแล้วกลับไปสั่งออเดอร์ใหม่รอบสอง -> ได้ key ใหม่ไม่ซ้ำของเดิม —
  ผ่านหมดทุกเคส

**ขั้นต่อไป**: ผู้ใช้ต้องแปะ `order-app-Code.gs` เวอร์ชันใหม่ใน Apps Script Editor (Manage deployments -> New
version) — ยังไม่ได้ push ขึ้น `main` (รอ approve ตามธรรมเนียมเดิม) frontend/backend รอบนี้ compatible กันทั้ง
2 ทิศทาง (deploy backend ก่อนหรือหลัง push frontend ก็ได้ ไม่มีช่วงพัง เพราะ backend ไม่บังคับว่าต้องมี key)

⚠️ **[พักไว้ 10 ก.ย. 69] ผู้ใช้ขอเก็บ fix นี้ไว้ก่อน** — ยังไม่ deploy/push ทั้งคู่ รอแก้อีกเรื่องหนึ่งให้เสร็จก่อน
แล้วจะขึ้นระบบ (deploy backend + push frontend) พร้อมกันทีเดียว โค้ดทั้ง 2 ไฟล์ในเครื่อง/ใน repo นี้แก้เสร็จพร้อม
ใช้แล้ว แค่รอคำสั่งให้ deploy จริง — **ห้าม push/เตือนให้ deploy fix นี้เองโดยไม่ถูกถาม**

### สถานะล่าสุด (อัปเดต 10 ก.ย. 69 — ต่อ) — "อีกเรื่อง" ที่รออยู่คือบั๊ก lock ค้างเพราะ Telegram (พบ+แก้แล้ว)

**บริบท**: ผู้ใช้ส่งภาพจริงจากฝั่งแอดมิน — กด "จัดเสร็จแล้ว" (`markDone`) แล้วเจอ error
`updateDelivery: ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง` (ข้อความจาก `LockService` ที่เพิ่มไป 8 ก.ย. 69)
นี่คือ "อีกเรื่อง" ที่ผู้ใช้บอกว่าจะรอแก้ก่อนขึ้นระบบพร้อมกับ idempotency key fix ด้านบน

**Root cause**: `sendTelegramNotify()` (network call ใช้เวลาไม่แน่นอน) เดิมถูกเรียก**ข้างใน**
`try{...}finally{lock.releaseLock()}` ของ `updateDelivery` — ถ้า Telegram ช้า lock จะถูกถือค้างนานเกิน 10 วิได้
คำขอ `updateDelivery` อื่นที่เข้ามาพร้อมกัน (เช่น auto-retry ของ `postAction` ที่ `markDone()`/`markPacking()`
ไม่ได้ปิด retry ไว้ ใช้ default `retries=1`) จะ `waitLock` timeout เห็น error นี้ ทั้งที่คำขอแรกอาจสำเร็จจริงอยู่ดี
— รูปแบบบั๊กเดียวกับเคสออเดอร์ซ้ำตอนเช้า (10 ก.ย. 69) แค่คนละฟังก์ชัน

⚠️ **เจอบั๊กแฝงตัวเดียวกันใน `createOrder` ที่เพิ่งแก้ไปก่อนหน้านี้ในเซสชันเดียวกัน (ยังไม่ deploy)** — ตอนเขียน
lock+idempotency ให้ `createOrder` ผมคัดลอกโครงเดิมมาโดยไม่ทันสังเกตว่า `sendTelegramNotify()` อยู่ในลูปก่อน
`lock.releaseLock()` เหมือนกัน ถ้า deploy ไปตอนนั้นจะเจอปัญหาเดียวกันกับฝั่งลูกค้าได้ — แก้พร้อมกันในรอบนี้เลย

**แก้แล้วทั้ง 2 จุด**: ย้าย `sendTelegramNotify()` ไปเรียกใน `finally` **ต่อจาก** `lock.releaseLock()` (เก็บแค่
message string ไว้ในตัวแปร `notifyMessage` ระหว่างอยู่ใน critical section) — lock จะถือแค่ช่วงอ่าน/เขียนชีต
(เร็ว) เท่านั้น ไม่ถือระหว่างรอ Telegram ตอบกลับอีกต่อไป ไม่ต้องปรับ timeout 10 วิหรือ logic อื่นเลย

**ทดสอบแล้ว**:
- `node --check` ผ่าน
- Unit test ใหม่ 3 เคส (mock เก็บลำดับการเรียก call log): `createOrder` และ `updateDelivery` (status `done`)
  ยืนยันว่า `releaseLock` เกิดก่อน `sendTelegramNotify` เสมอ, `updateDelivery` (status `packing`) ยืนยันว่ายังไม่
  แจ้ง Telegram เหมือนเดิม (ไม่ใช่ regression) — ผ่านหมด
- รัน unit test ชุด idempotency key เดิม (4 เคส) ซ้ำอีกรอบ ยืนยันว่าไม่มี regression จากการย้าย Telegram —
  ผ่านหมดเหมือนเดิม

**สถานะ deploy**: ยังพักไว้เหมือนเดิมตามที่ผู้ใช้ขอ — `order-app-Code.gs` ในเครื่อง/ใน repo นี้ตอนนี้มีทั้ง 2 fix
(idempotency key + Telegram-outside-lock) พร้อม deploy พร้อมกันทีเดียวเมื่อได้รับคำสั่ง ยังไม่ได้ push ขึ้น `main`

**เคสนี้ยังต้องติดตามต่อ**: แนะนำให้ร้านเช็คว่าออเดอร์ซ้ำที่เกิดจริงเมื่อเช้า 10 ก.ย. 69 ถูกยกเลิก/จัดการแล้วหรือยัง
(ไม่ใช่ปัญหาโค้ด แต่เป็นข้อมูลที่ค้างอยู่ในชีตจากก่อนแก้)

## Bill Templates by Supplier

Use this reference to identify supplier from bill photos without needing to ask.

---

### S001 — ลุงทวี
- รูปแบบ: ใบส่งสินค้าเขียนมือ **กระดาษสีเหลืองหรือกระดาษขาว** หมึกสีน้ำเงิน (สีกระดาษไม่ใช่ตัวชี้ขาด — ลุงทวีส่งทั้งสองแบบ)
- หัวบิล: "ชื่อลูกค้า ซามูไร ไส้กรอก 1" หรือ "ชื่อลูกค้า ซามูไร ไส้กรอก 2" เขียนมือ, "ใบส่งสินค้า"
- คอลัมน์: ลำดับ | รายการ | จำนวน | ราคา | จำนวนเงิน
- ไม่มีชื่อซัพพลายเออร์บนบิล — แยกจาก S025 ตานะ ด้วยรูปแบบหัวบิล ("ชื่อลูกค้า ซามูไร ไส้กรอก..." vs "ใบเก็บเงิน") และจากบิลเขียนมือเจ้าอื่นด้วยรายการสินค้า
- สินค้าหลัก: แฮมหมู (โทสต์แฮม 500g, กุ๊กแฮม 1000g), เอ็นเนื้อ/เอ็นหมูปอง (พรชัย, พงษ์เจริญ), เนื้อขาย (ปอง), ลูกชิ้นปลา/เนื้อหลายชนิด, ยอ/จ้อ/หมูยอ, ไส้อั่ว, น้ำจิ้ม, เต้าหู้หมู — รายการเยอะมาก 20-30 รายการต่อใบ
- หมายเหตุ: ทุกใบที่หัวบิลเขียน "ชื่อลูกค้า ซามูไร ไส้กรอก 1/2" คือลุงทวีทั้งหมด ไม่ว่าจะเป็นล็อตแฮมหมูหรือล็อตเอ็นเนื้อ — ไม่ต้องแยกเป็นซัพพลายเออร์อื่น

### S002 — แปดเชียน ฟู้ด (แปดเซียน ฟู้ด)
- โลโก้: อักษรจีน "八仙" ในกรอบสี่เหลี่ยม มุมบนซ้าย
- หัวบิล: "บิลเรียกเก็บเงิน — แปดเชียน ฟู้ด" ตัวใหญ่
- รูปแบบ: ตารางสองคอลัมน์ รายการ | จำนวน | เป็นเงิน
- ร้านค้า: เจ๊พัชร์ลิตา

### S004 — SINTA (บริษัท ชินต้า จำกัด)
- หัวบิล: "บริษัท ชินต้า จำกัด (สำนักงานใหญ่)" หรือ "SIMTA"
- ที่อยู่: 97 หมู่ 8 ซ.สุขสวัสดิ์ 78 ถ.สุขสวัสดิ์ ต.บางจาก อ.พระประแดง สมุทรปราการ 10130
- รูปแบบ: ใบส่งของ/ใบกำกับภาษี มีรหัสลูกค้า

### S005 — CPF Global Food Solution
- หัวบิล: "บมจ. ซีพีเอฟ โกลบอล ฟู้ด โซลูชั่น / CPF Global Food Solution Public Company Limited"
- ที่อยู่: เลขที่ 3 อาคาร ช.พี.ทาวเวอร์ 2 ชั้น 28,29 ถนนรัชดาภิเษก แขวงดินแดง กรุงเทพ 10400
- Tax ID: 0107566000135
- รูปแบบ: ใบกำกับภาษี/ใบส่งสินค้า พื้นขาว ตัวอักษรสีน้ำเงิน
- รหัสสินค้า: 8 หลัก (เช่น 23062883)

### S006 — PFP (บริษัท พี.เอฟ.พี. เทรดดิ้ง จำกัด)
- หัวบิล: "บริษัท พี.เอฟ.พี. เทรดดิ้ง จำกัด / P.F.P. TRADING CO., LTD."
- โลโก้: "Pfp" script หรือตัวย่อ P.F.P. ในกรอบ
- ที่อยู่: 11/12-14 ถนนรัชดาภิเษก แขวงช่องนนทรี เขตยานนาวา กรุงเทพ 10120

### S007 — มหาชัยฟู้ดส์ (บริษัท มหาชัยฟู้ดส์ จำกัด)
- หัวบิล: "บริษัท มหาชัยฟู้ดส์ จำกัด / Mahachai Foods Co., Ltd."
- ที่อยู่: 71/11 หมู่ที่ 6 ท่าทราย เมืองสมุทรสาคร 74000
- Tax ID: 0-1055-32104-62-9
- รหัสลูกค้า: C2408005, สายส่ง MF011-N
- รูปแบบ: ต้นฉบับใบส่งสินค้า/ใบกำกับภาษี เลขที่ SM260XXXXXX รหัสสินค้า V + 6 หลัก

### S008 — นำชัย ฟู้ด อินโนเวชันส์
- หัวบิล: "บริษัท นำชัย ฟู้ด อินโนเวชันส์ จำกัด / NAMCHAI FOOD INNOVATIONS"
- โลโก้: NAMCHAI FOOD INNOVATIONS ตัวหนา
- ที่อยู่: 22/2 หมู่ที่ 8 แขวงศาลาธรรมสพน์ เขตทวีวัฒนา กรุงเทพ 10170
- Tax ID: 0105567220455
- รูปแบบ: บิลเงินสด/ใบกำกับภาษีอย่างย่อ

### S009 — สตาร์อัพ มาร์เก็ตติ้ง
- หัวบิล: "บริษัท สตาร์อัพ มาร์เก็ตติ้ง จำกัด"
- Tax ID: 0105562013834, รหัสลูกค้า: 6402051
- รูปแบบ: ใบกำกับสินค้า/ใบกำกับภาษี
- สินค้าหลัก: STUF ไส้อั่วไข่ชีล (1,000g / 16 ชิ้น)

### S010 — เจริญ ฟู้ดส์ โปรดักส์
- หัวบิล: "บริษัท เจริญ ฟู้ดส์ โปรดักส์ จำกัด / CHAROENFOODSPRODUCT CO., LTD."
- ที่อยู่: 18/1 หมู่ที่ 12 ตำบลบึงคอไห ลำลูกกา ปทุมธานี
- รูปแบบ: ใบส่งของ/ใบกำกับภาษี/ใบแจ้งหนี้ DELIVERY / TAX INVOICE / INVOICE

### S011 — GSB International
- หัวบิล: "GSB INTERNATIONAL CO., LTD. / บริษัท จีเอสบี อินเตอร์เนชั่นแนล จำกัด"
- Tax ID: 0135542000508, รหัสลูกค้า: NPU-01
- รูปแบบ: ใบกำกับภาษี
- สินค้าหลัก: ไก่แต่งรมควัน, ไส้กรอกรมควัน

### S012 — TVI (บริษัท อุตสาหกรรมทวีวงษ์ จำกัด)
- หัวบิล: "บริษัท อุตสาหกรรมทวีวงษ์ จำกัด / THAVEEVONG INDUSTRY CO., LTD."
- ที่อยู่: 22 หมู่ 1 ซ.อ่อนนุช 62 เขตสวนหลวง กรุงเทพ 10250

### S014 — IOP (แหนมนิตยา) (บริษัท ไอ.โอ.พี.ฟู้ดส์ จำกัด)
- หัวบิล: "บริษัท ไอ.โอ.พี.ฟู้ดส์ จำกัด"
- ที่อยู่: 7/5 หมู่ 3 ตำบลห้วยจรเข้ อำเภอเมืองนครปฐม จังหวัดนครปฐม 73000
- Tax ID: 0735558000892
- รหัสลูกค้า: BK-K003-BK, พนักงานขาย: IOP-IOP
- รูปแบบ: ใบส่งของ/ใบแจ้งหนี้ รหัสสินค้า format 01-01-002

### S015 — โรงงานลูกชิ้นไก่ พี.พี.ฟู้ด
- หัวบิล: "โรงงานลูกชิ้นไก่ พี.พี.ฟู้ด"
- ที่อยู่: 23/310 ม.2 ต.บางเมือง เมืองสมุทรปราการ 10270
- สินค้าหลัก: ลูกชิ้นไก่

### S016 — Betagro (บริษัท เบทาโกรเกษตรอุตสาหกรรม จำกัด)
- หัวบิล: "บริษัท เบทาโกรเกษตรอุตสาหกรรม จำกัด / BETAGRO AGRO INDUSTRY COMPANY LIMITED"
- โลโก้: BETAGRO ตัวหนาสีเขียว
- ที่อยู่: 323 หมู่ที่ 6 ถนนวิภาวดีรังสิต เขตหลักสี่ กรุงเทพ 10210

### S017 — ง่วนเฮงฟาร์ม
- หัวบิล: "ใบส่งของ (ง่วนเฮงฟาร์ม)" พิมพ์สำเร็จรูป
- รูปแบบ: มีช่องค้างลังเก่า / ยอดส่ง / คืนลงมา / สรุปยอด
- สินค้าหลัก: ไข่นกสด, ไข่นกกม

### S018 — SP (ธนนวรรณ / พลขันธ์กสิกร)
- หัวบิล: พิมพ์ดอตเมทริกซ์สีน้ำเงิน ชื่อ "ธนนวรรณ พลขันธ์กสิกร" บรรทัดบนสุด
- รูปแบบ: ใบส่งสินค้า/ใบแจ้งหนี้ มีคอลัมน์ Lot No. หน่วย(จุก) จำนวน ราคา/หน่วย จำนวนเงิน
- รหัสลูกค้า: M4-408

### S019 — แหลมทองโปรตีนฟู้ดส์
- หัวบิล: โลโก้วงกลมสีเขียว ชื่อ "บริษัท แหลมทองโปรตีนฟู้ด จำกัด / LAEMTHONG PROTEIN FOODS CO., LTD."
- พื้นหลัง header: สีเขียว
- รูปแบบ: ใบกำกับภาษี มีรหัสสินค้า (เช่น 533110005) นำหน้าทุกรายการ

### S020 — จัสมิน ฟู้ด แอนด์ มาร์เก็ตติ้ง
- หัวบิล: "บริษัท จัสมิน ฟู้ด แอนด์ มาร์เก็ตติ้ง จำกัด"
- ที่อยู่: 87/283 หมู่บ้านเศรษฐสิริ วงแหวน-ลำลูกกา ลำลูกกา ปทุมธานี 12150
- Tax ID: 0135561004998
- รูปแบบ: ใบกำกับภาษี/ใบส่งสินค้า Tax Invoice/Delivery Order, สาย 6/3
- รหัสสินค้า: ตัวอักษร + 4 หลัก เช่น B0015, M0022, Q0002, N0013

### S021 — ซีเคฟู้ดส์ (บริษัท ซีเค-ฟูดส์ เอ็นเตอร์ไพรส์ จำกัด)
- หัวบิล: "บริษัท ซีเค-ฟูดส์ เอ็นเตอร์ไพรส์ จำกัด"
- ที่อยู่: 114/7 หมู่ที่ 1 ตำบลตะเคียนเตี้ย อำเภอบางละมุง ชลบุรี 20150
- Tax ID: 0205559038685
- รูปแบบ: ใบส่งของ/ใบแจ้งหนี้ รหัสสินค้า FG-CK-XXX (เช่น FG-CK-037)

### S022 — ทรัพย์ไพศาล มาร์เก็ตติ้ง
- หัวบิล: "บริษัท ทรัพย์ไพศาล มาร์เก็ตติ้ง จำกัด"
- ที่อยู่: 55/68 หมู่ที่ 3 ลำลูกกา ปทุมธานี 12150
- Tax ID: 0135565022290
- รหัสลูกค้า (Samurai): S040

### S023 — C&J
- หัวบิล: โลโก้ "C&J" ตัวหนา มุมบนซ้าย
- รูปแบบ: ต้นฉบับใบส่งของ/ใบเสร็จรับเงิน พนง.ขาย: สถาพร (เก่ง)
- สินค้าหลัก: ไม้เสียบ, น้ำจิ้ม

### S024 — เล็กโคราช
- รูปแบบ: บิลเงินสด (CASH SALE) สำเร็จรูป พื้นฟ้า มีอักษรจีน 現兌單
- ไม่มีชื่อบริษัทพิมพ์ไว้ — เขียนมือทั้งหมด
- สินค้าหลัก: อีสาน 17 ไม้, อีสานสด

### S025 — ตานะ
- รูปแบบ: ใบเก็บเงินเขียนมือ กระดาษขาว/เหลือง ตาราง ~70 ช่อง แบ่งสองคอลัมน์
- หัวบิล: "ใบเก็บเงิน" เขียนมือ มีช่อง "ร้าน" และ "วันที่"
- ไม่มีชื่อซัพพลายเออร์บนบิล
- สินค้าหลัก: เต้าหู้ไข พบ., เส้น, วุ้นเส้น, ยอ, เอ็นเนื้อ, จ้อ หลากหลายชนิด
