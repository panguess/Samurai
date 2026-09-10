/**
 * ระบบเช็คสต๊อก & สั่งของ — ซามูไร ไส้กรอก
 * BillCapture — Apps Script Web App แยกต่างหาก (10 ก.ย. 69)
 *
 * ทำไมต้องแยกจากไฟล์ Code.gs หลัก:
 * Web App ของ Code.gs หลักรันในนามบัญชี Google เดียวกันทุกคำขอ ("Execute as: Me") — ทุกคนที่เปิดแอป
 * (เจ้าของ + ลูกจ้างทุกคน) ใช้โควต้า "จำนวนการรันพร้อมกัน" ก้อนเดียวกันหมด ฟีเจอร์ถ่ายบิลให้ AI อ่าน
 * (analyzeBillPhoto/analyzeBillBatch) กินเวลา 45-100+ วินาทีต่อครั้ง (รอ Gemini ตอบ) นานผิดปกติเทียบกับ
 * action อื่นในแอปที่ปกติจบใน 1-4 วิ — เจอ 10 ก.ย. 69 ว่าตอนถ่ายบิลพร้อมกับเจ้าของเปิดหน้าอื่น มีคำขออื่น
 * ที่ไม่ถึงโค้ด doGet เลยด้วยซ้ำ (ไม่มี log โผล่แม้เพิ่ม log ทุก action ไปแล้ว) สงสัยว่าโดน Google ปฏิเสธ
 * ตั้งแต่ชั้น infrastructure เพราะโควต้าการรันพร้อมกันเต็ม แยกไฟล์นี้ออกมาเป็นโปรเจกต์ Apps Script ต่างหาก
 * (deploy คนละ URL คนละโควต้า) ไม่ให้ถ่ายบิลที่ช้าโดยธรรมชาติไปแย่งทรัพยากรกับการเช็คสต๊อก/สั่งของ/ดูบิล
 * รอตรวจสอบที่ควรเร็วอยู่แล้ว — อ่าน/เขียน Google Sheet ตัวเดิมได้ปกติ (คนละสคริปต์ แต่ spreadsheet เดียวกัน)
 *
 * ============ ขั้นตอนติดตั้ง (ทำครั้งเดียว) ============
 * 1. เปิด Google Sheet ตัวเดิมที่แอปเช็คสต๊อกใช้อยู่ → คัดลอก Spreadsheet ID จาก URL แถบที่อยู่เบราว์เซอร์
 *    (https://docs.google.com/spreadsheets/d/[ตรงนี้คือ Spreadsheet ID]/edit) → แทนที่ค่า SPREADSHEET_ID
 *    ด้านล่างนี้ด้วย ID จริงที่คัดลอกมา
 * 2. ไปที่ https://script.google.com/ → New project → ตั้งชื่อโปรเจกต์ (เช่น "Samurai BillCapture")
 * 3. ลบโค้ด default ทั้งหมดในไฟล์ Code.gs ของโปรเจกต์ใหม่ แล้ววางไฟล์นี้ทั้งไฟล์แทน (หลังแก้ SPREADSHEET_ID แล้ว)
 * 4. Project Settings (ไอคอนเฟือง) → Script Properties → เพิ่ม GEMINI_API_KEY เหมือนกับที่ตั้งไว้ใน
 *    โปรเจกต์ Code.gs หลัก (ใช้ค่าเดียวกันได้เลย ไม่ต้องขอ key ใหม่)
 * 5. Deploy → New deployment → เลือกประเภท "Web app" → Execute as: Me, Who has access: Anyone → Deploy
 *    → คัดลอก Web app URL ที่ได้
 * 6. เปิด stock-check.html หา `const BILL_API_URL = 'PASTE_NEW_BILL_CAPTURE_WEB_APP_URL_HERE';`
 *    แทนที่ด้วย URL ที่คัดลอกมาจากข้อ 5 → deploy stock-check.html (push เข้า main ตามปกติ)
 * 7. ทดสอบถ่ายบิล 1 ใบจริงว่ายังทำงานถูกต้องเหมือนเดิมทุกอย่าง ก่อนแจ้งว่าเสร็จ
 *
 * ⚠️ หลังจากนี้ทุกครั้งที่แก้ฟีเจอร์ "รับของ — ถ่ายบิล" (analyzeBillPhoto, analyzeBillBatch,
 * submitBillForReview, finalizePurchaseReceipt, getPendingBillReceipts) ต้องแก้ + deploy ไฟล์นี้ในโปรเจกต์
 * แยกนี้ ไม่ใช่ไฟล์ Code.gs หลักอีกต่อไป — Code.gs หลักไม่มีฟังก์ชันเหล่านี้เหลืออยู่แล้ว
 */

// ⚠️ ต้องแทนที่ด้วย Spreadsheet ID จริงก่อน deploy (ดูขั้นตอนที่ 1 ด้านบน)
const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';
const SHEET = SpreadsheetApp.openById(SPREADSHEET_ID);
const TZ = 'Asia/Bangkok';
const PURCHASE_RECEIPTS_SHEET = 'PurchaseReceipts';
const PRODUCT_ALIAS_SHEET = 'ProductAlias';
const PENDING_BILL_SHEET = 'PendingBillReceipts';
const BILL_PHOTOS_FOLDER_ID = '14hYENihKGsCs-WW2MGnQpZZ9l9zLQga6';
// ⚠️ Google เลิกใช้/เปลี่ยนชื่อรุ่นโมเดลบ่อยมาก — ถ้าเรียกแล้ว error ว่าไม่พบโมเดล ให้เข้า
// https://aistudio.google.com ดูชื่อรุ่นปัจจุบันแล้วแก้ค่านี้ (ต้องแก้พร้อมกันทั้ง 2 โปรเจกต์ถ้ายังใช้
// Code.gs หลักเวอร์ชันเก่าที่ยังไม่ได้ตัดฟังก์ชันพวกนี้ออก)
const GEMINI_MODEL = 'gemini-3.6-flash';
// ข้อมูลอ้างอิงรูปแบบบิลต่อซัพพลายเออร์ (ย่อจาก CLAUDE.md หัวข้อ "Bill Templates by Supplier")
const BILL_TEMPLATE_HINTS = {
  S001: "ใบส่งสินค้าเขียนมือ กระดาษเหลือง/ขาว หมึกน้ำเงิน หัวบิลเขียน 'ชื่อลูกค้า ซามูไร ไส้กรอก 1/2' ไม่มีชื่อซัพพลายเออร์บนบิล สินค้าหลัก: แฮมหมู (โทสต์แฮม/กุ๊กแฮม), เอ็นเนื้อ/เอ็นหมูปอง, ลูกชิ้น, ยอ/จ้อ/หมูยอ, ไส้อั่ว, เต้าหู้หมู รายการเยอะ 20-30 รายการ",
  S002: "โลโก้อักษรจีน 八仙 มุมบนซ้าย หัวบิล 'บิลเรียกเก็บเงิน — แปดเชียน ฟู้ด' ร้านค้า: เจ๊พัชร์ลิตา",
  S004: "หัวบิล 'บริษัท ชินต้า จำกัด' หรือ 'SIMTA' ที่อยู่ ต.บางจาก อ.พระประแดง สมุทรปราการ",
  S005: "หัวบิล CPF Global Food Solution พื้นขาวตัวอักษรน้ำเงิน รหัสสินค้า 8 หลัก Tax ID 0107566000135",
  S006: "บริษัท พี.เอฟ.พี. เทรดดิ้ง จำกัด ที่อยู่ถนนรัชดาภิเษก แขวงช่องนนทรี ยานนาวา",
  S007: "บริษัท มหาชัยฟู้ดส์ จำกัด สมุทรสาคร รหัสลูกค้า C2408005 เลขที่บิล SM260XXXXXX รหัสสินค้า V+6หลัก",
  S008: "บริษัท นำชัย ฟู้ด อินโนเวชันส์ จำกัด เขตทวีวัฒนา กรุงเทพ Tax ID 0105567220455",
  S009: "บริษัท สตาร์อัพ มาร์เก็ตติ้ง จำกัด รหัสลูกค้า 6402051 สินค้าหลัก STUF ไส้อั่วไข่ชีส",
  S010: "บริษัท เจริญ ฟู้ดส์ โปรดักส์ จำกัด ลำลูกกา ปทุมธานี",
  S011: "GSB INTERNATIONAL CO., LTD. รหัสลูกค้า NPU-01 สินค้าหลัก ไก่แต่งรมควัน/ไส้กรอกรมควัน",
  S012: "บริษัท อุตสาหกรรมทวีวงษ์ จำกัด ซ.อ่อนนุช 62 สวนหลวง กรุงเทพ",
  S014: "บริษัท ไอ.โอ.พี.ฟู้ดส์ จำกัด นครปฐม รหัสลูกค้า BK-K003-BK รหัสสินค้า 01-01-002",
  S015: "โรงงานลูกชิ้นไก่ พี.พี.ฟู้ด สมุทรปราการ สินค้าหลักลูกชิ้นไก่",
  S016: "บริษัท เบทาโกรเกษตรอุตสาหกรรม จำกัด โลโก้ BETAGRO เขียว ถนนวิภาวดีรังสิต",
  S017: "ใบส่งของ (ง่วนเฮงฟาร์ม) พิมพ์สำเร็จรูป มีช่องค้างลังเก่า/ยอดส่ง/คืน สินค้าหลักไข่นก",
  S018: "พิมพ์ดอตเมทริกซ์น้ำเงิน หัวบิล 'ธนนวรรณ พลขันธ์กสิกร' รหัสลูกค้า M4-408 มีคอลัมน์ Lot No./หน่วย(จุก)",
  S019: "โลโก้วงกลมเขียว LAEMTHONG PROTEIN FOODS พื้นหลังเขียว รหัสสินค้า 9 หลัก",
  S020: "บริษัท จัสมิน ฟู้ด แอนด์ มาร์เก็ตติ้ง จำกัด ลำลูกกา ปทุมธานี รหัสสินค้าตัวอักษร+4หลัก เช่น B0015",
  S021: "บริษัท ซีเค-ฟูดส์ เอ็นเตอร์ไพรส์ จำกัด บางละมุง ชลบุรี รหัสสินค้า FG-CK-XXX",
  S022: "บริษัท ทรัพย์ไพศาล มาร์เก็ตติ้ง จำกัด ลำลูกกา ปทุมธานี รหัสลูกค้า S040",
  S023: "โลโก้ 'C&J' ตัวหนา พนง.ขาย สถาพร (เก่ง) สินค้าหลัก ไม้เสียบ/น้ำจิ้ม",
  S024: "บิลเงินสด (CASH SALE) พื้นฟ้า อักษรจีน 現兌單 เขียนมือทั้งหมด ไม่มีชื่อบริษัทพิมพ์ สินค้าหลัก อีสาน 17 ไม้/อีสานสด",
  S025: "ใบเก็บเงินเขียนมือ กระดาษขาว/เหลือง ตาราง~70ช่อง ไม่มีชื่อซัพพลายเออร์บนบิล สินค้าหลัก เต้าหู้ไข/เส้น/วุ้นเส้น/ยอ/เอ็นเนื้อ/จ้อ",
};

/* ============ server-side cache (แยกก้อนกับ Code.gs หลัก — คนละ CacheService instance) ============ */
const CACHE = CacheService.getScriptCache();
// productAlias: 10 นาที ต่อซัพพลายเออร์ — เหตุผลเดียวกับ Code.gs หลัก
// pendingBills: 30 วิ — เจอ 10 ก.ย. 69 ว่าหน้า "บิลรอตรวจสอบ" ช้าเพราะ getPendingBillReceipts() ไม่เคยมีแคชเลย
// (ต่างจากทุกหน้าอื่นในแอปหลักที่มีแคชกันหมดแล้ว) อ่านทั้งชีตใหม่ทุกครั้งที่เปิดหน้า — invalidate ทันทีใน
// submitBillForReview()/finalizePurchaseReceipt() (ทั้งคู่แก้ไขรายการ pending) กันเห็นข้อมูลค้าง
// billFolder: 1 ชม. — cache Drive folder ID ต่อซัพพลายเออร์ กัน findOrCreateFolder() ต้องไล่ getFoldersByName()
// 2 ชั้น (ปี→ซัพพลายเออร์) ซ้ำทุกครั้งที่ submitBillForReview ทั้งที่โฟลเดอร์แทบไม่เปลี่ยนเลย
const CACHE_TTL = { productAlias: 600, pendingBills: 30, billFolder: 3600 };
function cacheGet(key) {
  const raw = CACHE.get(key);
  return raw ? JSON.parse(raw) : null;
}
function cacheSet(key, data, ttlSec) {
  try { CACHE.put(key, JSON.stringify(data), ttlSec); } catch (e) {
    // ข้อมูลเกิน 100KB (limit ของ CacheService) — ข้ามการแคชแทนที่จะพัง
  }
}
function cacheClear(key) {
  CACHE.remove(key);
}

function doGet(e) {
  const action = e.parameter.action;
  Logger.log('[BillCapture doGet] ' + action); // เหมือน Code.gs หลัก — ไล่บั๊กจากชื่อ action ใน Executions log ได้ทันที
  let result;
  try {
    switch (action) {
      case 'pendingBills': result = getPendingBillReceipts(); break;
      default:             result = { error: 'unknown action: ' + action };
    }
  } catch (err) {
    Logger.log('BillCapture doGet [' + action + '] error: ' + err.stack);
    result = { error: '[' + action + '] ' + err.message };
  }
  return jsonOut(result);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  Logger.log('[BillCapture doPost] ' + body.action);
  let result;
  try {
    switch (body.action) {
      case 'analyzeBillPhoto':       result = analyzeBillPhoto(body);       break;
      case 'analyzeBillBatch':       result = analyzeBillBatch(body);       break;
      case 'submitBillForReview':    result = submitBillForReview(body);    break;
      case 'finalizePurchaseReceipt':result = finalizePurchaseReceipt(body);break;
      default:                       result = { error: 'unknown action: ' + body.action };
    }
  } catch (err) {
    Logger.log('BillCapture doPost [' + body.action + '] error: ' + err.stack);
    result = { error: '[' + body.action + '] ' + err.message };
  }
  return jsonOut(result);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ sheet helpers (คัดลอกมาจาก Code.gs หลัก — คนละโปรเจกต์เข้าถึงกันไม่ได้) ============ */
function readTable(name) {
  const sh = SHEET.getSheetByName(name);
  const rows = sh.getDataRange().getValues();
  const headers = rows[0];
  return rows.slice(1).filter(r => r.some(v => v !== '')).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}
function todayStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
function normDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v).trim();
}
function appendRowByHeaders(sheetName, valuesByHeader) {
  const sh = SHEET.getSheetByName(sheetName);
  const headers = sh.getDataRange().getValues()[0];
  const row = headers.map(h => valuesByHeader[h] !== undefined ? valuesByHeader[h] : '');
  sh.appendRow(row);
}

/* ============ รับของ — ถ่ายบิล: analyzeBillPhoto / savePurchaseReceipt ============ */
// เรียก Gemini (multimodal) อ่านรูปบิลที่ลูกจ้างถ่ายมา แล้วแยกเป็นรายการสินค้า — ไม่เขียนอะไรลงชีตเลย
// (pure read + เรียก API ภายนอก) จับคู่ล่วงหน้ากับ ProductAlias ที่เคยบันทึกไว้ให้ด้วยถ้าเจอ
// body = { supplierId, photos: [dataURL, ...] }
function analyzeBillPhoto(body) {
  if (!body.supplierId || !body.photos || !body.photos.length) {
    throw new Error('ข้อมูลไม่ครบ (supplierId หรือรูปบิลหายไป)');
  }
  const suppliers = readTable('Suppliers');
  const sup = suppliers.find(s => String(s.SupplierID).trim() === String(body.supplierId).trim());
  if (!sup) throw new Error('ไม่พบซัพพลายเออร์นี้: ' + body.supplierId);

  const hint = BILL_TEMPLATE_HINTS[body.supplierId] || '';
  const promptText = 'คุณกำลังอ่านใบส่งของ/ใบวางบิลจากซัพพลายเออร์ "' + sup.Name + '" (รหัส ' + body.supplierId + ') ที่ส่งให้ร้านขายไส้กรอกแห่งหนึ่ง\n' +
    (hint ? 'ข้อมูลอ้างอิงรูปแบบบิลของเจ้านี้: ' + hint + '\n' : '') +
    'ตอบกลับเป็น JSON object เดียวเท่านั้น รูปแบบ {"items": [...], "billHeader": {...} หรือ null, "supplierMismatchWarning": string หรือ null}\n' +
    '"items": อ่านทุกบรรทัดรายการที่เห็นในรูป (อ่านตามที่เขียน/พิมพ์ไว้จริง ไม่ต้องพยายามจับคู่ชื่อกับระบบอื่นใด) แต่ละสมาชิกในรูปแบบ ' +
    '{"billText": ชื่อรายการตามที่อ่านได้ (string), "qty": จำนวน (number), "unit": หน่วยที่เขียนไว้ ถ้าไม่มีให้ใส่ "หน่วย" (string), ' +
    '"unitPrice": ราคาต่อหน่วย (number), "totalPrice": จำนวนเงินรวมของบรรทัดนั้น (number), "likelyNonProduct": true ถ้าบรรทัดนั้นดูไม่ใช่สินค้า เช่น ค่าขนส่ง/ส่วนลด/ยอดรวม ไม่งั้นใส่ false}. ' +
    'ถ้าตัวเลขบางช่องอ่านไม่ออกให้เดาที่สมเหตุสมผลที่สุด อย่าข้ามรายการทิ้งไปเฉยๆ\n' +
    '"billHeader": ใส่เฉพาะเมื่อบิลนี้เป็นเอกสารของบริษัทที่จดทะเบียนจริง (มีเลขประจำตัวผู้เสียภาษี/Tax ID พิมพ์ไว้ หรือเลขที่เอกสารรันเป็นชุดแบบพิมพ์ ไม่ใช่เขียนมือ) ' +
    'รูปแบบ {"billDate": วันที่บนบิล เป็น string ตามที่เขียน (string), "billNumber": เลขที่เอกสาร/ใบกำกับภาษี (string), ' +
    '"subtotal": ยอดรวมก่อนภาษี (number), "vat": ยอดภาษีมูลค่าเพิ่ม (number, ใส่ 0 ถ้าบิลนี้ไม่มี VAT แต่ยังเป็นเอกสารบริษัท), "total": ยอดรวมสุทธิ (number)}. ' +
    'ถ้าบิลนี้เป็นใบส่งของ/ใบเก็บเงินเขียนมือที่ไม่มีข้อมูลพวกนี้จริงๆ ให้ใส่ billHeader เป็น null เฉยๆ อย่าเดาตัวเลขขึ้นมาเอง\n' +
    '"supplierMismatchWarning": เช็คว่ารูปนี้น่าจะเป็นบิลจากซัพพลายเออร์ "' + sup.Name + '" ตามที่ระบุไว้ข้างบนจริงไหม โดยเทียบกับข้อมูลอ้างอิงรูปแบบบิลที่ให้ไว้ (โลโก้/ชื่อบริษัท/ที่อยู่/รูปแบบเอกสาร) ' +
    'ถ้าเห็นชัดเจนว่าไม่ตรง (เช่น ชื่อบริษัท/โลโก้บนบิลเป็นคนละเจ้ากับที่ระบุไว้ชัดๆ) ให้ใส่คำอธิบายสั้นๆ ว่าทำไมถึงคิดว่าไม่ตรง (string) ' +
    'ถ้าดูตรงกันดี หรือไม่มีข้อมูลอ้างอิงให้เทียบ หรือไม่แน่ใจ (เช่นบิลเขียนมือไม่มีชื่อบริษัทให้เทียบเลย) ให้ใส่เป็น null เฉยๆ อย่าฟันธงมั่วถ้าไม่มีหลักฐานชัดเจนพอ';

  const parts = [{ text: promptText }];
  body.photos.forEach(dataUrl => {
    const base64 = String(dataUrl).split(',').pop();
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
  });

  const result = callGemini(parts);
  if (!result || !Array.isArray(result.items)) throw new Error('อ่านบิลไม่สำเร็จ ลองถ่ายรูปให้ชัดขึ้นอีกครั้ง');
  const items = result.items;
  const billHeader = sanitizeBillHeader(result.billHeader);
  // เตือนตอนเลือกซัพพลายเออร์ผิด (ไม่ตรงกับหัวบิลจริง) — เดิมไม่มีการเช็คนี้เลย เจอผู้ใช้ถามหลัง backlog
  // session ว่า "ถ้าเลือกเจ้าผิดจะรู้ไหม" คำตอบเดิมคือไม่รู้เลย (จับคู่สินค้าจะพังเงียบๆ เพราะดึงสินค้าผิดเจ้า
  // มาให้เลือก) — ใช้ string ว่างเป็น null เพื่อกัน AI ส่งค่าประหลาด (false/0/whitespace) มาปนแล้วโค้ด/
  // หน้าเว็บพัง เหมือน pattern ของ sanitizeBillHeader ด้านบน
  const supplierMismatchWarning = String(result.supplierMismatchWarning || '').trim() || null;

  const aliases = getProductAliasIndex(body.supplierId);
  const normalized = items.map(it => {
    const billText = String(it.billText || '').trim();
    const match = findAliasMatch(aliases, billText);
    return {
      billText, qty: Number(it.qty) || 0,
      unit: String(it.unit || 'หน่วย').trim(),
      unitPrice: Number(it.unitPrice) || 0,
      likelyNonProduct: !!it.likelyNonProduct,
      productId: match ? match.ProductID : null,
      conversionFactor: match ? (Number(match.ConversionFactor) || 1) : null,
      // 'exact': ข้อความตรงกับที่เคยยืนยันไว้เป๊ะๆ (หลัง normalize) จับคู่ให้ทันทีไม่ต้องถามซ้ำ
      // 'fuzzy': ใกล้เคียงแต่ไม่เป๊ะ (เทียบด้วย Levenshtein ในโค้ดเอง ไม่ใช่ให้ AI เดาแล้วเชื่อเลย) — ต้องให้
      // คนกดยืนยันเองก่อนเสมอ กันเคสจับคู่ผิดหลุดผ่านไปโดยไม่มีใครสังเกต (ดู renderBillReview ฝั่งเว็บ)
      matchType: match ? match.matchType : null,
      // ข้อความ alias เดิมที่ทำให้เกิด fuzzy match — ใช้โชว์ในหน้าเว็บว่า "เจอคำนี้ใกล้เคียงกับคำนี้ที่เคยยืนยันไว้"
      matchedAliasText: (match && match.matchType === 'fuzzy') ? match.BillText : null
    };
  });

  // เตือนบิลซ้ำ (7 ก.ย. 69 — ต่อ) — เจอ use case จริงว่าอาจสแกนบิลใบเดิมซ้ำโดยไม่ทันสังเกต โดยเฉพาะตอนไล่
  // backlog บิลเก่า 101 ใบ เป็นแค่คำเตือน (เหมือน supplierMismatchWarning) ไม่บล็อกการบันทึก ดู
  // checkDuplicateBill() ด้านล่างสำหรับรายละเอียดเกณฑ์ตัดสิน
  const duplicateBillWarning = checkDuplicateBill(body.supplierId, billHeader, normalized);

  return { items: normalized, billHeader, supplierMismatchWarning, duplicateBillWarning };
}

// ============ ตรวจจับบิลซ้ำ (7 ก.ย. 69 — ต่อ) ============
// เช็คว่าบิลที่เพิ่งอ่านได้นี้ตรงกับบิลที่เคยเข้าระบบแล้วของซัพพลายเออร์เดียวกันไหม (ทั้งที่ยังรอเจ้าของตรวจใน
// PendingBillReceipts และที่บันทึกจริงแล้วใน PurchaseReceipts) — ป้องกันสแกนบิลใบเดียวกันซ้ำ (เกิดขึ้นได้จริง
// ตอนไล่ backlog บิลเก่า 101 ใบ ถ้าหยิบบิลใบเดิมมาสแกนซ้ำโดยไม่ทันสังเกต)
// เกณฑ์: มีเลขที่บิล (billNumber) ตรงกัน -> ฟันธงซ้ำทันที (มั่นใจสูงสุด ใช้ได้กับบิลบริษัทจดทะเบียนเท่านั้น)
// ไม่มีเลขที่บิลให้เทียบ (บิลเขียนมือ ส่วนใหญ่ของซัพพลายเออร์รายวัน ไม่มี billHeader เลย) -> เทียบ "รายการ
// สินค้าทั้งหมด" (ชื่อ+จำนวน+ราคาต่อหน่วย) ว่าตรงกัน >=70% ของรายการไหม (ไม่บังคับ 100% เผื่อ AI อ่าน OCR
// ไม่เหมือนกันเป๊ะทุกครั้งที่สแกนบิลใบเดียวกันซ้ำ) เป็นแค่คำเตือน (ฝั่งเว็บยังกดบันทึกต่อได้เสมอ) ไม่บล็อก
// เพราะการเทียบรายการมีโอกาส false positive ได้ (สั่งของเซตเดียวกันซ้ำจริงในราคาเท่าเดิม) ตรวจย้อนหลัง
// ไม่จำกัดเวลา (ไม่กรองตามวันที่) เพราะบิลใน backlog อาจถูกสแกนซ้ำห่างกันเป็นเดือนได้ ไม่ใช่แค่วันเดียวกัน
// คืน { matchType:'billNumber'|'items', batchId, date, billNumber, photoUrl, status:'pending'|'finalized',
// overlapRatio } หรือ null ถ้าไม่เจอที่น่าจะซ้ำ
function checkDuplicateBill(supplierId, billHeader, items) {
  const newKeys = buildItemFingerprint(items);
  const newBillNumber = String((billHeader && billHeader.billNumber) || '').trim();
  const candidates = [];

  const pendingSh = SHEET.getSheetByName(PENDING_BILL_SHEET);
  if (pendingSh) {
    readTable(PENDING_BILL_SHEET).forEach(r => {
      if (String(r.SupplierID).trim() !== String(supplierId).trim()) return;
      let its = [];
      try { its = JSON.parse(r.ItemsJSON || '[]'); } catch (e) { /* แถวข้อมูลเสีย ข้ามไป ไม่ทำให้ทั้งฟังก์ชันพัง */ }
      candidates.push({
        batchId: r.BatchID, date: normDate(r.Date), billNumber: String(r.BillNumber || '').trim(),
        photoUrl: toEmbeddableDriveUrl(r.PhotoURL), status: 'pending', keys: buildItemFingerprint(its)
      });
    });
  }

  // จัดกลุ่มแถว PurchaseReceipts (denormalized ทีละแถวต่อสินค้า) กลับเป็นทีละบิลตาม BatchID ก่อนสร้าง
  // fingerprint เพราะการเทียบ "รายการซ้ำ" ต้องเทียบทั้งบิล ไม่ใช่ทีละแถว
  const purchaseByBatch = {};
  readTable(PURCHASE_RECEIPTS_SHEET)
    .filter(r => String(r.SupplierID).trim() === String(supplierId).trim())
    .forEach(r => {
      if (!purchaseByBatch[r.BatchID]) {
        purchaseByBatch[r.BatchID] = {
          batchId: r.BatchID, date: normDate(r.Date), billNumber: String(r.BillNumber || '').trim(),
          photoUrl: toEmbeddableDriveUrl(r.PhotoURL), status: 'finalized', items: []
        };
      }
      purchaseByBatch[r.BatchID].items.push({ billText: r.BillText, qty: r.BillQty, unitPrice: r.UnitPrice });
    });
  Object.values(purchaseByBatch).forEach(b => candidates.push(Object.assign(b, { keys: buildItemFingerprint(b.items) })));

  let best = null;
  for (const c of candidates) {
    if (newBillNumber && c.billNumber && newBillNumber === c.billNumber) {
      best = { batchId: c.batchId, date: c.date, billNumber: c.billNumber, photoUrl: c.photoUrl, status: c.status, matchType: 'billNumber', overlapRatio: 1 };
      break; // เลขที่บิลตรงกันคือมั่นใจสูงสุดแล้ว ไม่ต้องหาต่อ
    }
    const ratio = itemOverlapRatio(newKeys, c.keys);
    if (ratio >= 0.7 && (!best || ratio > best.overlapRatio)) {
      best = { batchId: c.batchId, date: c.date, billNumber: c.billNumber, photoUrl: c.photoUrl, status: c.status, matchType: 'items', overlapRatio: ratio };
    }
  }
  return best;
}

// แปลงรายการสินค้าของบิล (จาก analyzeBillPhoto หรือ ItemsJSON/แถว PurchaseReceipts ที่บันทึกไว้แล้ว) ให้เป็น
// array ของ key เทียบกันได้ตรงๆ — normalize ชื่อด้วย normalizeAliasKey เดียวกับที่ใช้จับคู่ ProductAlias
// (กัน AI อ่านช่องว่าง/ตัวพิมพ์ใหญ่เล็กมาไม่เป๊ะเท่าครั้งก่อนแล้วทำให้ไม่ match ทั้งที่ควรจะซ้ำ)
function buildItemFingerprint(items) {
  return (items || []).map(it => {
    const qty = Number(it.qty != null ? it.qty : it.billQty) || 0;
    const price = Number(it.unitPrice) || 0;
    return normalizeAliasKey(it.billText) + '|' + qty + '|' + price;
  });
}
// สัดส่วนรายการที่ตรงกันระหว่างบิล 2 ใบ (ไม่สนลำดับ) — หารด้วยจำนวนรายการที่มากกว่า กันบิลที่มีรายการน้อยกว่า
// มาก (เช่น บิลแก้ไข/บิลบางส่วน) ได้คะแนนสูงเกินจริงถ้าไปหารด้วยจำนวนรายการที่น้อยกว่าแทน
function itemOverlapRatio(keysA, keysB) {
  if (!keysA.length || !keysB.length) return 0;
  const setB = new Set(keysB);
  const matched = keysA.filter(k => setB.has(k)).length;
  return matched / Math.max(keysA.length, keysB.length);
}

// ============ โหมดใหม่: อัปโหลดรูปหลายบิลพร้อมกัน ให้ AI แยกขอบเขตเอกสารเอง (7 ก.ย. 69) ============
// จงใจแยก action ต่างหากจาก analyzeBillPhoto ข้างบน — ไม่แก้ analyzeBillPhoto แม้แต่บรรทัดเดียว กันไม่ให้
// ฟีเจอร์ใหม่ที่ยังไม่ผ่านการใช้งานจริงกระทบเส้นทางที่พนักงานถ่ายบิลปกติทุกวันอยู่แล้ว (ดูสรุปเหตุผลใน
// CLAUDE.md หัวข้อ "แยกบิลอัตโนมัติ") ใช้ตอนซัพพลายเออร์เอาบิลตกหล่นจากรอบก่อนมาพร้อมบิลวันนี้
// สำคัญ: ฟังก์ชันนี้แค่ "เสนอ" การแบ่งกลุ่ม ไม่เขียนอะไรลงชีตเลยเหมือน analyzeBillPhoto — ฝั่งเว็บ
// (renderBillBatchReview) ต้องให้คนตรวจ/แก้กลุ่มก่อนเสมอ แล้วค่อยเรียก submitBillForReview ทีละบิลปกติ
// ทุกประการ ไม่มี action ใหม่ไหนเขียน PurchaseReceipts/PendingBillReceipts ตรงๆ จากฟังก์ชันนี้เลย
//
// อัปเดต 7 ก.ย. 69: เดิมฟังก์ชันนี้ให้ Gemini ทั้งแยกกลุ่ม + อ่านรายการสินค้าทุกบิลพร้อมกันในคำขอเดียว
// พบจริงจาก Executions log ว่าคำขอแบบนั้นกินเวลาถึง ~104 วิ (เทียบกับ analyzeBillPhoto บิลเดี่ยวที่ 45-49 วิ
// ผ่านทุกครั้ง) ทำให้หน้าเว็บเจอ "Load failed" ซ้ำๆ ทุกรอบที่ทดสอบจริง (การเชื่อมต่อทนคำขอยาวขนาดนั้นไม่ไหว)
// แก้โดยตัดขอบเขตงานของฟังก์ชันนี้ให้เหลือแค่ "แยกกลุ่มรูป" อย่างเดียว (เร็วขึ้นมากเพราะไม่ต้องถอดรายการ
// สินค้าทีละบรรทัดในทุกรูป) แล้วให้ฝั่งเว็บเรียก analyzeBillPhoto ตัวเดิม (ที่พิสูจน์แล้วว่าไหว) แยกทีละบิล
// เป็นคำขอสั้นๆ หลายครั้งแทน ดู renderBillBatchAnalyzing ในฝั่งเว็บ
function analyzeBillBatch(body) {
  if (!body.supplierId || !body.photos || body.photos.length < 2) {
    throw new Error('ข้อมูลไม่ครบ (supplierId หรือรูปน้อยกว่า 2 รูป — โหมดแยกหลายบิลใช้เมื่อมีตั้งแต่ 2 รูปขึ้นไปเท่านั้น)');
  }
  const suppliers = readTable('Suppliers');
  const sup = suppliers.find(s => String(s.SupplierID).trim() === String(body.supplierId).trim());
  if (!sup) throw new Error('ไม่พบซัพพลายเออร์นี้: ' + body.supplierId);

  const hint = BILL_TEMPLATE_HINTS[body.supplierId] || '';
  const n = body.photos.length;
  const promptText = 'คุณกำลังดูรูปทั้งหมด ' + n + ' รูป (เรียงตามลำดับ index 0 ถึง ' + (n - 1) + ' ตามลำดับที่ให้มา) ที่ถ่ายจากใบส่งของ/ใบวางบิลของซัพพลายเออร์ "' + sup.Name + '" (รหัส ' + body.supplierId + ') ที่ส่งให้ร้านขายไส้กรอกแห่งหนึ่ง\n' +
    (hint ? 'ข้อมูลอ้างอิงรูปแบบบิลของเจ้านี้: ' + hint + '\n' : '') +
    'รูปเหล่านี้อาจเป็น "เอกสารคนละใบ" ปนกันมา (เช่น ซัพพลายเออร์เอาบิลตกหล่นจากวันก่อนมาพร้อมบิลวันนี้) ' +
    'หรือบางรูปอาจเป็นแค่หน้าต่อของเอกสารเดียวกัน (บิลใบเดียวถ่ายหลายรูปเพราะรายการเยอะ) ' +
    'งานของคุณคือแค่แยกกลุ่มรูปตามเอกสารจริงเท่านั้น — **ห้ามอ่าน/ถอดรายการสินค้าในรูปเลย** (มีขั้นตอนแยกอ่านรายการทีหลัง) ' +
    'ดูจากเลขที่เอกสาร/วันที่/ยอดรวม/รูปแบบหัวกระดาษที่ปรากฏบนแต่ละรูปเพื่อตัดสินใจแยกกลุ่มพอ ' +
    '(รูปที่เป็นหน้าต่อกันของบิลเดียวกันมักไม่มีหัวบิล/เลขที่ซ้ำในหน้าถัดไป ส่วนบิลคนละใบมักมีเลขที่/วันที่ต่างกันชัดเจน) ' +
    'ถ้าไม่แน่ใจว่าควรแยกหรือรวม ให้เอนเอียงไปทาง "แยกเป็นคนละเอกสาร" ไว้ก่อนเสมอ เพราะฝั่งเว็บจะให้คนตรวจแก้ไขการแบ่งกลุ่มได้อยู่แล้ว\n' +
    'ตอบกลับเป็น JSON object เดียวเท่านั้น รูปแบบ {"groups": [ {"photoIndices": [...]}, {...} ] } — แต่ละสมาชิกใน "groups" คือเอกสาร 1 ใบ ' +
    '"photoIndices" คือ array ของเลข index (0-based ตรงกับลำดับรูปที่ให้มา) ของรูปทั้งหมดที่เป็นของเอกสารใบนี้ (number[]) — ทุกรูปต้องถูกจัดอยู่ในกลุ่มใดกลุ่มหนึ่งเสมอ ห้ามตกหล่นรูปไหนไป';

  const parts = [{ text: promptText }];
  body.photos.forEach(dataUrl => {
    const base64 = String(dataUrl).split(',').pop();
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
  });

  const result = callGemini(parts);
  if (!result || !Array.isArray(result.groups) || !result.groups.length) throw new Error('แยกกลุ่มบิลไม่สำเร็จ ลองถ่ายรูปให้ชัดขึ้นอีกครั้ง');

  const groups = result.groups.map(g => ({
    photoIndices: Array.isArray(g.photoIndices)
      ? g.photoIndices.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < n)
      : []
  }));

  // กันรูปซ้ำ (Gemini อาจใส่ index เดียวกันไว้ในสองกลุ่มพร้อมกันโดยไม่ได้ตั้งใจ) — ให้กลุ่มแรกที่อ้างถึง
  // รูปนั้นเป็นเจ้าของไปเลย ตัดออกจากกลุ่มถัดๆ ไป กันรูปเดียวกันถูกอ่าน/ส่งซ้ำสองบิลทีหลัง
  const covered = {};
  groups.forEach(g => {
    g.photoIndices = g.photoIndices.filter(i => {
      if (covered[i]) return false;
      covered[i] = true;
      return true;
    });
  });

  // กันรูปตกหล่น (Gemini อาจลืมใส่ index บางรูปไว้ในกลุ่มไหนเลย ทั้งที่บอกไว้ในพรอมต์ว่าห้าม) — โยนรูปที่
  // ไม่มีกลุ่มไปรวมเป็นเอกสารเดี่ยวท้ายสุดแทนที่จะปล่อยหายไปเงียบๆ ให้คนตรวจที่หน้ารีวิวเห็น/จัดการเอง
  const missing = [];
  for (let i = 0; i < n; i++) if (!covered[i]) missing.push(i);
  if (missing.length) groups.push({ photoIndices: missing });

  return { groups };
}

// ทำความสะอาดผลลัพธ์ billHeader จาก Gemini ให้เป็น null หรือ object ที่มี field ครบเสมอ — กัน AI ส่งค่า
// ประหลาด (string ว่าง, field ขาดหาย, ตัวเลขเป็น string ฯลฯ) มาปนแล้วโค้ดฝั่งเว็บ/การเขียนชีตพัง
// คืน null ถ้าไม่มีข้อมูลอะไรเลย (บิลเขียนมือ) — renderBillReview ฝั่งเว็บจะไม่โชว์การ์ดหัวบิลเลยในกรณีนั้น
function sanitizeBillHeader(h) {
  if (!h || typeof h !== 'object') return null;
  const billDate = String(h.billDate || '').trim();
  const billNumber = String(h.billNumber || '').trim();
  const subtotal = Number(h.subtotal) || 0;
  const vat = Number(h.vat) || 0;
  const total = Number(h.total) || 0;
  if (!billDate && !billNumber && !subtotal && !vat && !total) return null;
  return { billDate, billNumber, subtotal, vat, total };
}

// พยายามแปลง billHeader.billDate (string อิสระที่ AI อ่านมาจากบิล เช่น "26/06/2569") ให้เป็น yyyy-MM-dd
// แบบเดียวกับ todayStr() — รองรับทั้งปี พ.ศ. (ลบ 543 ถ้าปี > 2400) และปี ค.ศ. ตรงๆ, ตัวคั่น / - .
// คืน null ถ้า parse ไม่ได้ (เช่น บิลเขียนมือไม่มี billHeader เลย หรือ AI อ่านรูปแบบวันที่แปลกไป) —
// ผู้เรียก (finalizePurchaseReceipt) ต้อง fallback ไป todayStr() เอง กันแถวไม่มีวันที่เลย
function parseBillDateToSheetFormat(raw) {
  const m = String(raw || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return null;
  let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y > 2400) y -= 543; // พ.ศ. -> ค.ศ.
  if (y < 1900 || y > 2200) return null; // กันปีเพี้ยนหลุดผ่านมา
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Levenshtein distance ธรรมดา (dynamic programming) — ใช้หาความคล้ายของข้อความบิลแบบ deterministic
// ไม่ใช่ให้ AI ตัดสินเองว่า "คล้ายกันไหม" เพราะอยากให้ตรวจสอบ/อธิบายได้ว่าทำไมถึงจับคู่ให้
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) dp[i] = [i];
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}
function textSimilarity(a, b) {
  const d = levenshtein(a, b);
  const len = Math.max(a.length, b.length) || 1;
  return 1 - d / len;
}
// ปรับได้ทีหลังถ้าเจอ false positive (จับคู่มั่วเกินไป) หรือ false negative (ควรจับคู่ได้แต่ไม่จับ) จากการใช้งานจริง
const FUZZY_MATCH_THRESHOLD = 0.75;

// หา alias ที่ตรง/ใกล้เคียงที่สุดของซัพพลายเออร์นี้ (aliases ต้อง filter เฉพาะ supplier นี้มาก่อนแล้ว)
// คืน {..alias, matchType:'exact'|'fuzzy'} หรือ null ถ้าไม่เจออะไรใกล้เคียงพอ
function findAliasMatch(aliases, billText) {
  const key = normalizeAliasKey(billText);
  const exact = aliases.find(a => normalizeAliasKey(a.BillText) === key);
  if (exact) return Object.assign({}, exact, { matchType: 'exact' });
  let best = null, bestScore = 0;
  aliases.forEach(a => {
    const score = textSimilarity(key, normalizeAliasKey(a.BillText));
    if (score > bestScore) { bestScore = score; best = a; }
  });
  if (best && bestScore >= FUZZY_MATCH_THRESHOLD) return Object.assign({}, best, { matchType: 'fuzzy' });
  return null;
}

// เรียก Gemini API (generateContent) แบบ multimodal — บังคับให้ตอบเป็น JSON ล้วนๆ ผ่าน responseMimeType
// กันปัญหาโมเดลตอบเป็นข้อความอธิบายปนโค้ด/markdown fence ที่ parse ต่อไม่ได้
// ลองเรียก Gemini ครั้งเดียว — แยกออกมาจาก callGemini() เพื่อให้ retry wrapper เรียกซ้ำได้สะอาดๆ
function callGeminiOnce(url, payload) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  let json;
  try { json = JSON.parse(res.getContentText()); } catch (e) { throw new Error('Gemini ตอบกลับมาไม่ใช่ JSON ที่ใช้ได้'); }
  if (code !== 200) throw new Error('Gemini API error (' + code + '): ' + (json.error && json.error.message || res.getContentText()));
  const text = json.candidates && json.candidates[0] && json.candidates[0].content &&
    json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini ไม่ส่งผลลัพธ์ที่ใช้ได้กลับมา');
  return JSON.parse(text);
}
// เจอจริงคืนวันที่ 6 ก.ย. 69 ว่า Gemini คืน 503 "high demand" เป็นระยะ (ข้อความเองบอกว่า "usually
// temporary") และบางรอบคืน 200 แต่ไม่มีข้อความ/items ให้ parse เลย (น่าจะอาการเดียวกันจากโหลดสูง
// แค่ไม่ error ชัดเจน) — ลองซ้ำอัตโนมัติ 1 ครั้งหลังรอ 3 วิ ก่อนค่อยโยน error จริงให้ผู้ใช้เห็น ทำใน
// ฝั่ง backend (ไม่ใช่ client auto-retry) เพราะเป็นแค่การอ่าน ยังไม่เขียนอะไรลงชีตเลยตอนนี้ ปลอดภัย
// ไม่ทำให้ข้อมูลซ้ำซ้อนแบบ action ที่สร้างแถวใหม่ — analyzeBillPhoto ฝั่งเว็บต้องขยาย timeout ตามด้วย
// (ดู 150000 → 270000 ใน stock-check.html) กันกรณีแย่สุดที่ทั้ง 2 รอบใช้เวลานานพอกัน
function callGemini(parts) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Script Properties (Project Settings)');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
  const payload = {
    contents: [{ parts }],
    generationConfig: { responseMimeType: 'application/json' }
  };
  try {
    return callGeminiOnce(url, payload);
  } catch (firstErr) {
    Utilities.sleep(3000);
    try {
      return callGeminiOnce(url, payload);
    } catch (secondErr) {
      throw secondErr; // โยน error ของรอบสอง (มักมีข้อมูลใหม่กว่า/ตรงกว่ารอบแรก)
    }
  }
}

// normalize ชื่อบิลก่อนเทียบ/ใช้เป็น key จับคู่ ProductAlias — ตัดช่องว่างหัวท้าย + รวมช่องว่างซ้ำ + ตัวพิมพ์เล็ก
// ทั้งหมด กัน alias เดิมไม่ auto-match แค่เพราะ AI อ่านช่องว่าง/ตัวพิมพ์ใหญ่เล็กมาไม่เป๊ะเท่าครั้งก่อน
function normalizeAliasKey(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ============ ลูกจ้างส่งบิลให้เจ้าของตรวจ (ไม่เขียน PurchaseReceipts เลย — แค่คิวรอตรวจ) ============
// สร้างแถวใหม่ + อัปโหลดรูปทุกครั้งที่เรียก (ไม่ idempotent ห้ามใส่ retryOnTimeout ฝั่งเว็บเด็ดขาด)
// body = { supplierId, staffName, photos:[dataURL,...], items:[{billText, unit, qty, receivedQty,
//          unitPrice, likelyNonProduct, skip, productId, factor, fromAlias}] } — เก็บทุกรายการรวมที่ข้ามไว้
// ด้วย (ต่างจาก finalizePurchaseReceipt) เพราะเจ้าของต้องเห็นครบทุกรายการตอนตรวจ ไม่ใช่แค่ที่ลูกจ้างเลือกเก็บ
function submitBillForReview(body) {
  if (!body.supplierId || !body.staffName || !body.items || !body.items.length) {
    throw new Error('ข้อมูลไม่ครบ (supplierId, staffName หรือรายการสินค้าหายไป)');
  }
  const suppliers = readTable('Suppliers');
  const sup = suppliers.find(s => String(s.SupplierID).trim() === String(body.supplierId).trim());
  if (!sup) throw new Error('ไม่พบซัพพลายเออร์นี้: ' + body.supplierId);

  const sh = SHEET.getSheetByName(PENDING_BILL_SHEET);
  if (!sh) throw new Error('ไม่พบชีต ' + PENDING_BILL_SHEET + ' — สร้างชีตนี้ก่อน (คอลัมน์: BatchID, Date, SupplierID, StaffName, PhotoURL, ItemsJSON, BillDate, BillNumber, BillSubtotal, BillVat, BillTotal, Timestamp)');

  // เดิม timestamp ละเอียดแค่ระดับวินาที (MMdd-HHmmss) — เพียงพอตอนออกแบบครั้งแรกเพราะแต่ละครั้งที่เรียก
  // มาจากคนถ่ายบิลทีละใบ ห่างกันหลายวินาทีเสมอ แต่โหมด "หลายบิลรวมกัน" (renderBillBatchReview) เรียกฟังก์ชัน
  // นี้วนหลายรอบติดกันเร็วๆ ให้ซัพพลายเออร์เดียวกัน เสี่ยง BatchID ชนกันถ้าสอง request จบภายในวินาทีเดียวกัน
  // (ทำให้ finalizePurchaseReceipt จับคู่แถว PendingBillReceipts ผิดใบ + อีกใบค้างอยู่ในคิวตลอดไป) เพิ่ม
  // มิลลิวินาที (SSS) ให้ละเอียดพอจะไม่ชนกันจริงในทางปฏิบัติ — BatchID ยังเป็นแค่ string key เทียบตรงๆ
  // เหมือนเดิมทุกที่ที่ใช้ (PendingBillReceipts/PurchaseReceipts/ชื่อไฟล์รูป) ไม่มีที่ไหน parse รูปแบบนี้อยู่
  const batchId = 'RB' + Utilities.formatDate(new Date(), TZ, 'MMdd-HHmmss-SSS');
  const photoUrl = (body.photos && body.photos.length) ? saveBillPhotosOrganized(body.photos, batchId, body.supplierId, sup.Name) : '';
  // หัวบิล (วันที่/เลขที่บิล/ยอดรวม/VAT) — มีเฉพาะบิลบริษัทจดทะเบียนที่ Gemini อ่านได้ (ดู analyzeBillPhoto)
  // เขียนเป็นค่าว่างไปเลยถ้าไม่มี ไม่ต้องเก็บ null/undefined ลงชีต
  const bh = body.billHeader || {};

  appendRowByHeaders(PENDING_BILL_SHEET, {
    BatchID: batchId, Date: todayStr(), SupplierID: body.supplierId, StaffName: body.staffName,
    PhotoURL: photoUrl, ItemsJSON: JSON.stringify(body.items),
    BillDate: bh.billDate || '', BillNumber: bh.billNumber || '', BillSubtotal: bh.subtotal || '',
    BillVat: bh.vat || '', BillTotal: bh.total || '', Timestamp: new Date().toISOString()
  });

  cacheClear('pendingBills'); // เพิ่งเพิ่มบิลใหม่ในคิว — กันหน้า "บิลรอตรวจสอบ" เห็นข้อมูลค้างจากแคชเก่า
  return { ok: true, batchId };
}

// สร้าง billHeader object จากแถวชีต (PendingBillReceipts หรือ PurchaseReceipts) — คืน null ถ้าไม่มีข้อมูล
// อะไรเลย (บิลเขียนมือ) ใช้ normDate() กับ BillDate เผื่อ Sheets auto-convert เป็น Date object ไปเงียบๆ
// เหมือนที่เคยเจอบั๊กนี้กับคอลัมน์วันที่อื่นในไฟล์นี้ (ดู normalizeSkipDatesCell/isActiveFlag)
function buildBillHeaderFromRow(r) {
  const billDate = normDate(r.BillDate);
  const billNumber = String(r.BillNumber || '').trim();
  const subtotal = Number(r.BillSubtotal) || 0;
  const vat = Number(r.BillVat) || 0;
  const total = Number(r.BillTotal) || 0;
  if (!billDate && !billNumber && !subtotal && !vat && !total) return null;
  return { billDate, billNumber, subtotal, vat, total };
}

// รายการบิลที่ยังรอเจ้าของตรวจ — ใช้กับหน้า "บิลรอตรวจสอบ" ฝั่งเจ้าของ
// แปลงลิงก์ Drive แบบเก่า (https://drive.google.com/file/d/ID/view... — หน้า "ดูไฟล์" ของ Drive ใช้เป็น
// <img src> ไม่ได้) ให้เป็นลิงก์ thumbnail ที่ embed เป็นรูปได้จริงเสมอ (ดูเหตุผลเต็มๆ ที่คอมเมนต์
// saveBillPhotosOrganized) — ทำตอนอ่านแทนที่จะไปแก้ข้อมูลเก่าในชีตตรงๆ (self-healing pattern เดียวกับ
// normalizeSkipDatesCell) กันบิลที่ submitBillForReview ไปแล้วก่อนแก้บั๊กนี้ยังโชว์รูปไม่ขึ้นค้างอยู่
// รับได้ทั้ง URL เดียวหรือหลายอันคั่นด้วย , (รูปแบบเดียวกับที่ saveBillPhotosOrganized คืนมา)
function toEmbeddableDriveUrl(urlStr) {
  return String(urlStr || '').split(',').map(u => {
    u = u.trim();
    const m = u.match(/drive\.google\.com\/file\/d\/([^/]+)\//);
    return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w2000' : u;
  }).filter(Boolean).join(',');
}

function getPendingBillReceipts() {
  const cached = cacheGet('pendingBills');
  if (cached) return cached;

  const sh = SHEET.getSheetByName(PENDING_BILL_SHEET);
  if (!sh) return { batches: [] };
  const result = {
    batches: readTable(PENDING_BILL_SHEET).map(r => ({
      batchId: r.BatchID, date: normDate(r.Date), supplierId: r.SupplierID, staffName: r.StaffName,
      photoUrl: toEmbeddableDriveUrl(r.PhotoURL), items: JSON.parse(r.ItemsJSON || '[]'), billHeader: buildBillHeaderFromRow(r)
    }))
  };
  cacheSet('pendingBills', result, CACHE_TTL.pendingBills);
  return result;
}

// ============ เจ้าของตรวจ+กดบันทึกจริง — จุดเดียวในระบบที่เขียนลง PurchaseReceipts ============
// ไม่ idempotent (สร้างแถวใหม่ทุกครั้ง) ห้ามใส่ retryOnTimeout ฝั่งเว็บ — รูปถูกอัปโหลดไปแล้วตอน
// submitBillForReview ไม่ต้องอัปโหลดซ้ำ แค่ลบแถวออกจาก PENDING_BILL_SHEET หลังบันทึกจริงสำเร็จ
// body = { batchId, supplierId, staffName, items:[{productId, billText, billQty, billUnit, receivedQty,
//          conversionFactor, unitPrice, saveAlias}] } — ไม่รวมรายการที่ข้าม (ไม่ใช่สินค้า) แล้ว
function finalizePurchaseReceipt(body) {
  if (!body.batchId || !body.supplierId || !body.staffName || !body.items || !body.items.length) {
    throw new Error('ข้อมูลไม่ครบ (batchId, supplierId, staffName หรือรายการสินค้าหายไป)');
  }
  const sh = SHEET.getSheetByName(PURCHASE_RECEIPTS_SHEET);
  if (!sh) throw new Error('ไม่พบชีต ' + PURCHASE_RECEIPTS_SHEET + ' — สร้างชีตนี้ก่อน (คอลัมน์: ReceiptID, BatchID, Date, SupplierID, ProductID, BillText, BillQty, ReceivedQty, BillUnit, ConversionFactor, ConvertedQty, UnitPrice, TotalPrice, PhotoURL, StaffName, BillDate, BillNumber, BillSubtotal, BillVat, BillTotal, Timestamp)');
  // อ่านหัวคอลัมน์จริงจากชีต ไม่ hardcode ลำดับ — กันกรณีผู้ใช้สร้างชีตเรียงคอลัมน์ไม่ตรงที่แนะนำเป๊ะๆ
  // (เหมือน appendRowByHeaders() ต่างกันตรงที่นี่ต้องเขียนหลายแถวพร้อมกันด้วย setValues() เพื่อความเร็ว
  // เลย map เองแทนที่จะเรียก appendRowByHeaders() วนทีละแถว)
  const headers = sh.getDataRange().getValues()[0];

  // หา PhotoURL เดิมจากแถว pending (รูปอัปโหลดไปแล้วตอน submit ไม่ต้องอัปใหม่)
  const pendingSh = SHEET.getSheetByName(PENDING_BILL_SHEET);
  let photoUrl = '';
  let pendingRowIdx = -1;
  if (pendingSh) {
    const pData = pendingSh.getDataRange().getValues();
    const pHeaders = pData[0];
    const batchCol = pHeaders.indexOf('BatchID'), photoCol = pHeaders.indexOf('PhotoURL');
    for (let i = 1; i < pData.length; i++) {
      if (String(pData[i][batchCol]).trim() === String(body.batchId).trim()) { pendingRowIdx = i; photoUrl = pData[i][photoCol]; break; }
    }
  }

  const ts = new Date().toISOString();
  const stamp = Utilities.formatDate(new Date(), TZ, 'MMdd-HHmmss');
  // หัวบิล (วันที่/เลขที่บิล/ยอดรวม/VAT) — เจ้าของอาจแก้ไขมาจากที่ AI อ่านได้ตอน analyzeBillPhoto แล้ว
  // เขียนซ้ำลงทุกแถวของ batch นี้ (denormalized ตั้งใจ) เพื่อให้แต่ละแถว PurchaseReceipts มีบริบทครบในตัว
  // เอง พร้อมต่อยอดทำรายงานต้นทุน/บัญชีในอนาคตโดยไม่ต้อง join กลับไปหา PendingBillReceipts ที่ถูกลบไปแล้ว
  const billHeader = body.billHeader || {};
  // Date = วันที่บนบิลจริง (BillDate) ถ้า AI อ่านออกมาเป็นรูปแบบที่ parse ได้ — ใช้วันนี้แค่ตอน parse ไม่ได้
  // (บิลเขียนมือไม่มี billHeader เลย, หรือ AI อ่านวันที่มาเป็นข้อความแปลกๆ) เดิม hardcode เป็นวันนี้เสมอ
  // ทำให้บิลเก่าที่เพิ่งมาลง (backlog) ไปกองอยู่ที่ "วันนี้" ทั้งหมด รายงานยอดซื้อรายวัน/เดือนพังได้
  const date = parseBillDateToSheetFormat(billHeader.billDate) || todayStr();
  const newRows = body.items.map((item, i) => {
    const factor = Number(item.conversionFactor) || 1;
    const receivedQty = Number(item.receivedQty != null ? item.receivedQty : item.billQty);
    const obj = {
      ReceiptID: 'PR' + stamp + '-' + (i + 1), BatchID: body.batchId, Date: date, SupplierID: body.supplierId,
      ProductID: item.productId, BillText: item.billText, BillQty: item.billQty, ReceivedQty: receivedQty,
      BillUnit: item.billUnit, ConversionFactor: factor, ConvertedQty: receivedQty * factor,
      UnitPrice: item.unitPrice, TotalPrice: Number(item.billQty) * Number(item.unitPrice),
      PhotoURL: photoUrl, StaffName: body.staffName,
      BillDate: billHeader.billDate || '', BillNumber: billHeader.billNumber || '',
      BillSubtotal: billHeader.subtotal || '', BillVat: billHeader.vat || '', BillTotal: billHeader.total || '',
      Timestamp: ts
    };
    return headers.map(h => obj[h] !== undefined ? obj[h] : '');
  });
  sh.getRange(sh.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);

  const toLearn = body.items.filter(it => it.saveAlias && it.productId);
  const learnedCount = toLearn.length ? batchUpsertProductAlias(body.supplierId, toLearn, body.staffName, ts) : 0;

  if (pendingRowIdx !== -1) pendingSh.deleteRow(pendingRowIdx + 1);

  cacheClear('pendingBills'); // บิลนี้ออกจากคิวรอตรวจแล้ว — กันเห็นแถวที่บันทึกจริงแล้วค้างอยู่ในหน้ารอตรวจ
  return { ok: true, learnedCount };
}

// หาโฟลเดอร์ลูกชื่อ name ใต้ parent ถ้ายังไม่มีให้สร้างใหม่ — ใช้ทำโครงสร้าง [ปี พ.ศ.]/[ซัพพลายเออร์]
function findOrCreateFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
// จัดเก็บรูปบิลเป็น BILL_PHOTOS_FOLDER_ID/[ปี พ.ศ. เช่น 2569]/[รหัส+ชื่อซัพพลายเออร์]/ — เลือกจัดกลุ่มตาม
// ซัพพลายเออร์ (ไม่ใช่ตามวัน) เพราะการใช้งานจริงของฟีเจอร์นี้คือ "เปิดดูประวัติ/ราคาของเจ้านี้ย้อนหลัง"
// เป็นหลัก ไม่ใช่ "ดูของที่เข้าร้านวันนี้ทั้งหมด" (มีหน้าเช็คสต๊อกทำหน้าที่นั้นอยู่แล้ว) — ชื่อไฟล์ขึ้นต้นด้วย
// วันที่เสมอ พอ Drive เรียงชื่อไฟล์ (ค่า default) ก็ได้ลำดับตามวันที่อัตโนมัติในตัว ไม่ต้องมีโฟลเดอร์ย่อยระดับวันอีกชั้น
function getBillPhotoFolderForSupplier(supplierId, supplierName) {
  // แคช Drive folder ID ไว้ต่อซัพพลายเออร์ — เดิมไล่ getFoldersByName() 2 ชั้น (ปี→ซัพพลายเออร์) ทุกครั้งที่
  // ถ่ายบิล ทั้งที่โฟลเดอร์แทบไม่เปลี่ยนเลยหลังสร้างครั้งแรก (เจอ 10 ก.ย. 69 ว่าขั้นตอน submitBillForReview
  // ช้ากว่าที่ควร) ถ้า cache เพี้ยน/โฟลเดอร์ถูกลบไปแล้ว fallback ไปหา/สร้างใหม่ตามปกติ ไม่พัง
  const cacheKey = 'billFolderId_' + supplierId;
  const cachedId = cacheGet(cacheKey);
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (e) { /* โฟลเดอร์หาย/ถูกลบ — หาใหม่ด้านล่าง */ }
  }
  const root = DriveApp.getFolderById(BILL_PHOTOS_FOLDER_ID);
  const beYear = Number(Utilities.formatDate(new Date(), TZ, 'yyyy')) + 543;
  const yearFolder = findOrCreateFolder(root, String(beYear));
  const supplierFolder = findOrCreateFolder(yearFolder, supplierId + ' ' + supplierName);
  cacheSet(cacheKey, supplierFolder.getId(), CACHE_TTL.billFolder);
  return supplierFolder;
}
function saveBillPhotosOrganized(photos, batchId, supplierId, supplierName) {
  const folder = getBillPhotoFolderForSupplier(supplierId, supplierName);
  const datePrefix = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const urls = photos.map((dataUrl, i) => {
    const base64 = String(dataUrl).split(',').pop();
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', datePrefix + '_' + batchId + '-' + (i + 1) + '.jpg');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // เจอบั๊กจริง 7 ก.ย. 69: file.getUrl() คืนลิงก์หน้า "ดูไฟล์" ของ Drive (https://drive.google.com/
    // file/d/ID/view) ซึ่งเป็นหน้า HTML ไม่ใช่ไฟล์รูปตรงๆ — ใช้เป็น <img src="..."> ไม่ได้เลย รูปเลย
    // ไม่ขึ้น (เจอฝั่งเจ้าของเปิดบิลค้างจาก PendingBillReceipts มาดู เพราะฝั่งพนักงานถ่ายบิลใหม่ใช้
    // base64 data URL ตรงๆ ไม่เคยพึ่งค่านี้เลยจนถึงตอนนี้ ไม่มีใครเจอบั๊กนี้มาก่อน) เปลี่ยนเป็น endpoint
    // thumbnail ของ Drive ที่ตั้งใจให้ embed เป็นรูปได้ตรงๆ แทน
    return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w2000';
  });
  return urls.join(',');
}

// อ่าน ProductAlias ของซัพพลายเออร์เดียว ผ่านแคช (10 นาที, แยก key ต่อเจ้า) — เดิม analyzeBillPhoto
// อ่านทั้งชีต ProductAlias ทุกซัพพลายเออร์ใหม่ทุกครั้งที่มีคนถ่ายบิล ยิ่งชีตโตยิ่งช้าขึ้นเรื่อยๆ
// invalidate ทันทีใน batchUpsertProductAlias() ตอนมีการเรียนรู้ alias ใหม่ของเจ้านั้น กันข้อมูลค้าง
function getProductAliasIndex(supplierId) {
  const key = 'productAlias_' + supplierId;
  const cached = cacheGet(key);
  if (cached) return cached;
  const sh = SHEET.getSheetByName(PRODUCT_ALIAS_SHEET);
  const aliases = sh ? readTable(PRODUCT_ALIAS_SHEET).filter(a => String(a.SupplierID).trim() === String(supplierId).trim()) : [];
  cacheSet(key, aliases, CACHE_TTL.productAlias);
  return aliases;
}
function invalidateProductAliasCache(supplierId) {
  cacheClear('productAlias_' + supplierId);
}

// เพิ่ม/แก้ไข ProductAlias หลายแถวพร้อมกันในการอ่าน/เขียนชีตครั้งเดียว (เดิม upsertProductAlias() อ่าน
// ทั้งชีตซ้ำทุกรายการในบิล — บิลนึงมี 10-20 รายการก็อ่านทั้งชีต 10-20 รอบ) คืนจำนวนแถวที่เป็นการเรียนรู้
// ใหม่จริง (ไว้ให้ finalizePurchaseReceipt นับ "จดจำเพิ่มกี่รายการ" ไปโชว์ผู้ใช้)
function batchUpsertProductAlias(supplierId, items, staffName, ts) {
  const sh = SHEET.getSheetByName(PRODUCT_ALIAS_SHEET);
  if (!sh) throw new Error('ไม่พบชีต ' + PRODUCT_ALIAS_SHEET + ' — สร้างชีตนี้ก่อน (คอลัมน์: AliasID, SupplierID, BillText, ProductID, ConversionFactor, BillUnit, UpdatedBy, Timestamp)');
  const data = sh.getDataRange().getValues();
  const headers = data[0]; // อ่านหัวคอลัมน์จริง ไม่ hardcode ลำดับ (เหตุผลเดียวกับ savePurchaseReceipt)
  const supCol = headers.indexOf('SupplierID'), textCol = headers.indexOf('BillText');
  if (supCol === -1 || textCol === -1) throw new Error('ไม่พบคอลัมน์ SupplierID หรือ BillText ในชีต ' + PRODUCT_ALIAS_SHEET);

  // index แถวเดิมของซัพพลายเออร์นี้ไว้ในหน่วยความจำครั้งเดียว แทนที่จะ scan ทั้งชีตซ้ำทุกรายการ
  const rowByKey = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][supCol]).trim() === String(supplierId).trim()) {
      rowByKey[normalizeAliasKey(data[i][textCol])] = i; // index ในตัวแปร data (ตรงกับแถวชีตจริงคือ +1)
    }
  }

  const stamp = Utilities.formatDate(new Date(), TZ, 'MMdd-HHmmss');
  let seq = 0, learnedCount = 0;
  const newRows = [];

  items.forEach(item => {
    const key = normalizeAliasKey(item.billText);
    const obj = {
      AliasID: 'AL' + stamp + '-' + (seq++), // ใส่ seq กันชนกันเวลา upsert หลายแถวในวินาทีเดียวกัน (เดิมทำทีละแถวไม่มีปัญหานี้)
      SupplierID: supplierId, BillText: item.billText, ProductID: item.productId,
      ConversionFactor: Number(item.conversionFactor) || 1, BillUnit: item.billUnit,
      UpdatedBy: staffName, Timestamp: ts
    };
    const rowIdx = rowByKey[key];
    if (rowIdx === undefined) {
      newRows.push(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
      learnedCount++;
    } else {
      headers.forEach((h, ci) => { if (h !== 'AliasID') sh.getRange(rowIdx + 1, ci + 1).setValue(obj[h]); });
    }
  });

  if (newRows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }
  invalidateProductAliasCache(supplierId);
  return learnedCount;
}
