/**
 * ===== Multi-sheet (แยกตามปี) support =====
 * แนวคิด: sheet order ในอนาคตจะตั้งชื่อ Order_<ปีพ.ศ.> เช่น Order_2569, Order_2570
 * เพื่อไม่ต้อง refactor ใหญ่ตอนขึ้นปีจริง โค้ดทั้งหมดที่ต้อง "รู้จักชื่อ sheet order"
 * ต้องผ่านฟังก์ชันกลางในหมวดนี้เท่านั้น ห้าม hardcode ชื่อ sheet order กระจายที่อื่น
 *
 * ช่วงเปลี่ยนผ่าน: ตอนนี้มี sheet เดียวชื่อ 'Order' (ของเดิม) — ฟังก์ชันด้านล่าง
 * fallback ไปใช้ sheet นี้โดยอัตโนมัติถ้ายังไม่มี sheet รายปีสำหรับปีนั้นๆ
 * ทำให้ระบบทำงานได้ปกติทั้งก่อน/หลังแยก sheet โดยไม่ต้องแก้โค้ดเพิ่ม
 */
const ORDER_SHEET_PREFIX = 'Order_';
const LEGACY_ORDER_SHEET_NAME = 'Order';

// ปีพ.ศ. ปัจจุบัน (ใช้เป็น default เมื่อไม่ระบุปี)
function currentBuddhistYear() {
  return Number(Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy')) + 543;
}

function dateToBuddhistYear(d) {
  return d.getFullYear() + 543;
}

/**
 * จุดเดียวที่รู้จักว่า sheet order ของปีไหนชื่ออะไร
 * year = ปีพ.ศ. (เช่น 2569) ถ้าไม่ระบุ ใช้ปีปัจจุบัน
 * คืนค่า Sheet object หรือ null ถ้าไม่พบทั้ง sheet รายปีและ sheet เดิม
 */
function getOrderSheetByYear(year) {
  const y = year || currentBuddhistYear();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const yearSheet = ss.getSheetByName(ORDER_SHEET_PREFIX + y);
  if (yearSheet) return yearSheet;
  // ยังไม่มี sheet แยกรายปีสำหรับปีนี้ -> fallback ไปใช้ sheet เดิม (ช่วงเปลี่ยนผ่าน)
  return ss.getSheetByName(LEGACY_ORDER_SHEET_NAME);
}

/**
 * คืนค่า sheet order ทั้งหมดที่มีอยู่จริงในไฟล์ (ทั้งแบบรายปีและ sheet เดิม)
 * ใช้เป็นจุดเดียวสำหรับ "รายการปีที่มีข้อมูล" — ฟังก์ชันอื่นที่ต้อง query ข้ามปี
 * (เช่น ประวัติลูกค้า, admin/owner order list, เปรียบเทียบยอดขายข้ามปี) ต้องเรียกผ่านนี้
 */
function getAllOrderSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const result = [];
  sheets.forEach(sh => {
    const name = sh.getName();
    if (name.indexOf(ORDER_SHEET_PREFIX) === 0) {
      const y = parseInt(name.substring(ORDER_SHEET_PREFIX.length), 10);
      if (!isNaN(y)) result.push({ year: y, sheet: sh });
    } else if (name === LEGACY_ORDER_SHEET_NAME) {
      result.push({ year: null, sheet: sh }); // null = sheet เดิม ยังไม่ระบุปีตายตัว
    }
  });
  return result;
}

/**
 * ===== Cache สำหรับข้อมูลออเดอร์รวม =====
 * ปัญหาเดิม: getAdminOrders / getOrders ทุกตัวเรียก getAllOrderRows()
 * ซึ่งอ่าน getDataRange().getValues() "ทั้งชีต" ทุก sheet order แบบสดใหม่ทุกครั้ง
 * รวมถึงตอน auto-refresh ฝั่งแอดมินที่ยิงเข้ามาทุก 10 วิ -> อ่านทั้งชีตซ้ำๆ โดยไม่จำเป็น
 * ทำให้ยิ่งออเดอร์สะสมเยอะ ยิ่งช้าลงเรื่อยๆ
 *
 * แก้ด้วย CacheService (cache ระดับ script, ใช้ร่วมกันได้ทุก request/ทุกคนที่เปิดแอดมินพร้อมกัน):
 * - TTL สั้นมาก (10 วิ) ให้พอๆ กับรอบ auto-refresh ฝั่ง frontend -> ข้อมูลไม่มีทางเก่าเกิน 10 วิ
 * - ล้าง cache ทันทีทุกครั้งที่มีการเขียน/แก้ไขออเดอร์ (ดู invalidateOrderCache() ด้านล่าง
 *   ถูกเรียกใน createOrder/updateOrder/updateDelivery/cancelOrder) เพื่อไม่ให้เห็นข้อมูลค้างหลังกดปุ่มอะไรไป
 * - ถ้าข้อมูลใหญ่เกิน 100KB (ข้อจำกัดของ CacheService ต่อ 1 key) จะ cache ไม่ได้
 *   แต่ไม่กระทบการทำงาน -> แค่ข้ามการ cache รอบนั้นไป อ่านสดตามปกติ (ดู catch ด้านล่าง)
 */
const ORDER_CACHE_KEY = 'all_order_rows_v1';
const ORDER_CACHE_TTL_SEC = 10;

/**
 * อ่านข้อมูลออเดอร์ทั้งหมดจากทุก sheet order แล้ว merge เป็น array เดียว
 * ใช้โดย getAdminOrders / getOrders (ต้องเห็นข้อมูลข้ามปีเสมอ)
 */
function getAllOrderRows() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(ORDER_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // cache เสีย/parse ไม่ได้ -> ข้ามไปอ่านสดด้านล่างตามปกติ ไม่ throw
    }
  }

  const sheetInfos = getAllOrderSheets();
  let merged = [];
  sheetInfos.forEach(info => {
    const rows = info.sheet.getDataRange().getValues();
    if (rows.length < 2) return;
    const headers = rows[0];
    for (let i = 1; i < rows.length; i++) {
      merged.push(rowToObj(headers, rows[i]));
    }
  });

  try {
    cache.put(ORDER_CACHE_KEY, JSON.stringify(merged), ORDER_CACHE_TTL_SEC);
  } catch (e) {
    // ข้อมูลใหญ่เกิน 100KB ต่อ key (ข้อจำกัดของ CacheService) หรือปัญหาอื่นของ cache
    // -> ไม่ throw ต่อ เพราะ merged ที่อ่านสดมาแล้วยังใช้งานได้ปกติ แค่ไม่ได้ cache รอบนี้
    console.error('getAllOrderRows: cache.put ล้มเหลว (ข้อมูลอาจใหญ่เกิน 100KB): ' + e);
  }

  return merged;
}

/**
 * ล้าง cache ข้อมูลออเดอร์ทันที — ต้องเรียกทุกครั้งหลังมีการเขียน/แก้ไข/ลบออเดอร์
 * (สร้างออเดอร์ใหม่, แก้ไข, เปลี่ยนสถานะจัดส่ง/การชำระเงิน, ยกเลิก ฯลฯ)
 * เพื่อไม่ให้ request ถัดไปเห็นข้อมูลเก่าค้างอยู่จนกว่า TTL จะหมดเอง
 */
function invalidateOrderCache() {
  try {
    CacheService.getScriptCache().remove(ORDER_CACHE_KEY);
  } catch (e) {
    console.error('invalidateOrderCache ล้มเหลว: ' + e);
  }
}

/**
 * หา row ของ order_id หนึ่งๆ โดยค้นข้ามทุก sheet order (ไม่รู้ล่วงหน้าว่าอยู่ปีไหน)
 * คืนค่า { sheet, headers, rowIndex (1-based, ใช้กับ getRange ได้ทันที), row } หรือ null ถ้าไม่พบ
 *
 * เรียง sheet ปีปัจจุบัน (ที่ createOrder เขียนออเดอร์ใหม่ลงไปเสมอ ผ่าน getOrderSheetByYear())
 * ไว้เป็นอันดับแรกก่อนค้นเสมอ เพราะ action ที่เรียกฟังก์ชันนี้ (markPacking/markDone/แก้ไข/ยกเลิก)
 * แทบทั้งหมดเป็นออเดอร์ของปีปัจจุบัน — ลดจำนวนแถวที่ต้อง scan โดยเฉลี่ยลงมาก
 * โดยเฉพาะเมื่อออเดอร์สะสมหลายปีในไฟล์เดียวกัน ไม่งั้นจะช้าลงเรื่อยๆ ตามอายุร้าน
 */
function findOrderLocation(order_id) {
  const sheetInfos = getAllOrderSheets();
  const currentSheet = getOrderSheetByYear();
  if (currentSheet) {
    const currentId = currentSheet.getSheetId();
    sheetInfos.sort((a, b) => {
      const aFirst = a.sheet.getSheetId() === currentId;
      const bFirst = b.sheet.getSheetId() === currentId;
      if (aFirst && !bFirst) return -1;
      if (!aFirst && bFirst) return 1;
      return 0;
    });
  }
  for (let s = 0; s < sheetInfos.length; s++) {
    const sheet = sheetInfos[s].sheet;
    const rows = sheet.getDataRange().getValues();
    if (rows.length < 2) continue;
    const headers = rows[0];
    const idCol = headers.indexOf('order_id');
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === order_id) {
        return { sheet: sheet, headers: headers, rowIndex: i + 1, row: rows[i] };
      }
    }
  }
  return null;
}

/**
 * ===== เช็คสิทธิ์แอดมิน (เพิ่ม 8 ก.ย. 69) =====
 * ก่อนหน้านี้ backend ไม่เช็คสิทธิ์อะไรเลยสักจุด — ใครก็ตามที่รู้ URL ของ API ยิง action ฝั่งแอดมินตรงๆ ได้อิสระ
 * (เปิดเผยอยู่ใน index.html บน GitHub) เก็บ ADMIN_KEY ไว้ใน Script Properties (Project Settings > Script Properties)
 * ไม่ hardcode ในไฟล์นี้ — ต้องตั้งค่าก่อนใช้งาน ไม่งั้น action ฝั่งแอดมินทุกตัวจะถูกปฏิเสธหมด (ไม่มี default/fallback
 * ให้ผ่านง่ายๆ ตั้งใจให้เป็นแบบนั้น)
 */
function isValidAdminKey(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!expected && key === expected;
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'getCustomer') return getCustomer(e.parameter.id);
  if (action === 'getProducts') return getProducts(e.parameter.group);
  if (action === 'getOrders') return getOrders(e.parameter.customer_id);
  if (action === 'getTrackOrders') return getTrackOrders(e.parameter.customer_id);
  if (action === 'getAdminOrders') return getAdminOrders(e.parameter.key);
  if (action === 'getAdminOrdersFull') return getAdminOrdersFull(e.parameter.key);
  if (action === 'getBusinessNotes') return getBusinessNotes();
  if (action === 'getThaiHolidays') return getThaiHolidays(e.parameter.year);
  return response({ error: 'invalid action' });
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);


  if (data.action === 'createOrder') return createOrder(data);
  if (data.action === 'updateOrder') return updateOrder(data);
  if (data.action === 'updateDelivery') return updateDelivery(data);
  if (data.action === 'cancelOrder') return cancelOrder(data);
  if (data.action === 'addBusinessNote') return addBusinessNote(data);
  if (data.action === 'deleteBusinessNote') return deleteBusinessNote(data);
  return response({ error: 'invalid action' });
}

/**
 * ===== บันทึกเหตุการณ์สำคัญ (BusinessNote) =====
 * ไม่ผูกกับเดือน/ปีใดๆ ตามที่ตกลงกันไว้ — เป็น log อิสระ เพิ่ม/ลบได้ตลอดเวลา
 * ต้องมี sheet ชื่อ 'BusinessNote' พร้อมหัวคอลัมน์: note_id, date, text
 */
function getBusinessNotes() {
  try {
    const sheet = getSheet('BusinessNote');
    if (!sheet) return response({ error: 'ไม่พบ sheet ชื่อ "BusinessNote" ในไฟล์ Google Sheet' });
    const rows = sheet.getDataRange().getValues();
    if (rows.length < 2) return response([]);
    const headers = rows[0];
    const notes = [];
    for (let i = 1; i < rows.length; i++) {
      notes.push(rowToObj(headers, rows[i]));
    }
    notes.sort((a, b) => new Date(b.date) - new Date(a.date));
    return response(notes);
  } catch (e) {
    return response({ error: 'getBusinessNotes: ' + e.message });
  }
}

function addBusinessNote(data) {
  try {
    if (!isValidAdminKey(data.key)) return response({ error: 'unauthorized' });
    const sheet = getSheet('BusinessNote');
    if (!sheet) return response({ error: 'ไม่พบ sheet ชื่อ "BusinessNote" ในไฟล์ Google Sheet (ต้องสร้างก่อน พร้อมหัวคอลัมน์ note_id, date, text)' });
    if (!data.text || !String(data.text).trim()) return response({ error: 'ไม่มีข้อความที่จะบันทึก' });
    const headers = sheet.getDataRange().getValues()[0];
    if (headers.indexOf('note_id') === -1 || headers.indexOf('date') === -1 || headers.indexOf('text') === -1) {
      return response({ error: 'หัวคอลัมน์ของ sheet "BusinessNote" ไม่ตรง ต้องมี note_id, date, text (สะกดตรงตัว ตัวพิมพ์เล็กหมด) — ตอนนี้เจอ: ' + headers.join(', ') });
    }
    const noteId = 'NOTE-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'ddMMyy-HHmmss');
    // ใช้วันที่ที่ frontend ส่งมา (เดือนที่ผู้ใช้กำลังดูอยู่ตอนพิมพ์โน้ต) ถ้ามี
    // ไม่ใช้เวลาจริงของ server เสมอไป เพราะผู้ใช้อาจกำลังจดถึงเดือนอื่นที่ไม่ใช่เดือนปัจจุบัน
    let noteDate = new Date();
    if (data.date) {
      const parsed = new Date(data.date);
      if (!isNaN(parsed)) noteDate = parsed;
    }
    const row = headers.map(h => {
      if (h === 'note_id') return noteId;
      if (h === 'date') return noteDate;
      if (h === 'text') return data.text;
      return '';
    });
    sheet.appendRow(row);
    return response({ success: true, note_id: noteId, date: noteDate });
  } catch (e) {
    return response({ error: 'addBusinessNote: ' + e.message });
  }
}

function deleteBusinessNote(data) {
  try {
    if (!isValidAdminKey(data.key)) return response({ error: 'unauthorized' });
    const sheet = getSheet('BusinessNote');
    if (!sheet) return response({ error: 'ไม่พบ sheet ชื่อ "BusinessNote" ในไฟล์ Google Sheet' });
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const idCol = headers.indexOf('note_id');
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === data.note_id) {
        sheet.deleteRow(i + 1);
        return response({ success: true });
      }
    }
    return response({ error: 'not found' });
  } catch (e) {
    return response({ error: 'deleteBusinessNote: ' + e.message });
  }
}

/**
 * ===== วันหยุดนักขัตฤกษ์ไทย (Thai public holidays) =====
 * ดึงจาก thailandformats.com (ฟรี ไม่ต้องใช้ API key) แล้ว cache ผลไว้ใน
 * Script Properties แยกตามปี เพื่อไม่ต้องยิง API ซ้ำทุกครั้งที่เปิดหน้าภาพรวม
 * (วันหยุดของปีที่ผ่านไปแล้วแทบไม่เปลี่ยน ปีปัจจุบัน/อนาคตอาจมีประกาศวันหยุดพิเศษเพิ่มได้
 *  ถ้าต้องการรีเฟรช cache ใหม่ ให้ลบ property 'holidays_<ปี>' ออกจาก Script Properties)
 */
function fetchThaiHolidays(year) {
  const props = PropertiesService.getScriptProperties();
  const cacheKey = 'holidays_' + year;
  const cached = props.getProperty(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* cache เสีย -> fetch ใหม่ด้านล่าง */ }
  }

  try {
    const res = UrlFetchApp.fetch('https://thailandformats.com/api/v1/holidays/' + year, {
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return [];
    const data = JSON.parse(res.getContentText());
    const holidays = [];
    (data.holidays || []).forEach(h => {
      // บาง holiday เป็นช่วงหลายวัน (เช่น สงกรานต์ 13-15 เม.ย.) -> ขยายเป็นวันย่อยๆ ทุกวัน
      const start = new Date(h.start_date + 'T00:00:00');
      const end = new Date(h.end_date + 'T00:00:00');
      const d = new Date(start);
      while (d <= end) {
        holidays.push({
          date: Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd'),
          name: h.title
        });
        d.setDate(d.getDate() + 1);
      }
    });
    props.setProperty(cacheKey, JSON.stringify(holidays));
    return holidays;
  } catch (e) {
    console.error('fetchThaiHolidays failed: ' + e);
    return [];
  }
}

function getThaiHolidays(year) {
  const y = parseInt(year, 10) || new Date().getFullYear();
  return response(fetchThaiHolidays(y));
}

/**
 * ฟังก์ชันทดสอบ — ใช้สำหรับกด Run มือใน Apps Script Editor ครั้งแรก
 * เพื่อ trigger popup "Authorize access" (ขอสิทธิ์เรียก URL ภายนอก)
 * เลือกฟังก์ชันนี้จาก dropdown แล้วกด Run ▶ ครั้งเดียวพอ ไม่ต้อง error เหมือน doGet
 */
function testAuthorizeExternalFetch() {
  const result = fetchThaiHolidays(new Date().getFullYear());
  Logger.log('ดึงวันหยุดได้ ' + result.length + ' รายการ');
  Logger.log(JSON.stringify(result.slice(0, 3)));
}

/**
 * ส่งข้อความแจ้งเตือนเข้า Telegram (ย้ายจาก LINE OA เพราะแผนฟรีของ LINE มีโควต้าข้อความ/เดือน
 * ที่หมดไวเกินไป — Telegram Bot API ไม่มีโควต้าจำกัดแบบนั้น)
 * ต้องตั้งค่า Script Property 2 ตัวก่อนใช้งาน (Project Settings > Script Properties):
 *   TELEGRAM_BOT_TOKEN -> token จาก BotFather ตอนสร้างบอท
 *   TELEGRAM_CHAT_ID   -> chat id ของกลุ่ม/แชทที่จะส่งเข้าไป (ดึงจาก getUpdates)
 */
function sendTelegramNotify(message) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('TELEGRAM_BOT_TOKEN');
    const chatId = props.getProperty('TELEGRAM_CHAT_ID');

    if (!token || !chatId) {
      console.error('Telegram notify skipped: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      return;
    }

    const payload = {
      chat_id: chatId,
      text: message
    };

    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true // กัน error ของ Telegram ไม่ให้ทำให้คำสั่งซื้อ/แก้ไข/ยกเลิกล้มไปด้วย
    });

    const code = res.getResponseCode();
    if (code !== 200) {
      // ไม่ throw error (กันไม่ให้กระทบ flow หลัก) แต่บันทึก log ไว้ดูใน
      // Apps Script Editor > Executions เพื่อรู้ว่าตอนไหน Telegram ปฏิเสธ
      console.error('Telegram push failed. Code: ' + code + ' Body: ' + res.getContentText());
    }
  } catch (e) {
    console.error('sendTelegramNotify error: ' + e);
  }
}

function formatMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, j) => obj[h] = row[j]);
  return obj;
}

// อ่านแถวลูกค้าดิบจาก Sheet "Customer" ตาม customer_id — คืน object หรือ null ถ้าไม่พบ
// ใช้จุดเดียวทั้งโดย getCustomer() (ตอบ frontend) และ createOrder() (หา product_group จริงมาคำนวณราคา
// แทนที่จะเชื่อ customer_group ที่ client ส่งมา กันคนอ้างว่าตัวเองอยู่กลุ่มราคาถูกกว่าความจริง)
function findCustomerRow(id) {
  const sheet = getSheet('Customer');
  if (!sheet) return null;
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const obj = rowToObj(headers, rows[i]);
    if (obj['customer_id'] === id) return obj;
  }
  return null;
}

function getCustomer(id) {
  const found = findCustomerRow(id);
  return found ? response(found) : response({ error: 'not found' });
}

/**
 * ===== Cache สำหรับข้อมูลสินค้า =====
 * เดิม getProducts อ่านทั้งชีต Product สดใหม่ทุกครั้ง (ทั้งตอนลูกค้าเปิดหน้าร้าน
 * และตอนแอดมินเปิดหน้าแอดมิน) ซึ่งเป็นอีกจุดที่ทำให้เกิด timeout ได้
 * สินค้าเปลี่ยนไม่บ่อยเท่าออเดอร์ (แก้เองในชีตเป็นครั้งคราว) จึงตั้ง TTL ยาวกว่า
 * ไม่ต้องมี invalidate เพราะไม่มี action ไหนในแอปที่แก้สินค้าโดยตรง (แก้ในชีตเองเท่านั้น)
 */
const PRODUCT_CACHE_KEY = 'all_products_v1';
const PRODUCT_CACHE_TTL_SEC = 60;

function getAllProductRows() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PRODUCT_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // cache เสีย/parse ไม่ได้ -> อ่านสดด้านล่างตามปกติ
    }
  }

  const sheet = getSheet('Product');
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const all = [];
  for (let i = 1; i < rows.length; i++) {
    all.push(rowToObj(headers, rows[i]));
  }

  try {
    cache.put(PRODUCT_CACHE_KEY, JSON.stringify(all), PRODUCT_CACHE_TTL_SEC);
  } catch (e) {
    console.error('getAllProductRows: cache.put ล้มเหลว (ข้อมูลอาจใหญ่เกิน 100KB): ' + e);
  }

  return all;
}

function getProducts(group) {
  const all = getAllProductRows();
  if (group === 'ALL') return response(all);
  return response(all.filter(p => p['group'] === group));
}

/**
 * ===== คำนวณ total จริงที่ backend (เพิ่ม 8 ก.ย. 69) — เดิมเชื่อค่า data.total จาก client 100% =====
 * แยกรายการจาก items string รูปแบบ "ชื่อ xจำนวน, ชื่อ xจำนวน" — เหมือน parseItems() ฝั่ง index.html เป๊ะ
 * (มีข้อจำกัดเดียวกัน: ถ้าชื่อสินค้ามี comma ปนจะ parse ผิดตำแหน่ง — เป็น backlog แยกต่างหาก ยังไม่แก้ในนี้)
 */
function parseItemsServer(itemsText) {
  if (!itemsText) return [];
  return String(itemsText).split(', ').map(item => {
    const lastX = item.lastIndexOf(' x');
    if (lastX === -1) return { name: item, qty: 1 };
    const parsed = parseInt(item.substring(lastX + 2), 10);
    return { name: item.substring(0, lastX), qty: isNaN(parsed) ? 1 : parsed };
  }).filter(i => i.qty > 0);
}

/**
 * คำนวณ total จากราคาสินค้าจริงใน Sheet ตาม customerGroup ที่ส่งเข้ามา — ต้อง group-aware เหมือน
 * getOrderProdMap() ฝั่ง index.html เป๊ะ (ระบบ per-customer-segment price list: สินค้าชื่อเดียวกันมีได้
 * หลายแถว แถวละ 1 กลุ่มราคา) ไม่งั้นสินค้าชื่อซ้ำกันข้าม group จะได้ราคาผิด (เช่นไข่นกกระทา) — fallback ไปใช้
 * สินค้าทั้งหมดถ้า group นั้นไม่มีสินค้าเลย ตรงกับ fallback ฝั่ง frontend
 *
 * ⚠️ ผู้เรียกต้องส่ง customerGroup ที่ยืนยันแล้วว่าเป็นของจริง (เช่นดึงจาก Sheet "Customer" ตรงๆ) ห้ามส่งค่าที่
 * client อ้างมาเฉยๆ ไม่งั้นคนร้ายแค่เปลี่ยนจาก "โกหกยอดรวม" เป็น "โกหกกลุ่มราคา" แทน ช่องโหว่ก็ยังไม่ปิดจริง
 */
function computeOrderTotal(itemsText, customerGroup) {
  const items = parseItemsServer(itemsText);
  const allProducts = getAllProductRows();
  const groupProducts = customerGroup ? allProducts.filter(p => p['group'] === customerGroup) : [];
  const source = groupProducts.length ? groupProducts : allProducts;
  const priceMap = {};
  source.forEach(p => { priceMap[p['name']] = Number(p['price']) || 0; });
  return items.reduce((sum, item) => sum + item.qty * (priceMap[item.name] || 0), 0);
}

function getOrders(customer_id) {
  // ประวัติลูกค้าอาจมี order ข้ามปี (คนละ sheet) -> ต้อง merge ทุก sheet เสมอ
  // ใช้เฉพาะหน้า "ประวัติทั้งหมด" (loadHistory ฝั่ง index.html) ที่ตั้งใจให้เห็นทุกออเดอร์จริงๆ เท่านั้น —
  // จุดอื่นที่ไม่ต้องการข้อมูลทั้งหมด (หน้า track/auto-refresh/เช็คออเดอร์ซ้ำ/สั่งซ้ำ) ให้ใช้ getTrackOrders() แทน
  const orders = getAllOrderRows().filter(obj => obj['customer_id'] === customer_id);
  return response(orders.reverse());
}

/**
 * ===== ข้อมูลออเดอร์แบบย่อสำหรับหน้า track/dedup-check/สั่งซ้ำ (เพิ่ม 8 ก.ย. 69) =====
 * เดิม 4 จุดนี้เรียก getOrders() (ประวัติทั้งหมดตลอดชีพของลูกค้า) ทั้งที่ใช้จริงแค่: ออเดอร์ที่ยัง active
 * (pending/packing) ทุกอัน + ออเดอร์ที่เสร็จ/ยกเลิกล่าสุดอย่างละไม่กี่อัน (ฝั่ง frontend เดิมก็กรองทิ้งเหลือแค่นี้
 * อยู่แล้วหลังได้ข้อมูลมา — แค่ backend ส่งมาเกินความจำเป็นทุกครั้ง) ยิ่งลูกค้าสั่งสะสมมานาน payload ยิ่งโตขึ้น
 * เรื่อยๆ โดยเฉพาะหน้า track ที่ auto-refresh ทุก 10 วิ — ย้าย logic กรองนี้มาทำที่ backend แทน ผลลัพธ์ที่ลูกค้า
 * เห็นเหมือนเดิมทุกอย่าง แค่ส่งข้อมูลน้อยลง
 */
const TRACK_ORDERS_RECENT_LIMIT = 5;
function getTrackOrders(customer_id) {
  const orders = getAllOrderRows().filter(obj => obj['customer_id'] === customer_id);
  const isDone = o => String(o['delivery_status'] || o['status'] || '').toLowerCase().trim() === 'done';
  const isCancelled = o => String(o['delivery_status'] || o['status'] || '').toLowerCase().trim() === 'cancelled';
  const byTimeDesc = (a, b) => new Date(b.timestamp) - new Date(a.timestamp);

  const active = orders.filter(o => !isDone(o) && !isCancelled(o));
  const doneRecent = orders.filter(isDone).sort(byTimeDesc).slice(0, TRACK_ORDERS_RECENT_LIMIT);
  const cancelledRecent = orders.filter(isCancelled).sort(byTimeDesc).slice(0, TRACK_ORDERS_RECENT_LIMIT);

  return response([...active, ...doneRecent, ...cancelledRecent]);
}

/**
 * ===== หน้าต่างข้อมูลสำหรับแท็บหลักของแอดมิน (รอจัด/กำลังจัด/เสร็จวันนี้) =====
 * เดิม getAdminOrders() ส่งออเดอร์ "ทั้งหมดทุกปี" กลับไปทุกครั้งที่ auto-refresh (ทุก 30 วิ)
 * ทั้งที่แท็บหลักใช้จริงแค่ order ที่ยัง pending/packing (ไม่มีทางเก่าข้ามเดือน) บวก done/cancelled
 * ของ "วันนี้" เท่านั้น -> ยิ่งร้านสะสมออเดอร์นานเท่าไหร่ payload/เวลาคำนวณฝั่ง browser ยิ่งโตขึ้นเรื่อยๆ
 * โดยไม่จำเป็น ตัดออกด้วยการกรอง done/cancelled ที่เก่ากว่า ADMIN_ORDERS_WINDOW_DAYS ทิ้งไป
 * (เผื่อ buffer กว้างกว่า "วันนี้" มากพอสมควร กันกรณี timezone/แก้ไขข้อมูลย้อนหลังเล็กน้อย)
 * ส่วนหน้า "ภาพรวม/แดชบอร์ด" ที่ต้องดูย้อนหลังได้ไกลกว่านี้ ให้เรียก getAdminOrdersFull() แทน
 */
const ADMIN_ORDERS_WINDOW_DAYS = 60;
function filterAdminOrdersWindow(rows) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ADMIN_ORDERS_WINDOW_DAYS);
  return rows.filter(function (o) {
    const ds = o['delivery_status'];
    if (ds !== 'done' && ds !== 'cancelled') return true; // pending/packing ต้องอยู่ครบเสมอไม่ว่าจะเก่าแค่ไหน
    const t = o['done_at'] || o['timestamp'];
    if (!t) return true; // ไม่มี timestamp ให้อ่าน -> ปล่อยผ่านไว้ก่อน กันข้อมูลหายเงียบๆ
    return new Date(t) >= cutoff;
  });
}

function getAdminOrders(key) {
  if (!isValidAdminKey(key)) return response({ error: 'unauthorized' });
  return response(filterAdminOrdersWindow(getAllOrderRows()).reverse());
}

// ข้อมูลเต็มทุกปี ไม่กรองช่วงวันที่ -> ใช้เฉพาะตอนแอดมินเปิดแท็บ "ภาพรวม" เท่านั้น ไม่ใช่ทุก auto-refresh
function getAdminOrdersFull(key) {
  if (!isValidAdminKey(key)) return response({ error: 'unauthorized' });
  return response(getAllOrderRows().reverse());
}

/**
 * idempotency_key (ถ้า client ส่งมา) กันสร้างออเดอร์ซ้ำ — พบเคสจริง 10 ก.ย. 69: createOrder บันทึกสำเร็จ
 * แต่ response หลุด/timeout กลับไปหา client (cold connection ปัญหาเดิมที่เคยบันทึกไว้), ลูกค้าเห็น alert
 * "ไม่สำเร็จ" เลยกดสั่งซ้ำเอง -> Telegram แจ้งเตือน 2 รอบ, ออเดอร์ซ้ำจริงในชีต
 *
 * แก้ด้วย LockService (serialize ทุกคำขอ createOrder กันสอง request เข้ามาพร้อมกันอ่าน cache ไม่เจอทั้งคู่
 * ก่อนฝ่ายใดเขียนทัน — เหตุผลเดียวกับ updateDelivery) + CacheService เก็บ mapping key -> order_id ที่เพิ่งสร้าง
 * (TTL 5 นาที ครอบคลุมทั้ง auto-retry ของ postAction และการกดปุ่มซ้ำเองของลูกค้า) ยิงซ้ำด้วย key เดิมกี่ครั้ง
 * จะได้ order_id เดิมกลับไปเสมอ ไม่ appendRow ซ้ำ — ใช้ cache ไม่ใช่คอลัมน์ใหม่ในชีต เพื่อไม่ต้องแก้ header เดิม
 *
 * ไม่บังคับว่าต้องมี key: frontend เก่าที่ cache ค้าง (เคยเจอปัญหานี้จริงกับแอปนี้ — ไอคอน/แท็บปักหมุด) ที่ยังไม่ส่ง
 * มา จะทำงานได้ตามปกติเดิมทุกอย่าง แค่ไม่มี dedup protection ให้ (เหมือนพฤติกรรมก่อนแก้)
 *
 * ⚠️ sendTelegramNotify() ต้องเรียก "หลัง" lock.releaseLock() เท่านั้น (เก็บ message ไว้ในตัวแปร notifyMessage
 * ระหว่างอยู่ใน lock) — เจอบั๊กจริงจากจุดเดียวกันนี้ใน updateDelivery เมื่อ 10 ก.ย. 69: Telegram เป็น network
 * call ที่ใช้เวลาไม่แน่นอน ถ้าเรียกในนี้จะถือ lock ค้างนานเกิน 10 วิได้ตอน Telegram ช้า ทำให้คำขอ createOrder
 * อื่น (เช่น auto-retry ของ postAction) waitLock timeout เห็น error "ระบบกำลังประมวลผลคำขออื่นอยู่" ทั้งที่
 * คำขอแรกอาจบันทึกสำเร็จจริงอยู่ดี
 */
function createOrder(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return response({ error: 'createOrder: ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง' });
  }
  let notifyMessage = null;
  try {
    const idemKey = data.idempotency_key;
    const cache = CacheService.getScriptCache();
    if (idemKey) {
      const cachedOrderId = cache.get('idem_order_' + idemKey);
      if (cachedOrderId) {
        return response({ success: true, order_id: cachedOrderId });
      }
    }

    // ออเดอร์ใหม่เขียนลง sheet ของปีปัจจุบันเสมอ (ผ่าน getOrderSheetByYear จุดเดียว)
    const sheet = getOrderSheetByYear();
    if (!sheet) {
      return response({ error: 'createOrder: ไม่พบ sheet order ของปีปัจจุบัน (ไม่มีทั้ง Order_' + currentBuddhistYear() + ' และ ' + LEGACY_ORDER_SHEET_NAME + ')' });
    }
    const headers = sheet.getDataRange().getValues()[0];
    const orderId = 'ORD-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'ddMMyy-HHmmss');

    // ดึง product_group จริงของลูกค้าคนนี้จาก Sheet "Customer" ตรงๆ ไม่เชื่อ data.customer_group ที่ client อ้างมา
    // (กันคนอ้างว่าตัวเองอยู่กลุ่มราคาถูกกว่าความจริง) แล้วคำนวณ total จากราคาสินค้าจริงตามกลุ่มนั้น ไม่เชื่อ data.total
    // เลย — เดิม backend รับค่าทั้งสองตัวนี้จาก client ตรงๆ 100% ไม่เคยตรวจสอบอะไรเลย
    const customerRow = findCustomerRow(data.customer_id);
    const realGroup = customerRow ? customerRow['product_group'] : data.customer_group;
    const total = computeOrderTotal(data.items, realGroup);

    // เขียนแถวด้วยการอ้างชื่อหัวคอลัมน์ (ไม่ใช่ตำแหน่ง) — สลับ/ลบ/เพิ่มคอลัมน์ในชีตได้โดยไม่กระทบโค้ด
    const rowObj = {
      order_id: orderId,
      customer_id: data.customer_id,
      customer_name: data.customer_name,
      items: data.items,
      total: total,
      note: data.note,
      status: 'pending',
      timestamp: new Date(),
      delivery_status: 'pending',
      payment_status: 'pending',
      customer_group: realGroup
    };
    const row = headers.map(h => (h in rowObj) ? rowObj[h] : '');
    sheet.appendRow(row);
    invalidateOrderCache();

    if (idemKey) {
      try {
        cache.put('idem_order_' + idemKey, orderId, 300);
      } catch (e) {
        console.error('createOrder: cache.put idempotency key ล้มเหลว: ' + e);
      }
    }

    // เก็บไว้ส่งหลัง release lock เท่านั้น (ดู comment ด้านบนฟังก์ชัน) — ไม่มีผลต่อความสำเร็จของการบันทึกออเดอร์
    // อยู่แล้ว (sendTelegramNotify มี try/catch ของตัวเองอยู่แล้ว)
    notifyMessage =
      '🛒 ออเดอร์ใหม่!\n' +
      'รหัส: ' + orderId + '\n' +
      'ลูกค้า: ' + data.customer_name + '\n' +
      'ยอดรวม: ฿' + formatMoney(total) +
      (data.note ? '\nโน้ต: ' + data.note : '');

    return response({ success: true, order_id: orderId });
  } catch (e) {
    return response({ error: 'createOrder: ' + e.message });
  } finally {
    lock.releaseLock();
    if (notifyMessage) sendTelegramNotify(notifyMessage);
  }
}

// เรียกได้ทั้งแอดมิน (แก้ไขจากหน้าจัดการ) และลูกค้า (แก้ไขออเดอร์ตัวเองก่อนถูกจัดที่หน้า track) —
// ยอมให้ผ่านถ้ามี ADMIN_KEY ถูกต้อง หรือ customer_id ที่ส่งมาตรงกับเจ้าของออเดอร์จริงในชีต (กันลูกค้าคนหนึ่ง
// แก้ไขออเดอร์ของลูกค้าอีกคนโดยเดา/ยิง order_id ตรงๆ)
function updateOrder(data) {
  const loc = findOrderLocation(data.order_id);
  if (!loc) return response({ error: 'not found' });
  const { sheet, headers, rowIndex, row } = loc;
  const ownerCustomerId = row[headers.indexOf('customer_id')];
  if (!isValidAdminKey(data.key) && !(data.customer_id && data.customer_id === ownerCustomerId)) {
    return response({ error: 'unauthorized' });
  }
  // คำนวณ total ใหม่จากราคาสินค้าจริง ใช้ customer_group ที่บันทึกไว้ตอนสร้างออเดอร์ (ยืนยันแล้วตอน createOrder)
  // ไม่เชื่อ data.total หรือ customer_group จาก client เลย — เหตุผลเดียวกับ createOrder ด้านบน
  const orderGroup = row[headers.indexOf('customer_group')];
  const total = computeOrderTotal(data.items, orderGroup);
  sheet.getRange(rowIndex, headers.indexOf('items') + 1).setValue(data.items);
  sheet.getRange(rowIndex, headers.indexOf('total') + 1).setValue(total);
  sheet.getRange(rowIndex, headers.indexOf('note') + 1).setValue(data.note);
  invalidateOrderCache();
  return response({ success: true });
}

/**
 * ล็อกทั้ง read-check-write ไว้ด้วย LockService — กัน race condition ที่ทำให้แจ้งเตือน Telegram ซ้ำ
 * (พบจริง 8 ก.ย. 69: 2 request เข้ามาเกือบพร้อมกัน เช่น postAction auto-retry ยิงซ้ำตอน execution แรก
 * ยังไม่เขียนเสร็จ หรือแอดมินแตะปุ่มรัว ทำให้ทั้งสอง execution อ่านค่า delivery_status เดิมพร้อมกันได้
 * ก่อนฝ่ายใดจะเขียนทัน ผ่าน guard "currentStatus === data.delivery_status" ได้ทั้งคู่ -> เขียน done ซ้ำ
 * + ยิง Telegram ซ้ำ) การล็อกนี้ทำให้ทุก updateDelivery ทำงานทีละคำขอเท่านั้น (ไม่ว่าจะคนละ order_id ก็ตาม)
 * ยอมรับได้เพราะปริมาณคำขอของร้านนี้ต่ำ ไม่ถึงระดับที่การรอคิวจะกระทบผู้ใช้จริง
 *
 * ⚠️ [แก้ 10 ก.ย. 69] sendTelegramNotify() ต้องเรียก "หลัง" lock.releaseLock() เท่านั้น ห้ามย้ายกลับเข้าไปใน
 * critical section — เดิมเรียกอยู่ข้างในก่อน releaseLock พบจริงว่า Telegram (network call ที่ใช้เวลาไม่แน่นอน)
 * ทำให้ lock ถูกถือค้างนานเกิน 10 วิ ตอน Telegram ช้า ทำให้คำขอ updateDelivery อื่นที่เข้ามาพร้อมกัน (เช่น
 * auto-retry ของ postAction ที่ markDone()/markPacking() ไม่ได้ปิด retry ไว้) waitLock timeout เห็น error
 * "ระบบกำลังประมวลผลคำขออื่นอยู่" ทั้งที่คำขอแรกอาจสำเร็จจริงอยู่ดี — ย้าย sendTelegramNotify มาไว้ใน finally
 * ต่อจาก releaseLock() แทน (เก็บแค่ message string ไว้ในตัวแปร notifyMessage ระหว่างอยู่ใน lock) lock จะถือแค่
 * ช่วงอ่าน/เขียนชีต (เร็ว) เท่านั้น
 */
function updateDelivery(data) {
  if (!isValidAdminKey(data.key)) return response({ error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return response({ error: 'updateDelivery: ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง' });
  }
  // สร้างไว้เผื่อมีข้อความต้องแจ้ง — ส่งจริงหลัง release lock แล้วเท่านั้น (ดูเหตุผลที่ comment ด้านบนฟังก์ชัน)
  let notifyMessage = null;
  try {
    const loc = findOrderLocation(data.order_id);
    if (!loc) return response({ error: 'not found' });
    const { sheet, headers, rowIndex, row } = loc;

    const currentStatus = row[headers.indexOf('delivery_status')];

    // กันการ process ซ้ำ: ถ้าสถานะปัจจุบันเป็นค่าเดียวกับที่ขอตั้งอยู่แล้ว ให้ข้ามทั้งหมด
    // (ป้องกันหลายเครื่อง/หลายคนกดปุ่มเดียวกันพร้อมกัน แล้วยิง request ซ้ำเข้ามา —
    // ตอนนี้ปลอดภัยจริงแล้วเพราะมี lock ครอบอยู่ ไม่มี request อื่นมาแทรกระหว่างอ่าน-เขียนได้อีก)
    if (currentStatus === data.delivery_status) {
      return response({ success: true, skipped: true, reason: 'already_in_this_status' });
    }

    sheet.getRange(rowIndex, headers.indexOf('delivery_status') + 1).setValue(data.delivery_status);
    invalidateOrderCache();

    const now = new Date();
    if (data.delivery_status === 'packing') {
      const col = headers.indexOf('packing_at');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(now);
    } else if (data.delivery_status === 'done') {
        const col = headers.indexOf('done_at');
        if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(now);

        const customerName = row[headers.indexOf('customer_name')];
        const total = row[headers.indexOf('total')];
        notifyMessage =
          '✅ จัดเสร็จแล้ว\n' +
          'รหัส: ' + data.order_id + '\n' +
          'ลูกค้า: ' + customerName + '\n' +
          'ยอดรวม: ฿' + formatMoney(total);
      }

    return response({ success: true });
  } finally {
    lock.releaseLock();
    // ตั้งใจส่งหลัง release lock แล้วเท่านั้น (ดู comment ด้านบนฟังก์ชัน) — sendTelegramNotify มี try/catch
    // ของตัวเองอยู่แล้ว ไม่ต้องห่อซ้ำ
    if (notifyMessage) sendTelegramNotify(notifyMessage);
  }
}

function response(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function testUpdateDelivery() {
  const result = updateDelivery({order_id: 'ORD-200626-153000', delivery_status: 'done'});
  Logger.log(result.getContent());
}

// เรียกได้ทั้งแอดมินและลูกค้า (ยกเลิกออเดอร์ตัวเองที่หน้า track) — pattern สิทธิ์เดียวกับ updateOrder ด้านบน
function cancelOrder(data) {
  const loc = findOrderLocation(data.order_id);
  if (!loc) return response({ error: 'not found' });
  const { sheet, headers, rowIndex, row } = loc;
  const ownerCustomerId = row[headers.indexOf('customer_id')];
  if (!isValidAdminKey(data.key) && !(data.customer_id && data.customer_id === ownerCustomerId)) {
    return response({ error: 'unauthorized' });
  }
  const customerName = row[headers.indexOf('customer_name')];
  const total = row[headers.indexOf('total')];

  sheet.getRange(rowIndex, headers.indexOf('delivery_status') + 1).setValue('cancelled');
  const cancelledAtCol = headers.indexOf('cancelled_at');
  if (cancelledAtCol !== -1) {
    sheet.getRange(rowIndex, cancelledAtCol + 1).setValue(new Date());
  }
  invalidateOrderCache();

  sendTelegramNotify(
    '❌ ยกเลิกออเดอร์\n' +
    'รหัส: ' + data.order_id + '\n' +
    'ลูกค้า: ' + customerName + '\n' +
    'ยอดรวม: ฿' + formatMoney(total)
  );

  return response({ success: true });
}

/**
 * เพิ่มเมนู "จัดการสินค้า" ใน Google Sheet ทุกครั้งที่เปิดไฟล์
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('จัดการสินค้า')
    .addItem('🔍 เช็ค product_id ถัดไป', 'showNextProductId')
    .addToUi();
}

/**
 * แสดง product_id ถัดไปที่ปลอดภัย (ไม่ซ้ำ ไม่ข้าม)
 * ไม่แทรกแถวให้ — แค่บอกเลข ที่เหลือกรอกเองในชีตตามปกติ
 */
function showNextProductId() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getSheet('Product');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('product_id');

  if (idCol === -1) {
    ui.alert('ไม่พบคอลัมน์ product_id ใน sheet Product');
    return;
  }

  let maxId = 0;
  for (let i = 1; i < data.length; i++) {
    const numericId = parseInt(String(data[i][idCol]).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(numericId) && numericId > maxId) maxId = numericId;
  }

  const sampleId = data.length > 1 ? String(data[1][idCol]) : 'P001';
  const prefix = (sampleId.match(/^([A-Za-z]*)0*/) || ['', ''])[1];
  const padLength = sampleId.replace(/[^0-9]/g, '').length || 3;
  const nextId = prefix + String(maxId + 1).padStart(padLength, '0');

  ui.alert('product_id ถัดไปที่ใช้ได้:\n\n' + nextId);
}
