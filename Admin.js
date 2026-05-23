// Admin.gs
const Admin = {
    createStatusReport() {
        const yearFiles = Config.getYearFiles();
        const years = Object.keys(yearFiles || {}).map(Number).sort((a, b) => a - b);
        const currentYear = new Date().getFullYear();
        let currentRows = 'N/A';

        try {
            const ss = Sheets.getSpreadsheetForYear(currentYear);
            const sl = ss ? ss.getSheetByName('SL') : null;
            currentRows = sl ? Math.max(0, sl.getLastRow() - 1) : 0;
        } catch (e) {
            currentRows = `Lỗi: ${e.message}`;
        }

        return [
            '*TRẠNG THÁI HỆ THỐNG*',
            `*Token:* ${Config.getTelegramApiToken() ? 'OK' : 'Thiếu'}`,
            `*yearFiles:* ${years.length ? years.join(', ') : 'Thiếu'}`,
            `*Năm hiện tại:* ${currentYear}`,
            `*Dòng SL năm hiện tại:* ${currentRows}`,
            `*Allowed chat IDs:* ${Config.getAllowedChatIds().join(', ') || 'Trống'}`,
            `*Admin chat IDs:* ${Config.getAdminChatIds().join(', ') || 'Trống'}`,
            `*Shareholder chat IDs:* ${Config.getShareholderChatIds().join(', ') || 'Trống'}`,
            `*Notify chat IDs:* ${Config.getNotificationChatIds().join(', ') || 'Trống'}`,
            `*Khách loại trừ:* ${Config.getExcludedCustomers().join(', ') || 'Trống'}`,
            `*Cổ đông:* ${Config.getShareholderNames().join(', ') || 'Trống'}`
        ].join('\n');
    },

    handleCallback(callbackData, chatId, messageId) {
        if (!callbackData.startsWith('admin_')) {
            return false;
        }

        if (!Config.isAdminChat(chatId)) {
            Telegram.sendMessage(chatId, 'Bạn không có quyền dùng menu quản trị.', Menu.createStartMenu());
            return true;
        }

        if (callbackData === 'admin_menu') {
            StateManager.clear(chatId);
            Telegram.editMessage(chatId, messageId, 'Chọn thao tác cài đặt:', Menu.createAdminMenu());
            return true;
        }

        if (callbackData === 'admin_refresh_cache') {
            Telegram.sendMessage(chatId, Sheets.clearRuntimeCache(), Menu.createAdminMenu());
            return true;
        }

        if (callbackData === 'admin_create_new_year') {
            const currentYear = new Date().getFullYear();
            Telegram.sendMessage(chatId, `⏳ Đang khởi tạo tự động file công nợ cho năm ${currentYear}... Vui lòng chờ.`);
            const result = Sheets.createNewYearFileAndTransferDebt();
            Telegram.sendMessage(chatId, result, Menu.createAdminMenu(), { disable_web_page_preview: true });
            return true;
        }

        if (callbackData === 'admin_status') {
            Telegram.sendMessage(chatId, this.createStatusReport(), Menu.createAdminMenu());
            return true;
        }

        if (callbackData === 'admin_clear_state') {
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, 'Đã xóa trạng thái phiên hiện tại.', Menu.createAdminMenu());
            return true;
        }

        return false;
    }
};
