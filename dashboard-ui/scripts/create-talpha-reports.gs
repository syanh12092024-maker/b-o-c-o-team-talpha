/**
 * TALPHA Reports — Auto tạo Folder + Spreadsheet
 * 
 * HƯỚNG DẪN:
 * 1. Mở https://script.google.com (đăng nhập tài khoản 30TB)
 * 2. Tạo New Project → dán toàn bộ code này
 * 3. Bấm ▶ Run → Authorize khi được hỏi
 * 4. Xem log (View → Execution log) để lấy Parent Folder ID
 * 5. Gửi Folder ID cho AI để cập nhật dashboard
 */

// ═══ CẤU HÌNH ═══
const SERVICE_ACCOUNT_EMAIL = "talpha@banbot-494807.iam.gserviceaccount.com";

const MKT_LIST = [
  { num: 1, name: "C.Thuý" },
  { num: 2, name: "N.Thế" },
  { num: 3, name: "Nhung" },
  { num: 4, name: "Lộc" },
  { num: 5, name: "Mạnh" },
  { num: 6, name: "Mai" },
  { num: 7, name: "S.Anh" },
];

const MARKETS = ["SAUDI", "UAE", "KUWAIT", "OMAN", "QATAR", "BAHRAIN"];

const HEADERS = ["Ngày", "Tiền Tiêu", "Số Mess", "Giá Mess", "Đơn POS", "DT POS", "ROAS"];

// Tạo cho tháng nào (thay đổi nếu cần)
const MONTHS = [5]; // Tháng 5. Thêm [5,6] nếu muốn tạo nhiều tháng

// ═══ MAIN ═══
function createTalphaReports() {
  // 1. Tạo folder gốc
  var root = DriveApp.createFolder("TALPHA Reports");
  Logger.log("✅ Folder gốc: " + root.getName());
  Logger.log("📋 PARENT FOLDER ID: " + root.getId());
  Logger.log("🔗 Link: https://drive.google.com/drive/folders/" + root.getId());
  
  // Share folder gốc với service account
  root.addEditor(SERVICE_ACCOUNT_EMAIL);
  
  // 2. Tạo cấu trúc cho từng MKT
  for (var m = 0; m < MKT_LIST.length; m++) {
    var mkt = MKT_LIST[m];
    var folderName = mkt.num + ". " + mkt.name;
    var mktFolder = root.createFolder(folderName);
    mktFolder.addEditor(SERVICE_ACCOUNT_EMAIL);
    Logger.log("  📁 " + folderName);
    
    // 3. Tạo thư mục tháng
    for (var t = 0; t < MONTHS.length; t++) {
      var monthNum = MONTHS[t];
      var monthFolder = mktFolder.createFolder("Tháng " + monthNum);
      monthFolder.addEditor(SERVICE_ACCOUNT_EMAIL);
      
      // 4. Tạo spreadsheet cho từng thị trường
      for (var k = 0; k < MARKETS.length; k++) {
        var market = MARKETS[k];
        var ss = SpreadsheetApp.create(market);
        var sheet = ss.getSheets()[0];
        sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
        sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
        sheet.setFrozenRows(1);
        
        // Move vào đúng folder
        var file = DriveApp.getFileById(ss.getId());
        monthFolder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
        file.addEditor(SERVICE_ACCOUNT_EMAIL);
        
        Logger.log("    📊 " + market + " → " + ss.getId());
      }
      
      // 5. Tạo spreadsheet TỔNG ADS
      var summaryName = "TỔNG ADS THÁNG " + monthNum;
      var ssSummary = SpreadsheetApp.create(summaryName);
      var sheetSummary = ssSummary.getSheets()[0];
      sheetSummary.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheetSummary.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
      sheetSummary.setFrozenRows(1);
      
      var fileSummary = DriveApp.getFileById(ssSummary.getId());
      monthFolder.addFile(fileSummary);
      DriveApp.getRootFolder().removeFile(fileSummary);
      fileSummary.addEditor(SERVICE_ACCOUNT_EMAIL);
      
      Logger.log("    📊 " + summaryName);
      Logger.log("  ✅ Tháng " + monthNum + " hoàn tất");
    }
  }
  
  Logger.log("");
  Logger.log("══════════════════════════════════");
  Logger.log("🎉 HOÀN TẤT! Đã tạo " + MKT_LIST.length + " MKT × " + MONTHS.length + " tháng × " + (MARKETS.length + 1) + " sheets");
  Logger.log("📋 COPY FOLDER ID NÀY: " + root.getId());
  Logger.log("══════════════════════════════════");
}
