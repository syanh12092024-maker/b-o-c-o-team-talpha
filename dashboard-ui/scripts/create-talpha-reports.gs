/**
 * TALPHA Reports — Tạo Spreadsheets vào folder CÓ SẴN
 * 
 * HƯỚNG DẪN:
 * 1. Mở https://script.google.com (đăng nhập tài khoản 30TB hoặc tài khoản sở hữu folder)
 * 2. Tạo New Project → dán toàn bộ code này
 * 3. Chọn function "setup" → bấm ▶ Run
 * 4. Authorize khi được hỏi
 * 5. Xem log (View → Execution log) để kiểm tra kết quả
 */

// ═══ CẤU HÌNH ═══
var SA = "talpha@banbot-494807.iam.gserviceaccount.com";

// FOLDER GỐC — đã có sẵn các thư mục MKT bên trong
var ROOT_FOLDER_ID = "1XrbDD_L46hY13_-3fV6037Io7NpxMe2k";

var MKTS = [
  { num: 1, name: "C.Thuý" },
  { num: 2, name: "N.Thế" },
  { num: 3, name: "Nhung" },
  { num: 4, name: "Lộc" },
  { num: 5, name: "Mạnh" },
  { num: 6, name: "Mai" },
  { num: 7, name: "S.Anh" },
];

var MARKETS = ["SAUDI", "UAE", "KUWAIT", "OMAN", "QATAR", "BAHRAIN"];
var HEADERS = ["Ngày", "Tiền Tiêu", "Số Mess", "Giá Mess", "Đơn POS", "DT POS", "ROAS"];
var MONTHS = [5]; // Tháng 5

// ═══ MAIN ═══
function setup() {
  var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  Logger.log("📁 Root folder: " + root.getName() + " (ID: " + ROOT_FOLDER_ID + ")");
  
  var created = 0;
  var skipped = 0;
  
  for (var m = 0; m < MKTS.length; m++) {
    var mkt = MKTS[m];
    var folderName = mkt.num + ". " + mkt.name;
    
    // Tìm hoặc tạo folder MKT
    var mktFolder = findOrCreateFolder_(root, folderName);
    
    // Share với service account
    try { mktFolder.addEditor(SA); } catch(e) { /* already shared */ }
    
    for (var t = 0; t < MONTHS.length; t++) {
      var monthNum = MONTHS[t];
      var monthFolderName = "Tháng " + monthNum;
      
      // Tìm hoặc tạo folder tháng
      var monthFolder = findOrCreateFolder_(mktFolder, monthFolderName);
      try { monthFolder.addEditor(SA); } catch(e) {}
      
      // Tạo spreadsheet cho từng thị trường
      for (var k = 0; k < MARKETS.length; k++) {
        var market = MARKETS[k];
        var result = findOrCreateSheet_(monthFolder, market);
        if (result.created) {
          created++;
          Logger.log("  ✅ " + folderName + "/" + monthFolderName + "/" + market + " → " + result.id);
        } else {
          skipped++;
          Logger.log("  ⏭️ " + folderName + "/" + monthFolderName + "/" + market + " (đã tồn tại)");
        }
      }
      
      // Tạo sheet TỔNG
      var summaryName = "TỔNG ADS THÁNG " + monthNum;
      var sumResult = findOrCreateSheet_(monthFolder, summaryName);
      if (sumResult.created) {
        created++;
        Logger.log("  ✅ " + folderName + "/" + monthFolderName + "/" + summaryName + " → " + sumResult.id);
      } else {
        skipped++;
        Logger.log("  ⏭️ " + summaryName + " (đã tồn tại)");
      }
    }
    
    Logger.log("📁 " + folderName + " — hoàn tất");
  }
  
  Logger.log("");
  Logger.log("══════════════════════════════════════════");
  Logger.log("🎉 HOÀN TẤT! Tạo mới: " + created + " | Đã có: " + skipped);
  Logger.log("📋 FOLDER ID: " + ROOT_FOLDER_ID);
  Logger.log("══════════════════════════════════════════");
}

// ═══ HELPERS ═══

function findOrCreateFolder_(parent, name) {
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  var f = parent.createFolder(name);
  return f;
}

function findOrCreateSheet_(folder, name) {
  var iter = folder.getFilesByName(name);
  while (iter.hasNext()) {
    var file = iter.next();
    if (file.getMimeType() === "application/vnd.google-apps.spreadsheet") {
      try { file.addEditor(SA); } catch(e) {}
      return { id: file.getId(), created: false };
    }
  }
  
  // Tạo mới
  var ss = SpreadsheetApp.create(name);
  var sheet = ss.getSheets()[0];
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  
  // Move vào folder
  var file = DriveApp.getFileById(ss.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  
  // Share với service account
  try { file.addEditor(SA); } catch(e) {}
  
  return { id: ss.getId(), created: true };
}
