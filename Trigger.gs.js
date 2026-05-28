// Trigger.gs
function setupLogFlushTrigger() {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
        if (trigger.getHandlerFunction() === 'Logger.flushLogs') {
            ScriptApp.deleteTrigger(trigger);
        }
    })
    ScriptApp.newTrigger('Logger.flushLogs')
        .timeBased()
        .everyMinutes(15)
        .create();
    Logger.logInfo('setupLogFlushTrigger', 'Log flush trigger created');
}

// Gửi báo cáo cổ đông của THÁNG TRƯỚC vào nhóm Telegram cổ đông (SHAREHOLDER_CHAT_IDS)
function sendShareholderReportForPreviousMonth() {
    try {
        const now = new Date(); // timezone của project
        const y = now.getFullYear();
        const m = now.getMonth(); // 0..11
        const prev = new Date(y, m - 1, 1); // ngày 1 của tháng trước

        const start = new Date(prev.getFullYear(), prev.getMonth(), 1);
        const end = new Date(prev.getFullYear(), prev.getMonth() + 1, 0);

        const msg = Sheets.calculateShareholderCommission(start, end, Config.getYearFiles());
        const chatIds = Config.getShareholderChatIds() || [];
        if (!chatIds.length) {
            Logger.logError('sendShareholderReportForPreviousMonth', 'SHAREHOLDER_CHAT_IDS is empty');
            return;
        }
        chatIds.forEach(id => Telegram.sendMessage(id, msg, Menu.createShareholderGroupMenu(), { trackCleanup: true }));

        Logger.logInfo(
            'sendShareholderReportForPreviousMonth',
            `Sent report for ${start.getMonth() + 1}/${start.getFullYear()}`
        );
    } catch (e) {
        Logger.logError('sendShareholderReportForPreviousMonth', 'Failed', {
            error: e.message
        });
    }
}

// Cài trigger chạy NGÀY 1 HẰNG THÁNG lúc 08:00 (theo timezone của script)
function setupMonthlyShareholderReportTrigger() {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => {
        if (t.getHandlerFunction() === 'sendShareholderReportForPreviousMonth') {
            ScriptApp.deleteTrigger(t);
        }
    });

    ScriptApp.newTrigger('sendShareholderReportForPreviousMonth')
        .timeBased()
        .onMonthDay(1)
        .atHour(8) // có thể chỉnh 7/9/10 tùy ý
        .inTimezone(Config.getTimezone())
        .create();

    Logger.logInfo(
        'setupMonthlyShareholderReportTrigger',
        'Monthly shareholder trigger created at 08:00 on day 1'
    );
}


function setupDailyDebtReportTrigger() {
    // Xóa trigger cũ nếu có
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
        if (trigger.getHandlerFunction() === 'sendDailyDebtReport') {
            ScriptApp.deleteTrigger(trigger);
        }
    });

    // Tạo trigger mới chạy vào 8h sáng hàng ngày
    ScriptApp.newTrigger('sendDailyDebtReport')
        .timeBased()
        .atHour(8)
        .nearMinute(0)
        .everyDays(1)
        .inTimezone(Config.getTimezone())
        .create();
    Logger.logInfo('setupDailyDebtReportTrigger', 'Daily debt report trigger created');
}

function clearAllCache() {
    const result = Sheets.clearRuntimeCache();
    Logger.logInfo('clearAllCache', result);
}

function setupOperationalTriggers() {
    setupDailyDebtReportTrigger();
    setupMonthlyShareholderReportTrigger();
    setupLogFlushTrigger();
}

function testCreateNextYearFileDryRun() {
    const targetYear = new Date().getFullYear() + 1;
    const result = Sheets.previewCreateNewYearFile(targetYear);
    console.log(result);
    return result;
}

function testCreateNextYearFileSandbox() {
    const targetYear = new Date().getFullYear() + 1;
    const result = Sheets.testCreateNewYearFileSandbox(targetYear);
    console.log(result);
    return result;
}

function testCreateCurrentYearFileDryRun() {
    const targetYear = new Date().getFullYear();
    const result = Sheets.previewCreateNewYearFile(targetYear);
    console.log(result);
    return result;
}

function resetSystemCompletely() {
    // Xóa tất cả cache
    const cache = CacheService.getScriptCache();
    cache.removeAll([
        'customerList', 'customerList_2024', 'customerList_2025',
        'sheetInfo_2024', 'sheetInfo_2025',
        'customerListMarkup', 'customerDeleteListMarkup', 'customerThresholdListMarkup',
        'startMenuMarkup'
    ]);

    // Xóa PropertiesService, nhưng giữ lại cấu hình triển khai bắt buộc nếu đã cấu hình.
    const properties = PropertiesService.getScriptProperties();
    const telegramToken = properties.getProperty(Config.TELEGRAM_API_TOKEN_PROPERTY);
    const yearFiles = properties.getProperty(Config.YEAR_FILES_PROPERTY);
    const preservedKeys = [
        'ALLOWED_CHAT_IDS',
        'ADMIN_CHAT_IDS',
        'NOTIFICATION_CHAT_IDS',
        'SHAREHOLDER_CHAT_IDS',
        'LOG_SHEET_ID',
        'LOG_LEVEL',
        'TIMEZONE',
        'EXCLUDED_CUSTOMERS',
        'shareholderRates'
    ];
    const preserved = preservedKeys.reduce((acc, key) => {
        const value = properties.getProperty(key);
        if (value) acc[key] = value;
        return acc;
    }, {});
    properties.deleteAllProperties();
    if (telegramToken) {
        properties.setProperty(Config.TELEGRAM_API_TOKEN_PROPERTY, telegramToken);
    }
    if (yearFiles) {
        properties.setProperty(Config.YEAR_FILES_PROPERTY, yearFiles);
    }
    Object.keys(preserved).forEach(key => properties.setProperty(key, preserved[key]));

    Logger.logInfo('resetSystemCompletely', 'Cleared cache and non-required properties');
}
