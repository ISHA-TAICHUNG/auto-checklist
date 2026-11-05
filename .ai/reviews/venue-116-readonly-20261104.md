# 116 年場地表唯讀核對

- 審閱者：獨立 Codex reviewer /root/venue_reader；主代理彙整證據，未使用 Claude CLI。
- 結果：PASS（對現有程式行為假設之核對；無程式修改可部署）。
- Config.gs:161-162：單一 venueSheetId；Calendar.gs:24-26：只取月日；46、72：只讀第一內容欄；99-110：精確名稱或 gid。
- Calendar.gs:76-90：假日優先；122-155 與 Config.gs:101-104：關鍵字包含比對，DB 可覆寫，固定式無預設必要字。
- Reminder.gs:166-170、201-202：不使用為 skip，讀取錯誤為 failed；DailyPpeAssignment.gs:180-187、203-215 共用場地判斷。
- 主代理補充：讀到的資料庫指向 115 年表、高空車綁舊 gid；116 表多內容欄與高空分頁資料落差均須於未來銜接處理。
- 限制：未核驗部署內部程式版本；本機未有 CodeGraph 索引，直接讀取必要來源；未修改外部狀態。
