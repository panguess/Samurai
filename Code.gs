/**
 * ระบบเช็คสต๊อก & สั่งของ — ซามูไร ไส้กรอก
 * Apps Script Web App (Backend API)
 */

const SHEET = SpreadsheetApp.getActiveSpreadsheet();
const TZ = 'Asia/Bangkok';
const PRODUCT_PHOTOS_FOLDER_ID = '1tKb9lQLmrHiUVid9b3odaf3GIcBwEZtE'
// ⚠️ ต้องแก้เป็น Folder ID จริงใน Google Drive สำหรับเก็บรูปหน้าพนักงาน (สร้างโฟลเดอร์ใหม่แล้วเอา ID มาใส่)
const STAFF_PHOTOS_FOLDER_ID = '1Q8LagIuk-1ykhtFypehs93C6LQwjZ6Sd';
// ชื่อชีตสินค้าที่ใช้งานจริง — เดิมคือ 'Products' / ปัจจุบันคือ 'Product (Actual)' (Products (OCR) จะถูกลบทิ้งในอนาคต)
// เปลี่ยนค่านี้จุดเดียวถ้าชื่อชีตเปลี่ยนในอนาคต
const PRODUCT_SHEET_NAME = 'Product (Actual)';
// ชีตเก็บสถานะ "ส่งข้อความสั่งของให้ supplier จริงแล้ว" (ยืนยันมือ แยกจาก OrderLogs
// ที่แค่บันทึกว่าแอปสร้างข้อความสั่งให้แล้ว) — ต้องสร้างชีตนี้เองก่อนใช้งาน
// หัวคอลัมน์: ConfirmID | Date | SupplierID | ConfirmedBy | Timestamp
const SUPPLIER_ORDER_CONFIRM_SHEET = 'OrderConfirmations';
// ชีตสรุป "แถวล่าสุดต่อหน่วยสินค้า" — 1 แถวต่อ 1 UnitID เขียนทับแถวเดิมทุกครั้งที่เช็คสต๊อกใหม่
// (แทนการ append เข้า StockLogs อย่างเดียว) ขนาดชีตนี้คงที่เท่าจำนวนหน่วยสินค้าทั้งหมด ไม่โตขึ้นตามเวลา
// เหมือน StockLogs ที่สะสมทุกแถวประวัติ — getStockStatus() อ่านชีตนี้แทน ทำให้เร็วคงที่ไม่ว่าจะผ่านไปกี่เดือน
// ถ้าชีตนี้ยังไม่มี ระบบจะสร้างให้อัตโนมัติตอนเช็คสต๊อกครั้งแรก (ดู ensureSheetWithHeaders)
// หัวคอลัมน์: UnitID | Date | RemainQty | CheckedBy | Timestamp
const STOCK_LOGS_LATEST_SHEET = 'StockLogsLatest';
/* ============ server-side cache (ลดการอ่านชีตซ้ำ) ============ */
const CACHE = CacheService.getScriptCache();
const CACHE_TTL = {
  bootstrap: 300,     // 5 นาที — ร้าน/สินค้า/พนักงานไม่ค่อยเปลี่ยน
  stockStatus: 60,    // 60 วิ (เดิม 20 วิ) — กันหลายคนกดพร้อมกันแล้วอ่านชีตซ้ำรัวๆ
                       // ยืดได้มากขึ้นเพราะตอนนี้ getStockStatus() อ่านแค่ StockLogsLatest (ขนาดคงที่)
                       // ไม่ได้อ่านทั้ง StockLogs ที่โตขึ้นทุกวันอีกต่อไป — ผลคือรอบแรกหลังแคชหมดอายุก็เร็วอยู่แล้ว
  analytics: 120       // 2 นาที — getAnalytics() ยังอ่านทั้งชีต OrderLogs (ไม่มีตัวสรุปแยกแบบ StockLogsLatest)
                       // เดิมไม่มีแคชเลยเลยอ่านทั้งชีตซ้ำทุกครั้งที่เปิดหน้า analytics แม้เพิ่งเปิดไปเมื่อครู่
};
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
  let result;
  try {
    switch (action) {
      case 'bootstrap':     result = bootstrap();                               break;
      case 'stockStatus':   result = getStockStatus();                         break;
      case 'analytics':     result = getAnalytics(e.parameter.range || '7d'); break;
      case 'checkPin':      result = checkPin(e.parameter.pin);                break;
      case 'orderedToday':  result = getOrderedToday();                        break;
      case 'orderedItemsToday': result = getOrderedItemsToday();               break;
      case 'confirmedToday':result = getConfirmedToday();                     break;
      default:              result = { error: 'unknown action: ' + action };
    }
  } catch (err) {
    // ใส่ชื่อ action + stack trace ไปด้วย เพื่อไล่หาต้นตอง่ายกว่าดูแค่ err.message เฉยๆ
    // เห็นได้ทั้งใน Executions log (Logger.log) และในข้อความ error ที่ขึ้นหน้าเว็บ
    Logger.log('doGet [' + action + '] error: ' + err.stack);
    result = { error: '[' + action + '] ' + err.message };
  }
  return jsonOut(result);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  let result;
  try {
    switch (body.action) {
      case 'saveStock':        result = saveStock(body);        break;
      case 'createOrderBatch': result = createOrderBatch(body); break;
      case 'saveProductPhotos':result = saveProductPhotosBatch(body); break;
      case 'saveStaffAvatar':  result = saveStaffAvatar(body);  break;
      case 'addProduct':       result = addProductFromApp(body); break;
      case 'setSupplierCoverPhoto': result = setSupplierCoverPhoto(body); break;
      case 'setSupplierOrderConfirm': result = setSupplierOrderConfirm(body); break;
      case 'setProductSkipDate': result = setProductSkipDate(body);   break;
      case 'setUnitLabel':      result = setUnitLabel(body);      break;
      case 'setOrderUnitLabel': result = setOrderUnitLabel(body); break;
      default:                 result = { error: 'unknown action: ' + body.action };
    }
  } catch (err) {
    Logger.log('doPost [' + body.action + '] error: ' + err.stack);
    result = { error: '[' + body.action + '] ' + err.message };
  }
  return jsonOut(result);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ sheet helpers ============ */
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
// อ่านค่าคอลัมน์ boolean-like (เช่น Active) ให้ปลอดภัยเสมอ — เซลล์ checkbox จริงจะได้ boolean primitive
// อยู่แล้ว ปลอดภัย แต่ถ้ามีใครพิมพ์ "FALSE" เป็นข้อความตรงๆ ลงเซลล์แทนติ๊ก checkbox (เช่น เพิ่มแถวใหม่มือ
// ในชีตแล้ว copy รูปแบบมาแบบไม่ทันสังเกตว่าคอลัมน์นั้นควรเป็น checkbox) โค้ดเดิมที่เช็คแบบ `.filter(x =>
// x.Active)` ตรงๆ จะพังเงียบๆ เพราะ string "FALSE" ที่ไม่ว่างเปล่าเป็น truthy ใน JS เสมอ (Boolean("FALSE")
// === true) ทำให้แถวที่ตั้งใจปิดใช้งานไว้ (สินค้าเลิกขาย/ซัพพลายเออร์เลิกทำ/พนักงานลาออก) กลับโผล่มาใช้งาน
// อยู่ดี ฟังก์ชันนี้ตีความ "FALSE"/false/0/"" (ไม่สนตัวพิมพ์เล็กใหญ่ ตัดช่องว่างก่อน) เป็น false เสมอ
function isActiveFlag(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s !== '' && s !== 'false' && s !== '0';
}
// อ่านค่าคอลัมน์ SkipDates จาก cell ให้ปลอดภัยเสมอ ไม่ว่า Google Sheets จะเก็บเป็น text ปกติ
// ("2026-09-01,2026-09-02") หรือดันไปตีความเป็น Date object เอง — ถ้ามีใครพิมพ์วันที่ลงเซลล์นี้ตรงๆ
// ผ่านหน้า Sheets (ไม่ผ่านแอป) Sheets จะเห็นว่าหน้าตาเหมือนวันที่แล้วแปลง type ของเซลล์เป็น Date ให้เอง
// พอ Apps Script อ่านออกมาด้วย getValues() เลยได้ Date object จริงๆ กลับมา ไม่ใช่ string — ถ้าเอาไป
// String(cell) ตรงๆ (ที่นี่และใน setProductSkipDate เดิม) จะได้ toString() เต็มรูปแบบ เช่น
// "Tue Sep 01 2026 07:00:00 GMT+0700 (เวลาอินโดจีน)" ซึ่งไม่มีทางตรงกับ todayISODate() ของฝั่งเว็บได้เลย
// (เทียบสตริงตรงๆ) ทำให้สินค้าที่เจ้าของตั้งงดไว้ไม่ขึ้นเตือนฝั่งลูกจ้าง (บั๊กที่เจอจริง 1 ก.ย. 2569)
// ฟังก์ชันนี้แปลงกลับเป็น yyyy-MM-dd ให้เสมอ ทั้งกรณีเจอ Date object ตรงๆ หรือ string ที่มีค่าเพี้ยนแบบนี้
// ปนมาจากการอ่าน/เขียนทับซ้ำในอดีต (parse ย้อนกลับได้ เพราะ toString() ของ Date เป็นฟอร์แมตที่ new Date()
// อ่านกลับเข้าใจ) ใช้ร่วมกันทั้ง bootstrap() และ setProductSkipDate() กันจุดเดิมพังซ้ำอีกจากทั้งสองทาง
function normalizeSkipDatesCell(raw) {
  if (raw instanceof Date) return [Utilities.formatDate(raw, TZ, 'yyyy-MM-dd')];
  // dedupe ด้วย — กรณีมีทั้งค่าที่สะอาดอยู่แล้วกับค่าเพี้ยนที่ซ่อมกลับมาได้ตรงวันเดียวกันปนกัน (เช่น
  // "2026-09-01,Tue Sep 01 2026 07:00:00 GMT+0700 (เวลาอินโดจีน)" ทั้งคู่คือ 1 ก.ย. เหมือนกัน) ไม่งั้น
  // เขียนกลับไปจะซ้ำกันเปล่าๆ
  return [...new Set(String(raw || '').split(',').map(d => d.trim()).filter(Boolean).map(d => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const parsed = new Date(d);
    return isNaN(parsed) ? d : Utilities.formatDate(parsed, TZ, 'yyyy-MM-dd');
  }))];
}
function appendRow(name, obj, headers) {
  const sh = SHEET.getSheetByName(name);
  sh.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
}
// คืนชีตตามชื่อ ถ้ายังไม่มีให้สร้างใหม่พร้อมแถวหัวตาราง — ใช้กับชีตที่ระบบสร้าง/ดูแลเอง
// (ไม่ต้องให้เจ้าของสร้างมือก่อนใช้งาน ต่างจาก SUPPLIER_ORDER_CONFIRM_SHEET ที่ยัง throw ให้สร้างเอง)
function ensureSheetWithHeaders(name, headers) {
  let sh = SHEET.getSheetByName(name);
  if (!sh) {
    sh = SHEET.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}
function todayStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
// Google Sheets มักแปลง string วันที่ ("2026-08-27") ที่เขียนลงคอลัมน์ Date ให้กลาย
// เป็น Date object อัตโนมัติ — ถ้าเทียบด้วย === ตรงๆ กับ string จาก todayStr() จะไม่ตรงกันเลย
// ฟังก์ชันนี้ normalize ทั้งสองแบบให้เป็น string รูปแบบเดียวกันก่อนเทียบ
function normDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v).trim();
}
function nextId(prefix, name, idField) {
  const rows = readTable(name);
  const max = rows.reduce((m, r) => {
    const n = parseInt(String(r[idField]).replace(/\D/g, ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return prefix + String(max + 1).padStart(5, '0');
}

/* ============ bootstrap ============ */
function bootstrap() {
  const cached = cacheGet('bootstrap');
  if (cached) return cached;

  const suppliers = readTable('Suppliers').filter(s => isActiveFlag(s.Active));
  const productsRaw = readTable(PRODUCT_SHEET_NAME).filter(p => isActiveFlag(p.Active));
  const units = readTable('ProductUnits');
  const staff = readTable('Staff').filter(s => isActiveFlag(s.Active));

  const products = productsRaw.map(p => ({
    id: p.ProductID, supplierId: p.SupplierID, name: p.Name,
    orderUnit: p.OrderUnit,
    photoUrl: p.PhotoURL || null,
    // SkipDates: คอลัมน์ใหม่ในชีต Product (Actual) เก็บวันที่ (yyyy-MM-dd) ที่เจ้าของกดงดสั่ง/งดเช็ค
    // สินค้าตัวนี้ไว้เป็นครั้งคราว (เช่น ซัพพลายเออร์แจ้งว่าโรงงานหยุดวันนั้น) คั่นด้วยคอมม่า
    // ไม่ใช่กฎประจำสัปดาห์แบบ OrderDays — ตั้ง/ยกเลิกได้จากหน้าสั่งของฝั่งเจ้าของผ่าน setProductSkipDate
    skipDates: normalizeSkipDatesCell(p.SkipDates),
    units: units.filter(u => String(u.ProductID).trim() === String(p.ProductID).trim())
                .sort((a, b) => a.SortOrder - b.SortOrder)
                // orderLabel: ป้ายที่ใช้ตอนสั่งของกับซัพพลายเออร์ (คอลัมน์ OrderLabel แยกจาก UnitLabel
                // ที่ลูกจ้างใช้เช็คสต๊อก) — การ || ตรงนี้เป็นแค่ safety net เผื่อมีแถวหลุดรอดไม่มีค่า
                // OrderLabel จริงๆ (เช่น เพิ่มแถวมือในชีตตรงๆ ไม่ผ่านแอป) ไม่ใช่พฤติกรรมหลักที่ตั้งใจ —
                // สินค้าทุกตัวควรมี OrderLabel ของตัวเองอยู่แล้วเสมอ (ตั้งตอนสร้างสินค้าใหม่ผ่าน
                // addProductFromApp/submitNewProduct, หรือรัน backfillOrderLabels() ครั้งเดียวให้สินค้าเก่า)
                // ถ้ายังพึ่ง fallback นี้อยู่แปลว่าแก้ UnitLabel ฝั่งเช็คสต๊อกจะยังไปเปลี่ยน orderLabel ที่
                // เห็นอยู่ด้วย (บั๊กที่เจอจริง 4 ก.ย. 69 — เกิดเพราะตอนนั้นยังไม่ได้รัน backfill)
                .map(u => ({ id: u.UnitID, label: u.UnitLabel, orderLabel: u.OrderLabel || u.UnitLabel, imageUrl: u.UnitImageURL }))
  }));

  const result = {
    // OrderDays: คอลัมน์ใหม่ในชีต Suppliers เก็บวันที่เจ้านี้ถึงรอบสั่งของ คั่นด้วยคอมม่า
    // ใส่เป็นชื่อวันภาษาอังกฤษ เช่น "Mon" หรือ "Mon,Thu" (ตัวย่อ 3 ตัวหรือเต็มก็ได้ ไม่สนตัวพิมพ์เล็ก/ใหญ่)
    // — เว้นว่างได้ถ้าเจ้านั้นสั่งได้ทุกวัน/ไม่ได้กำหนดรอบตายตัว
    // StockupNotes: คอลัมน์ใหม่ในชีต Suppliers เก็บโน้ต "สั่งเผื่อ" ที่กำหนดเอง (ไม่ใช่คำนวณอัตโนมัติ
    // จาก OrderDays อีกต่อไป เพราะแต่ละเจ้าตกลงกับร้านไว้ไม่เหมือนกัน) ฟอร์แมต "วัน:ข้อความ" คั่นด้วย ;
    // เช่น "Tue:×3 สั่งเผื่อ;Fri:×4 สั่งเผื่อ" หรือ "Sat:ส่งจันทร์" (ไม่จำเป็นต้องเป็นตัวคูณเสมอไป)
    suppliers: suppliers.map(s => {
      const stockupNotes = {};
      String(s.StockupNotes || '').split(';').forEach(pair => {
        const idx = pair.indexOf(':');
        if (idx === -1) return;
        const day = pair.slice(0, idx).trim();
        const note = pair.slice(idx + 1).trim();
        if (day && note) stockupNotes[day] = note;
      });
      return {
        id: s.SupplierID, name: s.Name, imageUrl: s.SupplierImageURL || null,
        orderDays: String(s.OrderDays || '').split(',').map(d => d.trim()).filter(Boolean),
        stockupNotes
      };
    }),
    products,
    staff: staff.map(s => ({ id: s.StaffID, name: s.Name, avatar: s.AvatarLabel, avatarUrl: s.AvatarURL || null }))
  };
  cacheSet('bootstrap', result, CACHE_TTL.bootstrap);
  return result;
}

/* ============ saveStock ============ */
function saveStock(body) {
  const headers = ['LogID','Date','UnitID','RemainQty','CheckedBy','Timestamp','OrderTriggered'];
  const date = todayStr();
  const sh = SHEET.getSheetByName('StockLogs');

  // เดิมอ่านทั้งชีต StockLogs ทุกครั้ง (readTable) แค่เพื่อหาเลข LogID ถัดไป
  // ยิ่งชีตสะสมข้อมูลนานวันยิ่งช้า — เปลี่ยนมาใช้ตัวนับแยกต่างหากแทน ไม่ต้องอ่านทั้งชีตอีกต่อไป
  let nextNum = reserveIdBlock('LogID_COUNTER', body.items.length);
  const ts = new Date().toISOString();

  const newRows = body.items.map(item => {
    const obj = { LogID: 'L' + String(nextNum++).padStart(5, '0'), Date: date,
      UnitID: item.unitId, RemainQty: item.remainQty,
      CheckedBy: body.staffName, Timestamp: ts, OrderTriggered: false };
    return headers.map(h => obj[h] !== undefined ? obj[h] : '');
  });

  if (newRows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  // เขียนทับ "แถวล่าสุดต่อหน่วย" ในชีตแยกด้วย (ดู STOCK_LOGS_LATEST_SHEET ด้านบน)
  // เพื่อให้ getStockStatus() อ่านชีตขนาดคงที่นี้แทนการอ่านทั้ง StockLogs ที่โตขึ้นเรื่อยๆ
  if (body.items.length) {
    upsertStockLogsLatest(body.items, date, body.staffName, ts);
  }

  if (body.photos && body.photos.length) {
    savePhotos(body.photos);
  }

  cacheClear('stockStatus_' + date);
  return { ok: true };
}

// อัปเดต/เพิ่มแถวใน StockLogsLatest ให้เหลือ 1 แถวต่อ 1 UnitID เสมอ (เขียนทับแถวเดิมถ้ามี)
// ขนาดชีตนี้จึงคงที่เท่าจำนวนหน่วยสินค้าทั้งหมด ไม่โตขึ้นตามจำนวนครั้งที่เช็คสต๊อกเหมือน StockLogs
function upsertStockLogsLatest(items, date, staffName, ts) {
  const headers = ['UnitID', 'Date', 'RemainQty', 'CheckedBy', 'Timestamp'];
  const sh = ensureSheetWithHeaders(STOCK_LOGS_LATEST_SHEET, headers);
  const data = sh.getDataRange().getValues();

  const rowByUnit = {};
  for (let i = 1; i < data.length; i++) {
    const uid = String(data[i][0]).trim();
    if (uid) rowByUnit[uid] = i + 1; // เลขแถวจริงในชีต (1-indexed)
  }

  const toAppend = [];
  items.forEach(item => {
    const uid = String(item.unitId).trim();
    const rowValues = [uid, date, item.remainQty, staffName, ts];
    if (rowByUnit[uid]) {
      sh.getRange(rowByUnit[uid], 1, 1, headers.length).setValues([rowValues]);
    } else {
      toAppend.push(rowValues);
    }
  });

  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }
}

/* ============ savePhotos ============ */
function savePhotos(photos) {
  const folder = DriveApp.getFolderById(PRODUCT_PHOTOS_FOLDER_ID);
  const sh = SHEET.getSheetByName(PRODUCT_SHEET_NAME);
  const data = sh.getDataRange().getValues();
  const headerRow = data[0];
  const idCol = headerRow.indexOf('ProductID');
  const photoCol = headerRow.indexOf('PhotoURL');

  if (idCol === -1 || photoCol === -1) {
    throw new Error('ไม่พบคอลัมน์ ProductID หรือ PhotoURL ในชีต Products — เช็คขั้นตอนที่ 2 อีกที');
  }

  photos.forEach(({ productId, photo }) => {
    const base64 = photo.split(',')[1]; // ตัด "data:image/jpeg;base64," ออก
    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64), 'image/jpeg', productId + '.jpg'
    );
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const photoUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]).trim() === String(productId).trim()) {
        sh.getRange(i + 1, photoCol + 1).setValue(photoUrl);
        break;
      }
    }
  });
}

/* ============ saveProductPhotosBatch ============ */
// ใช้กับหน้า "จับคู่รูปกับสินค้า" — เจ้าของเลือกรูปจากเครื่อง จับคู่กับ ProductID แล้วอัปโหลดพร้อมกันหลายรูป
// รับ body = { photos: [{ productId, photo }] } — รูปแบบเดียวกับ savePhotos เดิม แยกฟังก์ชันไว้เพื่อให้เรียกจาก action คนละอันชัดเจน
function saveProductPhotosBatch(body) {
  if (!body.photos || !body.photos.length) {
    throw new Error('ไม่มีรูปที่จะบันทึก');
  }
  savePhotos(body.photos);
  cacheClear('bootstrap');
  return { ok: true, count: body.photos.length };
}

/* ============ saveStaffAvatar ============ */
// รับ body = { staffId, photo } — photo เป็น base64 data URL จากกล้อง/แกลเลอรี
// อัปโหลดเข้า STAFF_PHOTOS_FOLDER_ID แล้วเขียน URL กลับลงคอลัมน์ AvatarURL ในชีต Staff
function saveStaffAvatar(body) {
  if (!body.staffId || !body.photo) {
    throw new Error('ข้อมูลไม่ครบ (staffId หรือ photo หายไป)');
  }
  const folder = DriveApp.getFolderById(STAFF_PHOTOS_FOLDER_ID);
  const sh = SHEET.getSheetByName('Staff');
  const data = sh.getDataRange().getValues();
  const headerRow = data[0];
  const idCol = headerRow.indexOf('StaffID');
  const avatarCol = headerRow.indexOf('AvatarURL');

  if (idCol === -1 || avatarCol === -1) {
    throw new Error('ไม่พบคอลัมน์ StaffID หรือ AvatarURL ในชีต Staff — เช็คว่าเพิ่มคอลัมน์ AvatarURL แล้วหรือยัง');
  }

  const base64 = body.photo.split(',')[1];
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64), 'image/jpeg', body.staffId + '.jpg'
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const avatarUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();

  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(body.staffId).trim()) {
      sh.getRange(i + 1, avatarCol + 1).setValue(avatarUrl);
      found = true;
      break;
    }
  }
  if (!found) throw new Error('ไม่พบ StaffID นี้ในชีต Staff: ' + body.staffId);

  cacheClear('bootstrap');
  return { ok: true, avatarUrl };
}

/* ============ setSupplierCoverPhoto ============ */
// ตั้งรูปปกของซัพพลายเออร์ 1 เจ้า โดย "ยืม" รูปสินค้าที่มีอยู่แล้ว (ไม่อัปโหลดไฟล์ใหม่)
// body = { supplierId, photoUrl } — photoUrl มาจาก product.photoUrl ที่มีอยู่แล้วในหน้าเช็คสต๊อก
// เขียนทับ SupplierImageURL เดิมได้เรื่อยๆ ถ้าอยากเปลี่ยนไปใช้รูปสินค้าชิ้นอื่นแทน
function setSupplierCoverPhoto(body) {
  if (!body.supplierId || !body.photoUrl) {
    throw new Error('ข้อมูลไม่ครบ (supplierId หรือ photoUrl หายไป)');
  }
  const sh = SHEET.getSheetByName('Suppliers');
  const data = sh.getDataRange().getValues();
  const headerRow = data[0];
  const idCol = headerRow.indexOf('SupplierID');
  const imageCol = headerRow.indexOf('SupplierImageURL');

  if (idCol === -1 || imageCol === -1) {
    throw new Error('ไม่พบคอลัมน์ SupplierID หรือ SupplierImageURL ในชีต Suppliers');
  }

  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(body.supplierId).trim()) {
      sh.getRange(i + 1, imageCol + 1).setValue(body.photoUrl);
      found = true;
      break;
    }
  }
  if (!found) throw new Error('ไม่พบ SupplierID นี้ในชีต Suppliers: ' + body.supplierId);

  cacheClear('bootstrap');
  return { ok: true, imageUrl: body.photoUrl };
}

/* ============ getStockStatus ============ */
// เดิมอ่านทั้งชีต StockLogs (ทุกวันตั้งแต่เริ่มระบบ) แล้วมากรองเอาเฉพาะวันนี้ทีหลัง — ยิ่งชีตสะสม
// นานวันยิ่งอ่านช้า ตอนนี้เปลี่ยนมาอ่าน StockLogsLatest แทน ซึ่งมีแค่ 1 แถวต่อ 1 หน่วยสินค้า (เขียนทับ
// แถวเดิมทุกครั้งที่เช็คใหม่ ดู upsertStockLogsLatest) ขนาดชีตจึงคงที่เท่าจำนวนหน่วยสินค้าทั้งหมด
// ไม่โตขึ้นตามเวลาเหมือน StockLogs — เร็วคงที่ไม่ว่าจะผ่านไปกี่เดือน
function getStockStatus() {
  const date = todayStr();
  const cacheKey = 'stockStatus_' + date;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const latestSh = SHEET.getSheetByName(STOCK_LOGS_LATEST_SHEET);
  const latestRows = latestSh ? readTable(STOCK_LOGS_LATEST_SHEET) : [];
  const units = readTable('ProductUnits');
  const products = readTable(PRODUCT_SHEET_NAME).filter(p => isActiveFlag(p.Active));

  const latestByUnit = {};
  latestRows.forEach(l => {
    // ชีตนี้เก็บแค่แถวล่าสุดของแต่ละหน่วย ไม่ใช่ทุกวัน — ต้องเช็ค Date ด้วยว่าเป็นของ "วันนี้" จริง
    // ไม่งั้นหน่วยที่เช็คครั้งล่าสุดเมื่อวานจะโผล่เป็น "เช็คแล้ว" ของวันนี้ผิดๆ
    if (normDate(l.Date) === date) latestByUnit[String(l.UnitID).trim()] = l;
  });

  const result = products.map(p => {
    const us = units.filter(u => String(u.ProductID).trim() === String(p.ProductID).trim());
    const checked = us.length > 0 && us.every(u => latestByUnit[String(u.UnitID).trim()]);
    const remain = {};
    us.forEach(u => {
      const l = latestByUnit[String(u.UnitID).trim()];
      remain[u.UnitID] = l ? l.RemainQty : null;
    });
    return { productId: p.ProductID, checked, remain };
  });

  cacheSet(cacheKey, result, CACHE_TTL.stockStatus);
  return result;
}

/* ============ createOrderBatch ============ */
function createOrderBatch(body) {
  const batchId = 'B' + Utilities.formatDate(new Date(), TZ, 'MMdd-HHmmss');
  const date = todayStr();
  const headers = ['OrderID','OrderBatchID','Date','ProductID','Forecast','OrderQty','RateUsed','OrderUnit'];

  // เดิมอ่านทั้งชีต OrderLogs (readTable) เพื่อหาเลข OrderID ถัดไป — เปลี่ยนมาใช้ตัวนับแยกแทน เหมือน saveStock
  let nextNum = reserveIdBlock('OrderID_COUNTER', body.items.length);

  const newRows = body.items.map(item => {
    const obj = {
      OrderID: 'O' + String(nextNum).padStart(5, '0'),
      OrderBatchID: batchId, Date: date, ProductID: item.productId,
      Forecast: item.forecast, OrderQty: item.orderQty,
      RateUsed: item.rateUsed, OrderUnit: item.orderUnit
    };
    nextNum++;
    return headers.map(h => obj[h] !== undefined ? obj[h] : '');
  });

  // เขียนทีเดียวเป็นก้อนเดียว แทน appendRow ทีละแถว
  const sh = SHEET.getSheetByName('OrderLogs');
  sh.getRange(sh.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);

  // อัปเดต OrderTriggered ของ StockLogs วันนี้ทีเดียว แทน setValue ทีละเซลล์ในลูป
  const stockSh = SHEET.getSheetByName('StockLogs');
  const rows = stockSh.getDataRange().getValues();
  const headerRow = rows[0];
  const dateCol = headerRow.indexOf('Date');
  const triggeredCol = headerRow.indexOf('OrderTriggered');
  const triggeredValues = [];
  let hasToday = false;
  for (let i = 1; i < rows.length; i++) {
    if (normDate(rows[i][dateCol]) === date) { triggeredValues.push([true]); hasToday = true; }
    else triggeredValues.push([rows[i][triggeredCol]]);
  }
  if (hasToday) {
    stockSh.getRange(2, triggeredCol + 1, triggeredValues.length, 1).setValues(triggeredValues);
  }

  cacheClear('analytics_7d');
  cacheClear('analytics_30d');
  return { ok: true, batchId };
}

/* ============ getAnalytics ============ */
// เดิมไม่มีแคชเลย อ่านทั้งชีต OrderLogs+Products ใหม่ทุกครั้งที่เปิดหน้า analytics แม้เพิ่งเปิดไปเมื่อครู่
// และหา product ด้วย .find() ต่อ order (O(orders × products)) — เพิ่มแคช 2 นาที + สร้าง Map ของ
// products ไว้ล่วงหน้าครั้งเดียวแทน
function getAnalytics(range) {
  const cacheKey = 'analytics_' + range;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const days = range === '30d' ? 30 : 7;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const orders = readTable('OrderLogs').filter(o => new Date(o.Date) >= cutoff);
  const products = readTable(PRODUCT_SHEET_NAME);
  const productById = {};
  products.forEach(p => { productById[String(p.ProductID).trim()] = p; });

  const byProduct = {};
  orders.forEach(o => { byProduct[o.ProductID] = (byProduct[o.ProductID] || 0) + Number(o.OrderQty); });

  const ranked = Object.keys(byProduct).map(pid => {
    const p = productById[String(pid).trim()];
    return { productId: pid, name: p ? p.Name : pid, total: byProduct[pid] };
  }).sort((a, b) => b.total - a.total);

  const bySupplier = {};
  orders.forEach(o => {
    const p = productById[String(o.ProductID).trim()];
    if (!p) return;
    bySupplier[p.SupplierID] = (bySupplier[p.SupplierID] || 0) + Number(o.OrderQty);
  });

  const result = { topProducts: ranked.slice(0, 10), bottomProducts: ranked.slice(-10).reverse(), bySupplier };
  cacheSet(cacheKey, result, CACHE_TTL.analytics);
  return result;
}

/* ============ checkPin ============ */
function checkPin(pin) {
  const settings = readTable('Settings');
  const row = settings.find(s => String(s.Key).trim().toLowerCase() === 'pin');
  // ถ้าเซลล์ Value ถูกพิมพ์เป็นตัวเลขล้วนๆ (ไม่ได้ตั้ง format เป็นข้อความ) Sheets จะเก็บเป็น Number จริง
  // ไม่ใช่ข้อความ — เลข 0 นำหน้าจะหายไปเงียบๆ (เช่น "0472" กลายเป็น 472) ทำให้เทียบกับรหัส 4 หลักที่กรอก
  // จากหน้าเว็บ (input maxlength="4") ไม่ตรงกันตลอดแม้พิมพ์รหัสถูกจริงๆ เติม 0 ข้างหน้าให้ครบ 4 หลักเสมอ
  // เฉพาะตอนที่เซลล์เป็น Number เท่านั้น (ถ้าตั้ง format เป็นข้อความไว้แต่แรกจะได้ string ที่ถูกต้องอยู่แล้ว
  // ไม่ต้องเติม)
  const storedPin = row
    ? (typeof row.Value === 'number' ? String(row.Value).padStart(4, '0') : String(row.Value).trim())
    : '';
  return { valid: storedPin !== '' && String(pin).trim() === storedPin };
}

function fillProductUnits() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const products = ss.getSheetByName(PRODUCT_SHEET_NAME).getDataRange().getValues();
  const unitsSheet = ss.getSheetByName('ProductUnits');
  const existing = unitsSheet.getDataRange().getValues()
    .slice(1).map(r => r[1]); // column B = ProductID

  let nextNum = 2; // U001 มีแล้ว เริ่มที่ U002
  const toAdd = [];

  products.slice(1).forEach(row => {
    const pid = row[0];      // ProductID
    const label = row[3];    // OrderUnit (โล)
    if (!pid || existing.includes(pid)) return;
    const uid = 'U' + String(nextNum).padStart(3, '0');
    toAdd.push([uid, pid, label, '', 1]);
    nextNum++;
  });

  if (toAdd.length > 0) {
    unitsSheet.getRange(unitsSheet.getLastRow() + 1, 1, toAdd.length, 5).setValues(toAdd);
    Logger.log(`เพิ่ม ${toAdd.length} แถว`);
  }
}

function authorizeDriveAccess() {
  const folder = DriveApp.getFolderById(PRODUCT_PHOTOS_FOLDER_ID);
  const testFile = folder.createFile('test.txt', 'ทดสอบสิทธิ์เขียนไฟล์');
  testFile.setTrashed(true); // ลบไฟล์ทดสอบทิ้งทันที
}

/* ============ เมนู "เพิ่มสินค้าใหม่" ============ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('เครื่องมือ')
    .addItem('เพิ่มสินค้าใหม่', 'showAddProductDialog')
    .addToUi();
}

function showAddProductDialog() {
  const html = HtmlService.createHtmlOutput(getAddProductFormHtml())
    .setWidth(420).setHeight(460);
  SpreadsheetApp.getUi().showModalDialog(html, 'เพิ่มสินค้าใหม่');
}

function nextProductId() {
  const rows = readTable(PRODUCT_SHEET_NAME);
  const max = rows.reduce((m, r) => {
    const n = parseInt(String(r.ProductID).replace(/\D/g, ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return 'P' + String(max + 1).padStart(3, '0');
}

function nextUnitId() {
  const rows = readTable('ProductUnits');
  const max = rows.reduce((m, r) => {
    const n = parseInt(String(r.UnitID).replace(/\D/g, ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return 'U' + String(max + 1).padStart(3, '0');
}

function getAddProductFormHtml() {
  const previewId = nextProductId();
  const suppliers = readTable('Suppliers').filter(s => isActiveFlag(s.Active));
  const options = suppliers.map(s => `<option value="${s.SupplierID}">${s.Name}</option>`).join('');
  return `
    <style>
      body{font-family:Arial, sans-serif; font-size:13px; padding:4px;}
      label{display:block; margin:10px 0 4px; font-weight:bold;}
      input, select{width:100%; padding:6px; box-sizing:border-box; font-size:13px;}
      .id-preview{background:#f1f3f4; padding:8px; border-radius:6px; margin-bottom:6px;}
      button{margin-top:16px; width:100%; padding:10px; background:#1a73e8; color:#fff; border:none; border-radius:6px; font-size:14px; cursor:pointer;}
      button:disabled{background:#aaa;}
      #msg{margin-top:10px;}
    </style>
    <div class="id-preview">รหัสสินค้าใหม่ (อัตโนมัติ): <b>${previewId}</b></div>
    <label>ซัพพลายเออร์</label>
    <select id="supplierId">${options}</select>
    <label>ชื่อสินค้า</label>
    <input id="name" type="text" placeholder="เช่น ไส้กรอกไก่จัมโบ้">
    <label>หน่วยสั่งของ (เช่น โล, แพ็ค, ลัง)</label>
    <input id="orderUnit" type="text" value="โล">
    <label>ราคาต่อหน่วย (บาท)</label>
    <input id="price" type="number" value="0">
    <button id="submitBtn" onclick="submitForm()">บันทึกสินค้าใหม่</button>
    <div id="msg"></div>
    <script>
      function submitForm(){
        const btn = document.getElementById('submitBtn');
        btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
        const data = {
          supplierId: document.getElementById('supplierId').value,
          name: document.getElementById('name').value.trim(),
          orderUnit: document.getElementById('orderUnit').value.trim(),
          price: Number(document.getElementById('price').value) || 0
        };
        if(!data.name){
          document.getElementById('msg').style.color = '#c00';
          document.getElementById('msg').textContent = 'กรุณากรอกชื่อสินค้า';
          btn.disabled = false; btn.textContent = 'บันทึกสินค้าใหม่';
          return;
        }
        google.script.run
          .withSuccessHandler(function(res){
            document.getElementById('msg').style.color = '#0a0';
            document.getElementById('msg').textContent = 'บันทึกสำเร็จ: ' + res.productId + ' — ปิดหน้าต่างนี้ได้เลย';
          })
          .withFailureHandler(function(err){
            document.getElementById('msg').style.color = '#c00';
            document.getElementById('msg').textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
            btn.disabled = false; btn.textContent = 'บันทึกสินค้าใหม่';
          })
          .submitNewProduct(data);
      }
    </script>
  `;
}

/* ============ addProductFromApp ============ */
// เพิ่มสินค้าใหม่จากหน้าเว็บมือถือ (หน้างานจริง) — ใช้ตรรกะเดียวกับ submitNewProduct
// (ฟอร์มฝั่ง Sheets เดิม) แต่รับ supplierId มาจากหน้าซัพพลายเออร์ที่กำลังเปิดอยู่ ไม่ต้องเลือกเอง
// body = { supplierId, name, orderUnit, costPrice }
function addProductFromApp(body) {
  if (body.staffName !== PRIVILEGED_STAFF_NAME) throw new Error('ไม่มีสิทธิ์เพิ่มสินค้า');
  if (!body.supplierId || !body.name || !body.orderUnit || !body.costPrice) {
    throw new Error('ข้อมูลไม่ครบ (ต้องมีชื่อสินค้า หน่วยสั่งของ และราคาทุน)');
  }
  const productId = nextProductId();
  appendRowByHeaders(PRODUCT_SHEET_NAME, {
    ProductID: productId,
    SupplierID: body.supplierId,
    Name: body.name,
    OrderUnit: body.orderUnit,
    Active: true,
    PricePerOrderUnit: Number(body.costPrice),
    PriceUpdatedDate: todayStr(),
    PhotoURL: ''
  });

  const unitId = nextUnitId();
  // ตั้ง OrderLabel ให้เท่ากับ UnitLabel ตั้งแต่สร้างแถวเลย (ไม่ปล่อยว่างให้พึ่ง fallback ตอนอ่าน) —
  // กันปัญหาที่ orderLabel จะยัง "โยง" กับ UnitLabel อยู่จนกว่าเจ้าของจะมากดตั้งชื่อเองสักครั้ง
  // ดู getOrCreateOrderLabelCol() และ backfillOrderLabels() สำหรับสินค้าเก่าที่สร้างไว้ก่อนหน้านี้
  const unitsSh = SHEET.getSheetByName('ProductUnits');
  const unitsHeaders = unitsSh.getDataRange().getValues()[0];
  getOrCreateOrderLabelCol(unitsSh, unitsHeaders);
  appendRowByHeaders('ProductUnits', {
    UnitID: unitId,
    ProductID: productId,
    UnitLabel: body.orderUnit,
    OrderLabel: body.orderUnit,
    UnitImageURL: '',
    SortOrder: 1
  });

  cacheClear('bootstrap');
  return {
    ok: true,
    product: {
      id: productId, supplierId: body.supplierId, name: body.name,
      orderUnit: body.orderUnit,
      photoUrl: null,
      units: [{ id: unitId, label: body.orderUnit, orderLabel: body.orderUnit, imageUrl: '' }]
    }
  };
}

function appendRowByHeaders(sheetName, valuesByHeader) {
  const sh = SHEET.getSheetByName(sheetName);
  const headers = sh.getDataRange().getValues()[0];
  const row = headers.map(h => valuesByHeader[h] !== undefined ? valuesByHeader[h] : '');
  sh.appendRow(row);
}

function submitNewProduct(data) {
  const productId = nextProductId();
  appendRowByHeaders(PRODUCT_SHEET_NAME, {
    ProductID: productId,
    SupplierID: data.supplierId,
    Name: data.name,
    OrderUnit: data.orderUnit,
    Active: true,
    PricePerOrderUnit: data.price,
    PriceUpdatedDate: todayStr(),
    PhotoURL: ''
  });

  // เหตุผลเดียวกับ addProductFromApp() ด้านบน — ตั้ง OrderLabel ตั้งแต่สร้างแถว ไม่ปล่อยว่าง
  const unitsSh = SHEET.getSheetByName('ProductUnits');
  const unitsHeaders = unitsSh.getDataRange().getValues()[0];
  getOrCreateOrderLabelCol(unitsSh, unitsHeaders);
  appendRowByHeaders('ProductUnits', {
    UnitID: nextUnitId(),
    ProductID: productId,
    UnitLabel: data.orderUnit,
    OrderLabel: data.orderUnit,
    UnitImageURL: '',
    SortOrder: 1
  });

  cacheClear('bootstrap');
  return { ok: true, productId };
}

/* ============ getOrderedToday ============ */
function getOrderedToday() {
  const date = todayStr();
  const orders = readTable('OrderLogs').filter(o => normDate(o.Date) === date);
  const productIds = [...new Set(orders.map(o => String(o.ProductID).trim()))];
  return { productIds };
}

/* ============ getOrderedItemsToday ============ */
// เหมือน getOrderedToday แต่คืนจำนวน+หน่วยที่สั่งด้วย (ไม่ใช่แค่ ProductID) — ใช้กับปุ่ม
// "ดูข้อความที่สั่งไปอีกครั้ง" ในหน้าสั่งของ ให้เจ้าของกลับไปดู/คัดลอกข้อความสั่งของที่เคยสร้างไปแล้ว
// วันนี้ได้อีกครั้ง โดยไม่ต้องเลือกรายการ+กดสั่งใหม่ทั้งหมด ใช้ได้กับออเดอร์ที่สั่งไปแล้วก่อนเปิดแอป
// รอบนี้ด้วย เพราะอ่านจาก OrderLogs ตรงๆ ไม่ได้พึ่งข้อมูลที่จำไว้ในเครื่อง — ถ้าสินค้าตัวเดียวกันถูก
// สั่งมากกว่า 1 รอบในวันนี้ ใช้ค่าจากรอบล่าสุด (แถวหลังสุดของวันนั้นในชีต ชนะแถวก่อนหน้าเสมอ)
function getOrderedItemsToday() {
  const date = todayStr();
  const rows = readTable('OrderLogs').filter(o => normDate(o.Date) === date);
  const latestByProduct = {};
  rows.forEach(r => { latestByProduct[String(r.ProductID).trim()] = r; });
  return {
    items: Object.values(latestByProduct).map(r => ({
      productId: r.ProductID, orderQty: r.OrderQty, orderUnit: r.OrderUnit
    }))
  };
}

/* ============ getConfirmedToday / setSupplierOrderConfirm ============ */
// แยกจาก getOrderedToday: "สั่งแล้ว" (OrderLogs) แปลว่าแอปสร้างข้อความ/บันทึกคำสั่งซื้อให้แล้ว
// ส่วนอันนี้คือ "ยืนยันด้วยมือว่าส่งข้อความไปหา supplier จริงแล้ว" (เช่น กดส่งในไลน์แล้ว)
// เก็บแยกชีตเพราะเป็น flag ที่คนกดยืนยันเอง ไม่ได้เกิดขึ้นอัตโนมัติเหมือน OrderLogs
function getConfirmedToday() {
  const date = todayStr();
  const rows = readTable(SUPPLIER_ORDER_CONFIRM_SHEET).filter(r => normDate(r.Date) === date);
  return { supplierIds: [...new Set(rows.map(r => String(r.SupplierID).trim()))] };
}

// body = { supplierId, confirmed, staffName } — confirmed:true เพิ่มแถวยืนยัน (ถ้ายังไม่มีของวันนี้)
// confirmed:false ลบแถวของวันนี้ทิ้ง (ติ๊กออกได้ เผื่อกดพลาด)
function setSupplierOrderConfirm(body) {
  if (!body.supplierId) throw new Error('ข้อมูลไม่ครบ (supplierId หายไป)');
  const date = todayStr();
  const sh = SHEET.getSheetByName(SUPPLIER_ORDER_CONFIRM_SHEET);
  if (!sh) throw new Error('ไม่พบชีต ' + SUPPLIER_ORDER_CONFIRM_SHEET + ' — สร้างชีตนี้ก่อน (คอลัมน์: ConfirmID, Date, SupplierID, ConfirmedBy, Timestamp)');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const dateCol = headers.indexOf('Date');
  const supCol = headers.indexOf('SupplierID');
  if (dateCol === -1 || supCol === -1) throw new Error('ไม่พบคอลัมน์ Date หรือ SupplierID ในชีต ' + SUPPLIER_ORDER_CONFIRM_SHEET);

  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (normDate(data[i][dateCol]) === date && String(data[i][supCol]).trim() === String(body.supplierId).trim()) {
      foundRow = i + 1;
      break;
    }
  }

  if (body.confirmed) {
    if (foundRow === -1) {
      appendRowByHeaders(SUPPLIER_ORDER_CONFIRM_SHEET, {
        ConfirmID: 'C' + Utilities.formatDate(new Date(), TZ, 'MMdd-HHmmss'),
        Date: date,
        SupplierID: body.supplierId,
        ConfirmedBy: body.staffName || '',
        Timestamp: new Date().toISOString()
      });
    }
  } else if (foundRow !== -1) {
    sh.deleteRow(foundRow);
  }
  return { ok: true };
}

/* ============ setProductSkipDate ============ */
// body = { productId, date (yyyy-MM-dd), skip:true/false } — เจ้าของกดจากหน้าสั่งของ เพื่องดสั่ง/งดเช็ค
// สินค้าตัวนี้เฉพาะวันที่ระบุ (ครั้งคราว ไม่ผูกกับวันในสัปดาห์) skip:true เพิ่มวันที่เข้าคอลัมน์
// SkipDates ของแถวสินค้านั้น (กันซ้ำ), skip:false ลบวันที่นั้นออก
function setProductSkipDate(body) {
  if (!body.productId || !body.date) throw new Error('ข้อมูลไม่ครบ (productId หรือ date หายไป)');
  // บังคับฟอร์แมต yyyy-MM-dd เฉพาะตอน "ตั้ง" วันที่งดใหม่ (skip:true) เท่านั้น — กันไม่ให้ค่าที่ไม่ใช่
  // วันที่ล้วนๆ (เช่น toString() ของ Date object ตรงๆ อย่าง "Tue Sep 01 2026 07:00:00 GMT+0700
  // (เวลาอินโดจีน)") หลุดเข้าไปในชีตได้อีก — ถ้าเคยหลุดเข้าไปแล้วจะไม่ตรงกับ todayISODate() ในฝั่งเว็บเลย
  // (เทียบสตริงตรงๆ) ทำให้ isProductSkippedToday() คืน false ทั้งที่เจ้าของตั้งงดไว้จริง ฝั่งลูกจ้างเลยเห็นว่า
  // ยังสั่งได้ปกติ ดู cleanMalformedSkipDates() ด้านล่างสำหรับล้างข้อมูลเก่าที่หลุดไปแล้วก่อนเพิ่มเช็คนี้ —
  // ตอน "ยกเลิก" (skip:false) ไม่เช็คฟอร์แมต เพราะต้องส่งค่าเดิมที่มีอยู่ในชีตมาตรงๆ เพื่อกรองออก ต่อให้ค่า
  // เดิมนั้นเสียอยู่แล้วก็ต้องยกเลิกได้ ไม่งั้นผู้ใช้ติดกับดัก ลบของเสียออกเองไม่ได้จากหน้าเว็บเลย
  if (body.skip !== false && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date).trim())) {
    throw new Error('รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น yyyy-MM-dd): ' + body.date);
  }
  const sh = SHEET.getSheetByName(PRODUCT_SHEET_NAME);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ProductID');
  const skipCol = headers.indexOf('SkipDates');
  if (idCol === -1) throw new Error('ไม่พบคอลัมน์ ProductID ในชีต ' + PRODUCT_SHEET_NAME);
  if (skipCol === -1) throw new Error('ไม่พบคอลัมน์ SkipDates ในชีต ' + PRODUCT_SHEET_NAME + ' — เพิ่มคอลัมน์นี้ก่อน');

  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(body.productId).trim()) { rowIdx = i; break; }
  }
  if (rowIdx === -1) throw new Error('ไม่พบสินค้า ' + body.productId);

  const date = String(body.date).trim();
  let dates = normalizeSkipDatesCell(data[rowIdx][skipCol]);
  if (body.skip === false) {
    dates = dates.filter(d => d !== date);
  } else if (!dates.includes(date)) {
    dates.push(date);
  }
  sh.getRange(rowIdx + 1, skipCol + 1).setValue(dates.join(','));

  cacheClear('bootstrap');
  return { ok: true, skipDates: dates };
}

/* ============ ซ่อมค่า SkipDates ที่เพี้ยนในชีตให้เป็น yyyy-MM-dd (รันครั้งเดียว ไม่จำเป็นต้องรันก็ได้) ======= */
// bootstrap() และ setProductSkipDate() ตอนนี้เรียก normalizeSkipDatesCell() ทุกครั้งที่อ่าน/เขียน
// SkipDates อยู่แล้ว ฝั่งลูกจ้างเลยเห็นสถานะ "งดสั่งวันนี้" ถูกต้องทันทีโดยไม่ต้องรอรันฟังก์ชันนี้ก่อน —
// ฟังก์ชันนี้แค่เขียนค่าที่ซ่อมแล้วกลับลงชีตจริงๆ ให้ตัวเซลล์เองสะอาดถาวรด้วย (เผื่อมีที่อื่นในอนาคตอ่าน
// คอลัมน์นี้ตรงๆ โดยไม่ผ่าน normalizeSkipDatesCell) ไม่ทำให้ข้อมูลหาย — กู้วันที่เดิมคืนจากค่าที่เพี้ยนได้
// เสมอ (ไม่ใช่ลบทิ้ง) ดู normalizeSkipDatesCell() ด้านบนสำหรับรายละเอียดว่าค่าเพี้ยนมาจากไหน
//
// วิธีใช้ (ไม่จำเป็น แต่แนะนำให้รันสักครั้งเพื่อความสะอาดของข้อมูล): เปิด Apps Script Editor → เลือก
// ฟังก์ชัน cleanMalformedSkipDates จาก dropdown ด้านบน → กด Run (ปลอดภัย รันซ้ำได้ แถวที่สะอาดอยู่แล้ว
// จะไม่ถูกแตะเลย) เช็คผลได้จาก popup หรือ View > Logs
function cleanMalformedSkipDates() {
  const sh = SHEET.getSheetByName(PRODUCT_SHEET_NAME);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ProductID');
  const nameCol = headers.indexOf('Name');
  const skipCol = headers.indexOf('SkipDates');
  if (skipCol === -1) throw new Error('ไม่พบคอลัมน์ SkipDates ในชีต ' + PRODUCT_SHEET_NAME);

  let fixedRows = 0;
  const details = [];

  for (let i = 1; i < data.length; i++) {
    const raw = data[i][skipCol];
    if (!raw) continue;
    const isDateObj = raw instanceof Date;
    const rawStr = isDateObj ? String(raw) : String(raw).trim();
    if (!isDateObj && !rawStr) continue;

    const fixedStr = normalizeSkipDatesCell(raw).join(',');
    if (!isDateObj && fixedStr === rawStr) continue; // สะอาดอยู่แล้ว ไม่ต้องแตะ

    sh.getRange(i + 1, skipCol + 1).setValue(fixedStr);
    fixedRows++;
    details.push(`${data[i][idCol]} (${data[i][nameCol]}): "${rawStr}" → "${fixedStr}"`);
  }

  const msg = fixedRows
    ? `ซ่อม ${fixedRows} แถว:\n` + details.join('\n')
    : 'ไม่พบแถวที่ต้องซ่อมเลย ทุกแถวสะอาดอยู่แล้ว';
  Logger.log(msg);
  if (fixedRows) cacheClear('bootstrap');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {} // เผื่อรันจาก editor แล้วไม่มี UI context
}

/* ============ setUnitLabel ============ */
// body = { unitId, label, staffName } — ปุ่มแก้ชื่อหน่วยฝั่งลูกจ้าง (เช่น "แพ็ค"/"โล"/"หัว") ที่หน้าเช็คสต๊อก
// (ดู ALLOW_EDIT_UNIT_LABEL ใน stock-check.html) ส่ง staffName มาด้วยเสมอ จำกัดให้แก้ได้แค่พนักงานคนเดียว
// (ต้องตรงกับ PRIVILEGED_STAFF_NAME) ใช้ค่าเดียวกับที่จำกัดฟีเจอร์ "เพิ่มสินค้าใหม่" ฝั่งลูกจ้างด้วย
// ดู addProductFromApp() ด้านล่าง — แก้คอลัมน์ UnitLabel ของแถวนั้นในชีต ProductUnits
// (เดิมปุ่มดินสอหน้าสั่งของฝั่งเจ้าของก็เรียกฟังก์ชันนี้ด้วย ทำให้แก้ป้ายหน่วยฝั่งสั่งของแล้วดันไป
// เปลี่ยนป้ายที่ลูกจ้างเช็คสต๊อกไว้ด้วยโดยไม่ตั้งใจ เพราะเป็นคอลัมน์เดียวกัน — ตอนนี้แยกออกไปใช้
// setOrderUnitLabel() ต่างหากแล้ว ดูด้านล่าง)
const PRIVILEGED_STAFF_NAME = 'Mile';
function setUnitLabel(body) {
  if (!body.unitId || !body.label) throw new Error('ข้อมูลไม่ครบ (unitId หรือ label หายไป)');
  if (body.staffName && body.staffName !== PRIVILEGED_STAFF_NAME) throw new Error('ไม่มีสิทธิ์แก้ชื่อหน่วย');
  const sh = SHEET.getSheetByName('ProductUnits');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('UnitID');
  const labelCol = headers.indexOf('UnitLabel');
  if (idCol === -1 || labelCol === -1) throw new Error('ไม่พบคอลัมน์ UnitID หรือ UnitLabel ในชีต ProductUnits');

  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(body.unitId).trim()) { rowIdx = i; break; }
  }
  if (rowIdx === -1) throw new Error('ไม่พบ UnitID นี้ในชีต ProductUnits: ' + body.unitId);

  const label = String(body.label).trim();
  sh.getRange(rowIdx + 1, labelCol + 1).setValue(label);

  cacheClear('bootstrap');
  return { ok: true, unitId: body.unitId, label };
}

/* ============ setOrderUnitLabel ============ */
// body = { unitId, label } — ปุ่มดินสอหน้าสั่งของฝั่งเจ้าของ แก้ป้ายหน่วยที่ใช้ "ตอนสั่งของกับซัพพลายเออร์"
// เท่านั้น (ตัวเลข +/- ที่จะสั่ง และข้อความสั่งของที่ส่งให้ซัพพลายเออร์ผ่าน createOrderBatch) —
// ไม่เช็ค staffName เพราะฝั่งเจ้าของไม่มี concept นี้ ใช้ pattern เดียวกับฟังก์ชัน owner-only ตัวอื่น
// (setSupplierCoverPhoto, setProductSkipDate ฯลฯ) ที่ถือว่าผ่านหน้ารหัส PIN มาแล้วเพียงพอ
// เขียนลงคอลัมน์ OrderLabel ของชีต ProductUnits โดยเฉพาะ — แยกจากคอลัมน์ UnitLabel ที่ setUnitLabel()
// ใช้ (ลูกจ้างเช็คสต๊อกด้วยป้ายนั้น) เพื่อไม่ให้เจ้าของแก้ป้ายให้ตรงกับที่ซัพพลายเออร์เรียก แล้วดันไป
// เปลี่ยนป้ายของยอดที่ลูกจ้างเช็คไว้แล้วโดยไม่ตั้งใจ (บั๊กเดิมตอนสองอย่างนี้ยังเป็นคอลัมน์เดียวกัน)
// คอลัมน์ OrderLabel ยังไม่มีอยู่ในชีตเดิม — ฟังก์ชันนี้สร้างให้อัตโนมัติตอนถูกเรียกใช้ครั้งแรก
// (ไม่ต้องให้เจ้าของ/ผู้ใช้ไปเพิ่มคอลัมน์เองในชีต)
// หาคอลัมน์ OrderLabel ในชีต ProductUnits ถ้ายังไม่มีให้สร้างเพิ่มท้ายชีตอัตโนมัติ ใช้ร่วมกันทุกจุด
// ที่ต้องแตะคอลัมน์นี้ (setOrderUnitLabel, addProductFromApp, submitNewProduct, backfillOrderLabels)
// เพื่อไม่ให้แต่ละจุดเขียน logic สร้างคอลัมน์ซ้ำกันเองแล้วหลุดไม่ตรงกัน
function getOrCreateOrderLabelCol(sh, headers) {
  let col = headers.indexOf('OrderLabel');
  if (col === -1) {
    col = headers.length;
    sh.getRange(1, col + 1).setValue('OrderLabel');
    headers.push('OrderLabel');
  }
  return col;
}

function setOrderUnitLabel(body) {
  if (!body.unitId || !body.label) throw new Error('ข้อมูลไม่ครบ (unitId หรือ label หายไป)');
  const sh = SHEET.getSheetByName('ProductUnits');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('UnitID');
  if (idCol === -1) throw new Error('ไม่พบคอลัมน์ UnitID ในชีต ProductUnits');

  const orderLabelCol = getOrCreateOrderLabelCol(sh, headers);

  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(body.unitId).trim()) { rowIdx = i; break; }
  }
  if (rowIdx === -1) throw new Error('ไม่พบ UnitID นี้ในชีต ProductUnits: ' + body.unitId);

  const label = String(body.label).trim();
  sh.getRange(rowIdx + 1, orderLabelCol + 1).setValue(label);

  cacheClear('bootstrap');
  return { ok: true, unitId: body.unitId, orderLabel: label };
}

/* ============ backfillOrderLabels (รันครั้งเดียว) ============ */
// ทำไมต้องรัน: หน่วยที่มีอยู่ก่อนฟีเจอร์แยกป้ายหน่วย (สั่งของ vs เช็คสต๊อก) ยังไม่มีค่า OrderLabel เป็น
// ของตัวเอง — bootstrap() เลย fallback ไปอ่าน UnitLabel แทนสดๆ ทุกครั้ง (ดูคอมเมนต์ใน bootstrap())
// ผลคือถ้าลูกจ้างแก้ UnitLabel ฝั่งเช็คสต๊อกของหน่วยที่ยังไม่เคย fill OrderLabel เลย จะเห็นป้ายฝั่ง
// สั่งของเปลี่ยนตามไปด้วยทันที ทั้งที่ตั้งใจแยกไม่ให้กระทบกันแล้ว (บั๊กที่เจอจริง 4 ก.ย. 69)
//
// ฟังก์ชันนี้ "ตรึง" ค่า OrderLabel ปัจจุบัน (= UnitLabel ตอนนี้) ให้ทุกแถวที่ยังว่างอยู่ ตัดการพึ่ง
// fallback ทันทีสำหรับสินค้าทุกตัวที่มีอยู่แล้ว โดยไม่เปลี่ยนป้ายที่แสดงผลตอนนี้เลยสักตัว (แค่ copy
// ค่าเดิมไปเก็บไว้ในคอลัมน์ใหม่ ไม่ใช่เปลี่ยนความหมาย) จากนี้ไปแก้ UnitLabel จะไม่กระทบ OrderLabel อีก
//
// วิธีใช้ (ต้องรันครั้งเดียวหลังอัปเดตโค้ดชุดนี้): เปิด Apps Script Editor → เลือกฟังก์ชัน
// backfillOrderLabels จาก dropdown ด้านบน → กด Run → เช็คผลจาก popup/Log
// ปลอดภัย รันซ้ำได้เรื่อยๆ (ครั้งที่ 2 เป็นต้นไปจะข้ามแถวที่มีค่า OrderLabel อยู่แล้ว ไม่ทับซ้ำ)
function backfillOrderLabels() {
  const sh = SHEET.getSheetByName('ProductUnits');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const labelCol = headers.indexOf('UnitLabel');
  if (labelCol === -1) throw new Error('ไม่พบคอลัมน์ UnitLabel ในชีต ProductUnits');
  const orderLabelCol = getOrCreateOrderLabelCol(sh, headers);

  let filled = 0;
  for (let i = 1; i < data.length; i++) {
    const current = data[i][orderLabelCol];
    if (current !== '' && current !== undefined && current !== null) continue; // มีค่าอยู่แล้ว ข้าม
    const unitLabel = data[i][labelCol];
    if (!unitLabel) continue;
    sh.getRange(i + 1, orderLabelCol + 1).setValue(unitLabel);
    filled++;
  }

  cacheClear('bootstrap');
  const msg = filled
    ? `เติม OrderLabel ให้ ${filled} แถว (ตรึงค่าปัจจุบันไว้แล้ว — แก้ UnitLabel ฝั่งเช็คสต๊อกจากนี้ไปจะไม่กระทบป้ายฝั่งสั่งของอีกต่อไป)`
    : 'ไม่มีแถวไหนต้องเติม — ทุกแถวมี OrderLabel ของตัวเองอยู่แล้ว';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {} // เผื่อรันจาก editor แล้วไม่มี UI context
}

/* ============ เพิ่มหน่วยเล็กให้สินค้าทุกตัวที่ยังมีหน่วยเดียว ============ */
// วิธีใช้:
// 1. เปิด Apps Script Editor ของโปรเจกต์นี้
// 2. วางฟังก์ชันด้านล่างนี้ต่อท้ายไฟล์ Code.gs (ไม่ต้องลบอะไรเดิม แค่แปะเพิ่ม)
// 3. แก้ค่า SMALL_UNIT_LABEL ด้านล่างเป็นชื่อหน่วยเล็กที่อยากใช้เป็นค่าเริ่มต้น (เช่น "แพ็ค")
//    — สินค้าที่อยากใช้ชื่ออื่น ไปแก้เองทีหลังในชีต ProductUnits ทีละแถวได้ เร็วกว่าพิมพ์สร้างเอง
// 4. Save (Ctrl+S) แล้วเลือกฟังก์ชัน addSmallUnitToAllProducts จาก dropdown ด้านบน กด Run
//    (ครั้งแรกจะมี popup ขอสิทธิ์ authorize — กดอนุญาตได้เลย)
// 5. เช็คผลใน Logger (View > Logs) หรือ popup alert ที่เด้งขึ้นมา
//
// ฟังก์ชันนี้ทำอะไร:
// - ไล่ดูสินค้าทุกตัวในชีต Product (Actual)
// - สินค้าที่ตอนนี้มีหน่วยอยู่ "แค่ 1 แถว" ใน ProductUnits จะถูก:
//     (ก) เปลี่ยน SortOrder ของแถวเดิมเป็น 2 (กลายเป็น "หน่วยใหญ่" อยู่ขวา)
//     (ข) เพิ่มแถวใหม่ต่อท้ายชีต เป็น "หน่วยเล็ก" (SortOrder 1) ด้วยชื่อ SMALL_UNIT_LABEL
// - สินค้าที่มี 2 หน่วยอยู่แล้ว หรือยังไม่มีหน่วยเลย จะถูกข้าม ไม่แตะต้อง (นับจำนวนที่ข้ามให้ดูตอนจบ)
// - รันซ้ำได้อย่างปลอดภัย ครั้งที่ 2 เป็นต้นไปจะไม่เพิ่มซ้ำ เพราะเช็คว่ามี 2 หน่วยแล้วจะข้าม

const SMALL_UNIT_LABEL = 'แพ็ค'; // เปลี่ยนคำนี้ก่อนรัน ถ้าอยากใช้ชื่ออื่นเป็นค่าเริ่มต้น

function addSmallUnitToAllProducts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const productsSheet = ss.getSheetByName(PRODUCT_SHEET_NAME);
  const unitsSheet = ss.getSheetByName('ProductUnits');

  const productRows = productsSheet.getDataRange().getValues();
  const productIdCol = productRows[0].indexOf('ProductID');
  const allProductIds = productRows.slice(1).map(r => r[productIdCol]).filter(Boolean);

  const unitData = unitsSheet.getDataRange().getValues();
  const headers = unitData[0];
  const uIdCol = headers.indexOf('UnitID');
  const pIdCol = headers.indexOf('ProductID');
  const sortCol = headers.indexOf('SortOrder');

  // จับกลุ่มแถวหน่วยตาม ProductID
  const rowsByProduct = {};
  for (let i = 1; i < unitData.length; i++) {
    const pid = String(unitData[i][pIdCol]).trim();
    if (!pid) continue;
    (rowsByProduct[pid] = rowsByProduct[pid] || []).push({ rowIndex: i + 1 });
  }

  // เลขลำดับ UnitID ตัวถัดไป (ต่อจากเลขสูงสุดที่มีอยู่)
  let nextNum = unitData.slice(1).reduce((m, r) => {
    const n = parseInt(String(r[uIdCol]).replace(/\D/g, ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0) + 1;

  const newRows = [];
  let skippedAlready = 0, skippedNoUnit = 0, updated = 0;

  allProductIds.forEach(pid => {
    const key = String(pid).trim();
    const rows = rowsByProduct[key] || [];
    if (rows.length === 0) { skippedNoUnit++; return; }   // ยังไม่มีหน่วยเลย — ข้าม ต้องสร้างเอง
    if (rows.length >= 2) { skippedAlready++; return; }   // มี 2 หน่วยแล้ว — ข้าม ไม่แตะ

    // มีหน่วยเดียว: เปลี่ยนแถวเดิมเป็น "หน่วยใหญ่" (SortOrder 2)
    unitsSheet.getRange(rows[0].rowIndex, sortCol + 1).setValue(2);

    // เพิ่มแถวใหม่เป็น "หน่วยเล็ก" (SortOrder 1)
    const newUnitId = 'U' + String(nextNum++).padStart(3, '0');
    newRows.push([newUnitId, pid, SMALL_UNIT_LABEL, '', 1]);
    updated++;
  });

  if (newRows.length) {
    unitsSheet.getRange(unitsSheet.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
  }

  const msg = `เพิ่มหน่วยเล็ก "${SMALL_UNIT_LABEL}" ให้ ${updated} สินค้า\n`
    + `ข้าม ${skippedAlready} สินค้า (มี 2 หน่วยอยู่แล้ว)\n`
    + `ข้าม ${skippedNoUnit} สินค้า (ยังไม่มีหน่วยเลยในชีต — ต้องสร้างเอง)`;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {} // เผื่อรันจาก editor แล้วไม่มี UI context
}

/* ============ Auto-sync: ทุกสินค้าใน Product (Actual) ต้องมีหน่วยเล็ก+ใหญ่ใน ProductUnits เสมอ ============ */
// วิธีติดตั้ง (ทำครั้งเดียว):
// 1. เปิด Apps Script Editor → วางฟังก์ชันทั้งหมดนี้ต่อท้ายไฟล์ Code.gs (ไม่ต้องลบอะไรเดิม)
// 2. แก้ค่า SMALL_UNIT_LABEL_AUTO ด้านล่างถ้าอยากได้ชื่อหน่วยเล็กเริ่มต้นอื่นที่ไม่ใช่ "แพ็ค"
// 3. Save (Ctrl+S)
// 4. เลือกฟังก์ชัน installProductUnitsSyncTrigger จาก dropdown ด้านบน → กด Run ครั้งเดียว
//    (จะมี popup ขอสิทธิ์ authorize ครั้งแรก — กดอนุญาต)
// 5. เสร็จแล้ว — จากนี้ระบบจะรัน syncProductUnits() ให้เองทุก 1 ชั่วโมง ไม่ต้องทำอะไรอีก
//    เพิ่มสินค้าใหม่ในชีตเมื่อไหร่ ภายใน 1 ชั่วโมงจะมีหน่วยให้อัตโนมัติ
//
// เช็คว่า trigger ติดตั้งแล้วจริง: เมนู Triggers (นาฬิกาไอคอนซ้ายมือ) ใน Apps Script Editor
// จะเห็นแถว "syncProductUnits" ตั้งเวลาไว้ — ลบได้จากที่นั่นถ้าอยากปิดระบบนี้ทีหลัง

const SMALL_UNIT_LABEL_AUTO = 'แพ็ค';

function installProductUnitsSyncTrigger() {
  // ลบ trigger เดิมของฟังก์ชันนี้ก่อน กันสร้างซ้ำถ้ารันคำสั่งนี้มากกว่า 1 ครั้ง
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncProductUnits') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncProductUnits')
    .timeBased()
    .everyHours(1)
    .create();
  syncProductUnits(); // รันทันที 1 ครั้งตอนติดตั้ง ไม่ต้องรอชั่วโมงแรก
  Logger.log('ติดตั้ง auto-sync เรียบร้อย — จะรันทุก 1 ชั่วโมงจากนี้ไป');
}

function syncProductUnits() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const productsSheet = ss.getSheetByName(PRODUCT_SHEET_NAME);
  const unitsSheet = ss.getSheetByName('ProductUnits');

  const productData = productsSheet.getDataRange().getValues();
  const pHeaders = productData[0];
  const pIdCol = pHeaders.indexOf('ProductID');
  const pOrderUnitCol = pHeaders.indexOf('OrderUnit');
  const products = productData.slice(1)
    .filter(r => r[pIdCol])
    .map(r => ({ id: r[pIdCol], orderUnit: r[pOrderUnitCol] || 'หน่วย' }));

  const unitData = unitsSheet.getDataRange().getValues();
  const uHeaders = unitData[0];
  const uIdCol = uHeaders.indexOf('UnitID');
  const uPidCol = uHeaders.indexOf('ProductID');
  const sortCol = uHeaders.indexOf('SortOrder');

  const rowsByProduct = {};
  for (let i = 1; i < unitData.length; i++) {
    const pid = String(unitData[i][uPidCol]).trim();
    if (!pid) continue;
    (rowsByProduct[pid] = rowsByProduct[pid] || []).push({ rowIndex: i + 1 });
  }

  let nextNum = unitData.slice(1).reduce((m, r) => {
    const n = parseInt(String(r[uIdCol]).replace(/\D/g, ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0) + 1;

  const newRows = [];
  let createdBoth = 0, upgradedOne = 0;

  products.forEach(p => {
    const key = String(p.id).trim();
    const rows = rowsByProduct[key] || [];
    if (rows.length >= 2) return; // ครบแล้ว ไม่แตะ

    if (rows.length === 0) {
      const smallId = 'U' + String(nextNum++).padStart(3, '0');
      const largeId = 'U' + String(nextNum++).padStart(3, '0');
      newRows.push([smallId, p.id, SMALL_UNIT_LABEL_AUTO, '', 1]);
      newRows.push([largeId, p.id, p.orderUnit, '', 2]);
      createdBoth++;
      return;
    }

    unitsSheet.getRange(rows[0].rowIndex, sortCol + 1).setValue(2);
    const smallId = 'U' + String(nextNum++).padStart(3, '0');
    newRows.push([smallId, p.id, SMALL_UNIT_LABEL_AUTO, '', 1]);
    upgradedOne++;
  });

  if (newRows.length) {
    unitsSheet.getRange(unitsSheet.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
    cacheClear('bootstrap'); // เคลียร์แคชทันที ไม่ต้องรอครบ 5 นาที
    Logger.log(`sync: สร้างครบให้ ${createdBoth} สินค้า, เติมหน่วยเล็กให้ ${upgradedOne} สินค้า`);
  }
}

/* ============ เรียงเลข SupplierID ใหม่ให้ตรงกับลำดับแถวในชีต Suppliers ============ */
// ใช้เมื่อ: ย้ายลำดับแถว Supplier ในชีตเสร็จแล้ว (ลากแถวจัดเรียงตามที่ต้องการ)
// แล้วอยากให้เลข SupplierID (S001, S002, ...) เรียงตรงกับตำแหน่งแถวจริงด้วย
//
// ⚠️ ก่อนรัน: File → Make a copy สำรองไฟล์ทั้งสเปรดชีตไว้ก่อน เผื่อพลาด
//
// วิธีใช้:
// 1. จัดเรียงลำดับแถวในชีต Suppliers ให้เป็นแบบที่ต้องการเรียบร้อยก่อน (ลาก/ย้ายแถว)
// 2. วางฟังก์ชันนี้ต่อท้ายไฟล์ Code.gs แล้ว Save
// 3. เลือกฟังก์ชัน renumberSupplierIds จาก dropdown → กด Run
// 4. อ่าน popup/Log ที่สรุปว่าเปลี่ยนรหัสอะไรเป็นอะไรบ้าง เช็คในชีตว่าถูกต้อง
//
// ฟังก์ชันนี้ทำอะไร:
// - อ่านลำดับแถวปัจจุบันในชีต Suppliers แล้วตั้งเลขใหม่ให้เรียง S001, S002, S003, ... ตามลำดับแถว
// - อัปเดตคอลัมน์ SupplierID ทั้งในชีต Suppliers และทุกแถวในชีต Product (Actual) ที่อ้างอิงรหัสเดิม
//   ให้ตรงกันทั้งหมดในการรันครั้งเดียว (ไม่ทิ้งสินค้าลอย)
// - ใช้รหัสชั่วคราวคั่นกลางระหว่างเปลี่ยน กันเลขชนกันเวลาสลับตำแหน่ง (เช่น S003 ↔ S010)
// - เจ้าที่ไม่มีสินค้าเลยก็ยังได้รหัสใหม่ตามปกติ ไม่ error

function renumberSupplierIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const supSheet = ss.getSheetByName('Suppliers');
  const prodSheet = ss.getSheetByName(PRODUCT_SHEET_NAME);

  const supData = supSheet.getDataRange().getValues();
  const supHeaders = supData[0];
  const supIdCol = supHeaders.indexOf('SupplierID');
  if (supIdCol === -1) throw new Error('ไม่พบคอลัมน์ SupplierID ในชีต Suppliers');

  const prodData = prodSheet.getDataRange().getValues();
  const prodHeaders = prodData[0];
  const prodSupIdCol = prodHeaders.indexOf('SupplierID');
  if (prodSupIdCol === -1) throw new Error('ไม่พบคอลัมน์ SupplierID ในชีต ' + PRODUCT_SHEET_NAME);

  // สร้าง mapping รหัสเดิม -> รหัสใหม่ ตามลำดับแถวปัจจุบัน (แถวที่ 1 ของข้อมูล = S001, ฯลฯ)
  const oldIds = [];
  const mapping = {};
  for (let i = 1; i < supData.length; i++) {
    const oldId = String(supData[i][supIdCol]).trim();
    if (!oldId) continue;
    const newId = 'S' + String(i).padStart(3, '0'); // แถวข้อมูลที่ i (นับจาก 1) -> Sxxx
    oldIds.push(oldId);
    mapping[oldId] = newId;
  }

  // เฟส 1: เปลี่ยนเป็นรหัสชั่วคราวก่อน กันชนกันตอนสลับตำแหน่ง (เช่น S003 จะกลายเป็น S010 พร้อมกับ S010 จะกลายเป็น S003)
  for (let i = 1; i < supData.length; i++) {
    const oldId = String(supData[i][supIdCol]).trim();
    if (mapping[oldId]) supSheet.getRange(i + 1, supIdCol + 1).setValue('_TMP_' + oldId);
  }
  for (let i = 1; i < prodData.length; i++) {
    const oldId = String(prodData[i][prodSupIdCol]).trim();
    if (mapping[oldId]) prodSheet.getRange(i + 1, prodSupIdCol + 1).setValue('_TMP_' + oldId);
  }

  // เฟส 2: เปลี่ยนจากรหัสชั่วคราวเป็นรหัสใหม่จริง
  for (let i = 1; i < supData.length; i++) {
    const cellVal = String(supSheet.getRange(i + 1, supIdCol + 1).getValue());
    if (cellVal.indexOf('_TMP_') === 0) {
      const oldId = cellVal.replace('_TMP_', '');
      supSheet.getRange(i + 1, supIdCol + 1).setValue(mapping[oldId]);
    }
  }
  for (let i = 1; i < prodData.length; i++) {
    const cellVal = String(prodSheet.getRange(i + 1, prodSupIdCol + 1).getValue());
    if (cellVal.indexOf('_TMP_') === 0) {
      const oldId = cellVal.replace('_TMP_', '');
      prodSheet.getRange(i + 1, prodSupIdCol + 1).setValue(mapping[oldId]);
    }
  }

  cacheClear('bootstrap');

  const summary = oldIds.map(o => `${o} → ${mapping[o]}`).join('\n');
  Logger.log('เปลี่ยนรหัส Supplier:\n' + summary);
  try { SpreadsheetApp.getUi().alert('เรียงรหัส Supplier ใหม่เรียบร้อย:\n\n' + summary); } catch (e) {}
}

/* ============ ตัวนับ ID แบบไม่ต้องอ่านทั้งชีต ============ */
// ใช้แทนการอ่านทั้งชีตเพื่อหาเลข ID ถัดไป (readTable แล้วหา max) — เก็บตัวนับแยกไว้ต่างหาก
// (PropertiesService) จองเลขแบบ atomic ด้วย LockService กันสองคนกดบันทึกพร้อมกันแล้วได้เลขซ้ำ
function reserveIdBlock(counterKey, count) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const start = parseInt(props.getProperty(counterKey) || '0', 10) + 1;
    props.setProperty(counterKey, String(start + count - 1));
    return start;
  } finally {
    lock.releaseLock();
  }
}
