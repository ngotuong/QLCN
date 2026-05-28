// Logger.gs
const Logger = {
    _logQueue: [],

    /**
     * Ghi log vào hàng đợi tạm thời hoặc trực tiếp nếu là ERROR.
     * @param {string} level - Mức độ log (INFO, ERROR).
     * @param {string} funcName - Tên hàm gọi log.
     * @param {string} message - Thông điệp log.
     * @param {Object} [details] - Chi tiết bổ sung (tùy chọn).
     */
    log(level, funcName, message, details = {}) {
        try {
            const startTime = Date.now();
            const logEntry = [
                Utilities.formatDate(new Date(), Config.getTimezone(), 'dd/MM/yyyy HH:mm:ss'),
                level,
                funcName,
                message,
                JSON.stringify(details)
            ];
            this._logQueue.push(logEntry);
            console.log(`Logged ${level}: ${funcName} - ${message}`);
            if (level === 'ERROR' || this._logQueue.length >= 50) {
                this.flushLogs();
            }
        } catch (e) {
            console.error(`Failed to queue log: ${e.message}`);
        }
    },

    /**
     * Ghi toàn bộ log trong hàng đợi vào sheet.
     */
    flushLogs() {
        if (this._logQueue.length === 0) return;
        const startTime = Date.now();
        try {
            const logSheetId = Config.getLogSheetId();
            if (!logSheetId) {
                console.log(`Skipped sheet log flush because LOG_SHEET_ID is not configured. Dropped ${this._logQueue.length} entries.`);
                this._logQueue = [];
                return;
            }
            const spreadsheet = SpreadsheetApp.openById(logSheetId);
            let sheet = spreadsheet.getSheetByName('BotLogs');
            if (!sheet) {
                sheet = spreadsheet.insertSheet('BotLogs');
                sheet.appendRow(['Timestamp', 'Level', 'Function', 'Message', 'Details']);
            }
            sheet.getRange(sheet.getLastRow() + 1, 1, this._logQueue.length, 5).setValues(this._logQueue);

            const maxRows = 2000;
            const currentRows = sheet.getLastRow();
            if (currentRows > maxRows) {
                sheet.deleteRows(maxRows + 1, currentRows - maxRows);
            }

            console.log(`Flushed ${this._logQueue.length} logs in ${Date.now() - startTime}ms`);
            this._logQueue = [];
        } catch (e) {
            console.error(`Failed to flush logs: ${e.message}`);
        }
    },

    /**
     * Ghi log mức INFO.
     * @param {string} funcName - Tên hàm.
     * @param {string} message - Thông điệp.
     * @param {Object} [details] - Chi tiết.
     */
    logInfo(funcName, message, details) {
        if (Config.getLogLevel() === 'INFO') {
            this.log('INFO', funcName, message, details);
        }
    },

    /**
     * Ghi log mức ERROR.
     * @param {string} funcName - Tên hàm.
     * @param {string} message - Thông điệp.
     * @param {Object} [details] - Chi tiết.
     */
    logError(funcName, message, details) {
        this.log('ERROR', funcName, message, details);
    }
};
