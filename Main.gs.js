// Main.gs
/**
 * Xử lý request POST từ Telegram webhook.
 * @param {Object} e - Sự kiện POST từ Apps Script.
 */
function doPost(e) {
    let chatId, cbId;
    try {
        const data = JSON.parse(e.postData.contents);
        chatId = data.message?.chat?.id || data.callback_query?.message?.chat?.id;
        cbId = data.callback_query?.id;
        if (!chatId) throw new Error("Không tìm thấy chatId trong dữ liệu đầu vào.");

        // Quyền truy cập
        if (!Config.isAuthorizedChat(chatId)) {
            Logger.logError('doPost', `Unauthorized access attempt`, {
                chatId
            });
            Telegram.sendMessage(chatId, "Bạn không có quyền sử dụng bot này. Vui lòng liên hệ quản trị viên.");
            return;
        }

        Config.validateRequiredProperties();

        if (data.callback_query) {
            handleCallbackQuery(data.callback_query.data, chatId, data.callback_query.message.message_id, cbId);
        } else if (data.message?.text === '/start') {
            StateManager.clear(chatId);
            if (Config.isShareholderChat(chatId)) {
                Telegram.sendMessage(chatId, "Chọn báo cáo hoa hồng:", Menu.createShareholderGroupMenu(), { trackCleanup: true });
                return;
            }
            Telegram.sendMessage(chatId, "*Em chào đại ka! Đại ka muốn làm gì ✌*", Menu.createStartMenu());
        } else if (data.message?.text) {
            if (Config.isShareholderChat(chatId)) {
                Telegram.sendMessage(chatId, "Nhóm cổ đông chỉ được xem báo cáo hoa hồng qua các nút bên dưới.", Menu.createShareholderGroupMenu(), { trackCleanup: true });
                return;
            }
            handleTextMessage(data.message.text, chatId, data.message.message_id);
        }
    } catch (error) {
        Logger.logError('doPost', error.message, {
            chatId
        });
        if (chatId) {
            try {
                const isShareholderChat = Config.isShareholderChat(chatId);
                const errorMenu = isShareholderChat ? Menu.createShareholderGroupMenu() : Menu.createStartMenu();
                Telegram.sendMessage(chatId, `Đã xảy ra lỗi: ${error.message}`, errorMenu, isShareholderChat ? { trackCleanup: true } : undefined);
            } catch (notifyError) {
                Logger.logError('doPost.notifyFailed', notifyError.message, { chatId });
            }
        }
    }
}


/**
 * Gửi báo cáo công nợ hàng ngày vào 8h sáng.
 */
function sendDailyDebtReport() {
    try {
        const startTime = Date.now();
        const debtReport = Sheets.getDebtReport();
        const chatIds = Config.getDailyDebtReportChatIds();

        if (!chatIds || chatIds.length === 0) {
            Logger.logError('sendDailyDebtReport', 'No chat IDs configured. Set NOTIFICATION_CHAT_IDS or ADMIN_CHAT_IDS in Script Properties.');
            return;
        }

        chatIds.forEach(chatId => {
            const success = Telegram.sendMessage(chatId, debtReport);
            if (success) {
                Logger.logInfo('sendDailyDebtReport', `Sent daily debt report to chatId ${chatId}`);
            } else {
                Logger.logError('sendDailyDebtReport', `Failed to send daily debt report to chatId ${chatId}`);
            }
        });

        Logger.logInfo('sendDailyDebtReport', `Completed sending daily debt report in ${Date.now() - startTime}ms`);
    } catch (e) {
        Logger.logError('sendDailyDebtReport', `Failed to send daily debt report`, {
            error: e.message
        });
    }
}

function sendShareholderReportForRange(chatId, startDate, endDate, replyMarkup) {
    const report = Sheets.calculateShareholderCommission(startDate, endDate, Config.getYearFiles());
    Telegram.sendMessage(chatId, report, replyMarkup || Menu.createShareholderGroupMenu(), { trackCleanup: true });
}

function handleShareholderReadOnlyCallback(callbackData, chatId, messageId) {
    if (!Config.isShareholderChat(chatId)) return false;

    if (callbackData === 'shareholder_exit') {
        Telegram.cleanupTrackedMessages(chatId, [messageId]);
        StateManager.clear(chatId);
        return true;
    }

    if (callbackData === 'report_commission' || callbackData === 'nav_shareholder_reports' || callbackData === 'nav_shareholders' || callbackData === 'go_back') {
        StateManager.clear(chatId);
        Telegram.sendMessage(chatId, "Chọn báo cáo hoa hồng:", Menu.createShareholderGroupMenu(), { trackCleanup: true });
        return true;
    }

    const now = new Date();
    if (callbackData === 'commission_this_month') {
        sendShareholderReportForRange(chatId, new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0));
        StateManager.clear(chatId);
        return true;
    }

    if (callbackData === 'commission_prev_month') {
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        sendShareholderReportForRange(chatId, new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1), new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0));
        StateManager.clear(chatId);
        return true;
    }

    if (callbackData === 'commission_this_year') {
        sendShareholderReportForRange(chatId, new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31));
        StateManager.clear(chatId);
        return true;
    }

    if (callbackData === 'commission_all_time') {
        const yearFiles = Config.getYearFiles();
        const years = Object.keys(yearFiles).map(Number).sort().filter(year => year >= 2021);
        if (!years.length) {
            Telegram.sendMessage(chatId, "Không có dữ liệu để tính hoa hồng.", Menu.createShareholderGroupMenu(), { trackCleanup: true });
            return true;
        }
        const start = new Date(years[0], 0, 1);
        const end = new Date(years[years.length - 1], 11, 31);
        const report = Sheets.calculateShareholderCommission(start, end, yearFiles)
            .replace(/\*.*?\*/, `*BÁO CÁO CỔ ĐÔNG TOÀN THỜI GIAN*`);
        Telegram.sendMessage(chatId, report, Menu.createShareholderGroupMenu(), { trackCleanup: true });
        StateManager.clear(chatId);
        return true;
    }

    Telegram.sendMessage(chatId, "Nhóm cổ đông chỉ được xem báo cáo hoa hồng, không được thao tác quản trị hoặc nhập dữ liệu.", Menu.createShareholderGroupMenu(), { trackCleanup: true });
    StateManager.clear(chatId);
    return true;
}

/**
 * Xử lý callback query từ Telegram.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 */
function handleCallbackQuery(callbackData, chatId, messageId, callbackQueryId) {
    safeExecute(() => {
        Logger.logInfo('handleCallbackQuery', `Received callback: ${callbackData}`, {
            chatId,
            messageId
        });
        // Đã loại bỏ answerCallback dư thừa ở đây để tối ưu tốc độ

        const state = StateManager.load(chatId);

        if (Router.shouldShowTyping(callbackData)) {
            Telegram.sendChatAction(chatId, 'typing');
        }

        if (handleShareholderReadOnlyCallback(callbackData, chatId, messageId)) return;
        if (Admin.handleCallback(callbackData, chatId, messageId)) return;
        if (Router.handleStatelessNavigation(callbackData, chatId, messageId)) return;

        if (callbackData === 'customer_menu') {
            handleMenuAction(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('customer_')) {
            handleCustomerSelection(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('year_')) {
            handleYearSelection(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('delete_customer_')) {
            handleDeleteCustomerSelection(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('edit_transaction_')) {
            handleEditTransactionSelection(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('delete_transaction_')) {
            handleDeleteTransactionSelection(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('confirm_delete_transaction_')) {
            Logger.logInfo('handleCallbackQuery', `Processing confirm_delete_transaction, index: ${callbackData.split('_')[3]}, state: ${JSON.stringify(state)}`, {
                chatId
            });
            handleDeleteTransactionConfirmation(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('confirm_delete_')) {
            handleDeleteCustomerConfirmation(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('threshold_customer_')) {
            handleThresholdCustomerSelection(callbackData, chatId, messageId, state);
        } else if (callbackData.startsWith('split_share_')) {
            handleShareSplitSelection(callbackData, chatId, messageId, state);
        } else {
            Logger.logInfo('handleCallbackQuery', `Fallback to handleMenuAction for callback: ${callbackData}`, {
                chatId
            });
            handleMenuAction(callbackData, chatId, messageId, state);
        }
    }, 'handleCallbackQuery', chatId);
}


/**
 * Xử lý lựa chọn khách hàng để chỉnh sửa hạn mức.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleThresholdCustomerSelection(callbackData, chatId, messageId, state) {
    try {
        const customerName = callbackData.substring(18).replace(/_/g, " ").trim();
        Logger.logInfo('handleThresholdCustomerSelection', `Selected customer for threshold: ${customerName}`, {
            chatId,
            callbackData
        });
        const thresholds = Config.getCustomerThresholds();
        const currentThreshold = thresholds[customerName.toUpperCase()] || {
            positive: 0,
            negative: 0
        };
        const newState = {
            ...state,
            step: 'editPositiveThreshold',
            customerName,
            positiveThreshold: currentThreshold.positive,
            negativeThreshold: currentThreshold.negative,
            editMessageId: messageId
        };
        StateManager.save(chatId, newState);
        const responseText = `*Khách hàng:* ${customerName}\n_Nhập hạn mức dương_ (hiện tại: ${Sheets.formatNumberWithDot(currentThreshold.positive)}):`;
        Telegram.editMessage(chatId, messageId, responseText, Menu.createThresholdOptions('editPositive'));
    } catch (e) {
        Logger.logError('handleThresholdCustomerSelection', `Failed to handle threshold customer selection`, {
            chatId,
            error: e.message
        });
        Telegram.sendMessage(chatId, `Lỗi khi chọn khách hàng: ${e.message}`, Menu.createStartMenu());
    }
}

/**
 * Xử lý lựa chọn giao dịch để sửa.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleEditTransactionSelection(callbackData, chatId, messageId, state) {
    try {
        const transactionIndex = parseInt(callbackData.split('_')[2], 10);
        const transaction = state.transactions[transactionIndex];
        if (!transaction) {
            Logger.logError('handleEditTransactionSelection', `Invalid transaction index: ${transactionIndex}`, {
                chatId
            });
            Telegram.sendMessage(chatId, "Giao dịch không hợp lệ. Vui lòng thử lại.", Menu.createStartMenu());
            return;
        }
        const newState = {
            ...state,
            step: 'editAmount1',
            transactionIndex,
            date: transaction.date,
            customerName: transaction.customerName,
            amount1: transaction.amount1,
            amount2: transaction.amount2,
            amount3: transaction.amount3,
            note: transaction.note,
            rowIndex: transaction.rowIndex,
            editMessageId: messageId
        };
        StateManager.save(chatId, newState);
        Logger.logInfo('handleEditTransactionSelection', `Selected transaction ${transactionIndex} for edit, customer: ${transaction.customerName}, date: ${transaction.date}`, {
            chatId
        });
        const responseText = `Ngày: ${transaction.date}\n*• Khách hàng:* ${transaction.customerName}\n  _Nhập Số liệu_ (hiện tại: ${Sheets.formatNumberWithDot(transaction.amount1)}):`;
        Telegram.editMessage(chatId, messageId, responseText, Menu.createEditTransactionOptions('editAmount1'));
    } catch (e) {
        Logger.logError('handleEditTransactionSelection', `Failed to handle edit transaction selection`, {
            chatId,
            error: e.message
        });
        Telegram.sendMessage(chatId, `Lỗi khi chọn giao dịch: ${e.message}`, Menu.createStartMenu());
    }
}

/**
 * Xử lý lựa chọn giao dịch để xóa.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleDeleteTransactionSelection(callbackData, chatId, messageId, state) {
    try {
        const transactionIndex = parseInt(callbackData.split('_')[2], 10);
        const transaction = state.transactions[transactionIndex];
        if (!transaction) {
            Logger.logError('handleDeleteTransactionSelection', `Invalid transaction index: ${transactionIndex}`, {
                chatId
            });
            Telegram.sendMessage(chatId, "Giao dịch không hợp lệ. Vui lòng thử lại.", Menu.createStartMenu());
            return;
        }
        const newState = {
            ...state,
            step: 'confirmDeleteTransaction',
            transactionIndex,
            rowIndex: transaction.rowIndex,
            editMessageId: messageId
        };
        StateManager.save(chatId, newState);
        Logger.logInfo('handleDeleteTransactionSelection', `Selected transaction ${transactionIndex} for delete, customer: ${transaction.customerName}, date: ${transaction.date}`, {
            chatId
        });
        const responseText = `Xóa giao dịch của *${transaction.customerName}* ngày ${transaction.date}?\n*• Số liệu:* ${Sheets.formatNumberWithDot(transaction.amount1)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(transaction.amount2)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(transaction.amount3)}\n*• Ghi chú:* ${transaction.note || 'Không có'}`;
        Telegram.editMessage(chatId, messageId, responseText, Menu.createDeleteTransactionConfirmation(transactionIndex));
    } catch (e) {
        Logger.logError('handleDeleteTransactionSelection', `Failed to handle delete transaction selection`, {
            chatId,
            error: e.message
        });
        Telegram.sendMessage(chatId, `Lỗi khi chọn giao dịch để xóa: ${e.message}`, Menu.createStartMenu());
    }
}

/**
 * Xử lý xác nhận xóa giao dịch.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleDeleteTransactionConfirmation(callbackData, chatId, messageId, state) {
    try {
        Logger.logInfo('handleDeleteTransactionConfirmation', `Received callback: ${callbackData}, state: ${JSON.stringify(state)}`, {
            chatId
        });
        const transactionIndex = parseInt(callbackData.split('_')[3], 10);
        const transaction = state.transactions[transactionIndex];
        if (!transaction) {
            Logger.logError('handleDeleteTransactionConfirmation', `Invalid transaction index: ${transactionIndex}`, {
                chatId
            });
            Telegram.sendMessage(chatId, "Giao dịch không hợp lệ. Vui lòng thử lại.", Menu.createStartMenu());
            return;
        }
        Logger.logInfo('handleDeleteTransactionConfirmation', `Attempting to delete transaction at row ${state.rowIndex} for ${transaction.customerName} on ${transaction.date}`, {
            chatId
        });
        Sheets.deleteTransaction(state.rowIndex, transaction.date, transaction.customerName);
        StateManager.clear(chatId);
        Telegram.sendMessage(chatId, `Đã xóa giao dịch của *${transaction.customerName}* ngày ${transaction.date}.`, Menu.createStartMenu());
    } catch (e) {
        Logger.logError('handleDeleteTransactionConfirmation', `Failed to delete transaction`, {
            chatId,
            error: e.message
        });
        Telegram.sendMessage(chatId, `Lỗi khi xóa giao dịch: ${e.message}`, Menu.createStartMenu());
    }
}

/**
 * Xử lý lựa chọn khách hàng từ callback.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleCustomerSelection(callbackData, chatId, messageId, state) {
    const customerName = callbackData.substring(9).replace(/_/g, " ");
    if (state.currentMenu === 'addData') {
        const today = Utilities.formatDate(new Date(), Config.getTimezone(), "dd/MM/yyyy");
        StateManager.save(chatId, {
            ...state,
            step: 'enterAmount1',
            customerName,
            date: today,
            messageId
        });
        const responseText = `Ngày: ${today}\n*• Khách hàng:* ${customerName}\n  _Nhập Số liệu:_`;
        Telegram.editMessage(chatId, messageId, responseText, Menu.createAmountOptions());
    } else if (state.currentMenu === 'checkCustomer') {
        StateManager.save(chatId, {
            ...state,
            customerName,
            currentMenu: 'checkTime',
            previousMenu: 'checkCustomer',
            step: 'awaitingTimeRange',
            editMessageId: messageId
        });
        const responseText = `*BÁO CÁO KHÁCH HÀNG ${customerName}*\n\n_Nhập thời gian theo các định dạng:_\n*• Ngày:* _10/5 hoặc 10/5/2022_\n*• Khoảng Ngày:* _1/1/2022-31/12/2022_\n*• Tháng:* _1/2022_\n*• Khoảng Tháng:* _4/2022-5/2022_\n*• Năm:* _2022_\n*• Khoảng Năm:* _2021-2022_`;
        Telegram.editMessage(chatId, messageId, responseText, Menu.createCheckData(true));
    }
}

/**
 * Xử lý lựa chọn khách hàng để xóa.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleDeleteCustomerSelection(callbackData, chatId, messageId, state) {
    const customerName = callbackData.substring(15).replace(/_/g, " ").trim();
    Logger.logInfo('handleDeleteCustomerSelection', `Selected customer to delete: ${customerName}`, {
        chatId,
        callbackData
    });
    StateManager.save(chatId, {
        ...state,
        step: 'confirmDeleteCustomer',
        customerNameToDelete: customerName,
        messageId
    });
    Telegram.editMessage(chatId, messageId, `Bạn có chắc muốn xóa khách hàng *${customerName}*?`, Menu.createDeleteConfirmation(customerName));
}

/**
 * Xử lý xác nhận xóa khách hàng.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleDeleteCustomerConfirmation(callbackData, chatId, messageId, state) {
    const customerName = callbackData.substring(14).replace(/_/g, " ").trim();
    Logger.logInfo('handleDeleteCustomerConfirmation', `Confirming deletion of customer: ${customerName}`, {
        chatId,
        callbackData
    });
    const result = Sheets.deleteCustomer(customerName);
    StateManager.clear(chatId);
    Telegram.sendMessage(chatId, result, Menu.createStartMenu());
}

/**
 * Xử lý lựa chọn cổ đông để nhập chia cổ phần.
 */
function handleShareSplitSelection(callbackData, chatId, messageId, state) {
    const shareholderName = callbackData.substring('split_share_'.length).replace(/_/g, " ").trim().toUpperCase();
    const today = Utilities.formatDate(new Date(), Config.getTimezone(), "dd/MM/yyyy");
    const newState = {
        ...state,
        currentMenu: 'splitShares',
        previousMenu: 'manageShareholders',
        step: 'enterShareAmount2',
        customerName: shareholderName,
        date: today,
        amount1: 0,
        amount2: 0,
        amount3: 0,
        note: 'Chia cổ phần',
        messageId
    };
    StateManager.save(chatId, newState);
    const responseText = `Ngày: ${today}\n*• Cổ đông:* ${shareholderName}\n  _Nhập Thu bù:_`;
    Telegram.editMessage(chatId, messageId, responseText, Menu.createShareSplitAmount2Options());
}

/**
 * Xử lý lựa chọn năm từ callback.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleYearSelection(callbackData, chatId, messageId, state) {
    const year = Number(callbackData.substring(5));
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    const yearFiles = Config.getYearFiles();
    let result;

    if (state.currentMenu === 'manageShareholders') {
        result = Sheets.calculateShareholderCommission(startDate, endDate, yearFiles);
    } else {
        result = state.customerName ?
            Sheets.getCustomerDataInYearSimple(state.customerName, startDate, endDate, yearFiles) :
            Sheets.checkDataInRange(startDate, endDate, yearFiles);
    }

    StateManager.clear(chatId);
    Telegram.sendMessage(chatId, result, Menu.createStartMenu());
}

/**
 * Xử lý các hành động menu từ callback.
 * @param {string} callbackData - Dữ liệu callback.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 * @param {Object} state - Trạng thái hiện tại.
 */
function handleMenuAction(callbackData, chatId, messageId, state) {
    const startTime = Date.now();
    const newState = {
        ...state
    };
    let responseText, replyMarkup;
    const now = new Date();

    if (callbackData.startsWith('set_comm_')) {
        const shareholder = callbackData.replace('set_comm_', '').replace(/_/g, ' ').toUpperCase();
        newState.currentMenu = 'awaitingCommissionInput';
        newState.previousMenu = 'settingCommission';
        newState.step = 'awaitingCommission';
        newState.selectedShareholder = shareholder;
        StateManager.save(chatId, newState);
        responseText = `*CÀI ĐẶT HOA HỒNG CHO ${shareholder}*\n\nVui lòng nhập ngày áp dụng và phần trăm hoa hồng mới theo định dạng: Ngày/Tháng/Năm [Khoảng trắng] %\n_Ví dụ: 1/5/2026 10_ (để cài đặt mức 10% bắt đầu từ 1/5/2026)`;
        Telegram.editMessage(chatId, messageId, responseText, Menu.createBackButton('setting_commission'));
        return;
    }

    switch (callbackData) {
        case 'refresh_cache':
            if (!Config.isAdminChat(chatId)) {
                Telegram.sendMessage(chatId, 'Bạn không có quyền làm mới cache.', Menu.createStartMenu());
                return;
            }
            responseText = Sheets.clearRuntimeCache();
            replyMarkup = Menu.createStartMenu();
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, responseText, replyMarkup);
            return;

        case 'customer_menu':
            newState.currentMenu = 'customerMenu';
            newState.previousMenu = 'mainMenu';
            responseText = "Chọn hành động với khách hàng:";
            replyMarkup = Menu.createCustomerMenu();
            break;
        case 'add_data':
        case 'add_data_again':
            newState.currentMenu = 'addData';
            newState.previousMenu = 'manageData';
            responseText = "Chọn khách hàng để thêm số liệu:";
            replyMarkup = Menu.createCustomerList();
            break;
        case 'add_customer':
            newState.step = 'awaitingCustomerName';
            StateManager.save(chatId, newState); // <-- thêm dòng này
            Telegram.sendMessage(chatId, "Vui lòng nhập tên khách hàng mới:");
            return;

        case 'delete_customer':
            newState.currentMenu = 'deleteCustomer';
            newState.previousMenu = 'customerMenu';
            responseText = "Chọn khách hàng để xóa:";
            replyMarkup = Menu.createCustomerDeleteList();
            break;
        case 'edit_threshold':
            newState.currentMenu = 'editThreshold';
            newState.previousMenu = 'customerMenu';
            responseText = "Chọn khách hàng để chỉnh sửa hạn mức:";
            replyMarkup = Menu.createCustomerThresholdList();
            break;
        case 'check_data':
            newState.currentMenu = 'checkData';
            newState.previousMenu = 'mainMenu';
            newState.customerName = null; // xóa bộ lọc khách
            newState.step = 'awaitingTimeRange';
            newState.editMessageId = messageId;
            responseText = "*BÁO CÁO SỐ LIỆU*\n\n_Nhập thời gian theo các định dạng:_\n*• Ngày:* _10/5 hoặc 10/5/2022_\n*• Khoảng Ngày:* _1/1/2022-31/12/2022_\n*• Tháng:* _1/2022_\n*• Khoảng Tháng:* _4/2022-5/2022_\n*• Năm:* _2022_\n*• Khoảng Năm:* _2021-2022_";
            replyMarkup = Menu.createCheckData(false);
            break;
        case 'check_debt':
            newState.currentMenu = 'checkDebt';
            newState.previousMenu = 'mainMenu';
            newState.step = 'awaitingDebtDate';
            newState.editMessageId = messageId;
            responseText = "*Nhập ngày cần kiểm tra công nợ:*";
            replyMarkup = Menu.createCheckDebtOptions();
            StateManager.save(chatId, newState);
            Logger.logInfo('handleMenuAction', `Set state.step to awaitingDebtDate for chatId ${chatId}`, {
                newState
            });
            break;
        case 'check_debt_today':
            const debtReport = Sheets.getDebtReport();
            responseText = debtReport;
            replyMarkup = Menu.createStartMenu();
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, responseText, replyMarkup);
            return;
        case 'check_debt_date':
            newState.step = 'awaitingDebtDate';
            StateManager.save(chatId, newState);
            Logger.logInfo('handleMenuAction', `Set state.step to awaitingDebtDate for chatId ${chatId}`, {
                newState
            });
            responseText = "Nhập ngày cần kiểm tra công nợ (d/m hoặc d/m/yyyy):";
            Telegram.sendMessage(chatId, responseText);
            return;
        case 'manage_shareholders':
            newState.currentMenu = 'manageShareholders';
            newState.previousMenu = 'mainMenu';
            responseText = "Chọn thao tác với cổ đông:";
            replyMarkup = Menu.createShareholderMenu();
            break;
            
        case 'report_commission':
            newState.currentMenu = 'reportCommission';
            newState.previousMenu = 'manageShareholders';
            newState.step = 'awaitingTimeRange';
            responseText = "*BÁO CÁO HOA HỒNG*\n\n_Nhập thời gian theo các định dạng:_\n" +
                "• *Ngày:* _10/5 hoặc 10/5/2022_\n" +
                "• *Khoảng ngày:* _10/5-12/9_\n" +
                "• *Tháng:* _4/2022_\n" +
                "• *Khoảng tháng:* _3/2022-6/2022_\n" +
                "• *Năm:* _2022_\n" +
                "• *Khoảng năm:* _2021-2022_";
            replyMarkup = Menu.createShareholderOptions();
            break;

        case 'setting_commission':
            newState.currentMenu = 'settingCommission';
            newState.previousMenu = 'manageShareholders';
            responseText = "Chọn cổ đông để cài đặt mức hoa hồng mới:";
            replyMarkup = Menu.createSettingCommissionMenu();
            break;

        case 'add_shareholder':
            newState.currentMenu = 'manageShareholders';
            newState.previousMenu = 'manageShareholders';
            newState.step = 'awaitingShareholderName';
            StateManager.save(chatId, newState);
            Telegram.sendMessage(chatId, "Vui lòng nhập tên cổ đông mới:");
            return;

        case 'split_shares':
            newState.currentMenu = 'splitShares';
            newState.previousMenu = 'manageShareholders';
            responseText = "Chọn cổ đông để chia cổ phần:";
            replyMarkup = Menu.createShareholderList('split');
            break;

        case 'commission_this_month':
            const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            const commissionThisMonth = Sheets.calculateShareholderCommission(thisMonthStart, thisMonthEnd, Config.getYearFiles());
            responseText = commissionThisMonth;
            replyMarkup = Menu.createStartMenu();
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, responseText, replyMarkup);
            return;
        case 'commission_prev_month': {
            const y = now.getFullYear();
            const m = now.getMonth(); // 0-11
            const prevMonth = new Date(y, m - 1, 1);
            const start = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
            const end = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0);
            const msg = Sheets.calculateShareholderCommission(start, end, Config.getYearFiles());
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, msg, Menu.createStartMenu());
            return;
        }
        case 'commission_this_year': {
            const y = now.getFullYear();
            const start = new Date(y, 0, 1);
            const end = new Date(y, 11, 31);
            const msg = Sheets.calculateShareholderCommission(start, end, Config.getYearFiles());
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, msg, Menu.createStartMenu());
            return;
        }

        case 'commission_time_range':
            newState.step = 'awaitingTimeRange'; // dùng parser chung
            StateManager.save(chatId, newState);
            responseText = "_Nhập thời gian theo các định dạng:_\n" +
                "• *Ngày:* _10/5 hoặc 10/5/2022_\n" +
                "• *Khoảng ngày:* _10/5-12/9 hoặc 10/5/2022-12/9/2022_\n" +
                "• *Tháng:* _4/2022_\n" +
                "• *Khoảng tháng:* _3/2022-6/2022_\n" +
                "• *Năm:* _2022_\n" +
                "• *Khoảng năm:* _2021-2022_";
            Telegram.sendMessage(chatId, responseText);
            return;

        case 'commission_all_time':
            const yearFilesAll = Config.getYearFiles();
            const allYears = Object.keys(yearFilesAll).map(Number).sort().filter(year => year >= 2021);
            if (!allYears.length) {
                responseText = "Không có dữ liệu để tính hoa hồng.";
                replyMarkup = Menu.createStartMenu();
            } else {
                const allTimeStart = new Date(allYears[0], 0, 1);
                const allTimeEnd = new Date(allYears[allYears.length - 1], 11, 31);
                const rawReport = Sheets.calculateShareholderCommission(allTimeStart, allTimeEnd, yearFilesAll);
                responseText = rawReport.replace(/\*.*?\*/, `*BÁO CÁO CỔ ĐÔNG TOÀN THỜI GIAN*`);
                replyMarkup = Menu.createStartMenu();
            }
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, responseText, replyMarkup);
            return;
        case 'check_by_customer':
            newState.currentMenu = 'checkCustomer';
            newState.previousMenu = 'checkData';
            newState.editMessageId = messageId;
            responseText = "Chọn khách hàng để kiểm tra:";
            replyMarkup = Menu.createCustomerList();
            break;
        case 'check_today':
            const resultToday = state.customerName ?
                `*Số liệu của khách hàng ${state.customerName} hôm nay (${Utilities.formatDate(now, Config.getTimezone(), "dd/MM/yyyy")}):*\n\n${Sheets.formatNumberWithDot(Sheets.getCustomerDataInDaySimple(state.customerName, now, Config.getYearFiles()))}` :
                Sheets.checkDataInRange(now, now, Config.getYearFiles());
            responseText = resultToday;
            replyMarkup = Menu.createStartMenu();
            StateManager.clear(chatId);
            Telegram.editMessage(chatId, messageId, responseText, replyMarkup);
            return;
        case 'check_this_month':
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            const resultMonth = state.customerName ?
                Sheets.getCustomerDataInMonthSimple(state.customerName, monthStart, monthEnd, Config.getYearFiles()) :
                Sheets.checkDataInRange(monthStart, monthEnd, Config.getYearFiles());
            responseText = resultMonth;
            replyMarkup = Menu.createStartMenu();
            StateManager.clear(chatId);
            Telegram.editMessage(chatId, messageId, responseText, replyMarkup);
            return;
        case 'check_this_year': {
            const y = now.getFullYear();
            const start = new Date(y, 0, 1);
            const end = new Date(y, 11, 31);
            const yearFiles = Config.getYearFiles();
            const result = state.customerName ?
                Sheets.getCustomerDataInRangeSimple(state.customerName, start, end, yearFiles) :
                Sheets.checkDataInRange(start, end, yearFiles);
            StateManager.clear(chatId);
            Telegram.editMessage(chatId, messageId, result, Menu.createStartMenu());
            return;
        }

        case 'check_all':
            const yearFiles = Config.getYearFiles();
            const years = Object.keys(yearFiles).map(Number).sort();
            if (!years.length) {
                responseText = "Không có dữ liệu nào để kiểm tra.";
                replyMarkup = Menu.createStartMenu();
            } else {
                const startDate = new Date(years[0], 0, 1);
                const endDate = new Date(years[years.length - 1], 11, 31);
                const result = state.customerName ?
                    Sheets.getCustomerDataInRangeSimple(state.customerName, startDate, endDate, yearFiles) :
                    Sheets.checkDataInRange(startDate, endDate, yearFiles);
                responseText = result;
                replyMarkup = Menu.createStartMenu();
            }
            StateManager.clear(chatId);
            Telegram.editMessage(chatId, messageId, responseText, replyMarkup);
            return;
        case 'manage_data':
            newState.currentMenu = 'manageData';
            newState.previousMenu = 'mainMenu';
            responseText = "Chọn hành động với số liệu:";
            replyMarkup = Menu.createManageDataMenu();
            break;
        case 'create_new_year':
            if (!Config.isAdminChat(chatId)) {
                Telegram.sendMessage(chatId, 'Bạn không có quyền khởi tạo năm mới.', Menu.createStartMenu());
                return;
            }
            const currentYear = new Date().getFullYear();
            Telegram.sendMessage(chatId, `⏳ Đang khởi tạo tự động file công nợ cho năm ${currentYear}... Vui lòng chờ (việc này có thể mất vài giây).`);
            const createResult = Sheets.createNewYearFileAndTransferDebt();
            Telegram.sendMessage(chatId, createResult, Menu.createStartMenu(), { disable_web_page_preview: true });
            StateManager.clear(chatId);
            return;
        case 'edit_data': {
            // Chuyển sang ngữ cảnh sửa số liệu + chờ chọn ngày
            newState.currentMenu = 'editData';
            newState.previousMenu = 'manageData';
            newState.step = 'awaitingEditDate';
            newState.editMessageId = messageId;

            responseText = "*Nhập ngày cần sửa số liệu:*";
            replyMarkup = Menu.createEditDateOptions();
            break;
        }
        case 'enter_edit_date': {
            // Giữ step chờ người dùng gõ ngày thủ công
            newState.step = 'awaitingEditDate';
            StateManager.save(chatId, newState);
            Telegram.sendMessage(chatId, "Nhập ngày cần sửa số liệu (d/m hoặc d/m/yyyy).");
            return; // kết thúc sớm vì đã sendMessage
        }

        case 'edit_today':
        case 'edit_yesterday': {
            const base = new Date();
            if (callbackData === 'edit_yesterday') base.setDate(base.getDate() - 1);
            const formattedDate = Utilities.formatDate(base, Config.getTimezone(), "dd/MM/yyyy");

            const transactions = Sheets.getTransactionsByDate(formattedDate, { excludeShareholders: true });
            if (transactions.length === 0) {
                responseText = `Không có giao dịch nào vào ngày ${formattedDate}.`;
                replyMarkup = Menu.createManageDataMenu();
                newState.step = null;
                break;
            }

            newState.date = formattedDate;
            newState.transactions = transactions;
            newState.step = 'selectEditTransaction';

            responseText = `Danh sách giao dịch ngày ${formattedDate}:`;
            replyMarkup = Menu.createTransactionList(transactions, 'edit');
            break;
        }

        case 'delete_today':
        case 'delete_yesterday': {
            const base = new Date();
            if (callbackData === 'delete_yesterday') base.setDate(base.getDate() - 1);
            const formattedDate = Utilities.formatDate(base, Config.getTimezone(), "dd/MM/yyyy");

            const transactions = Sheets.getTransactionsByDate(formattedDate, { excludeShareholders: true });
            if (transactions.length === 0) {
                responseText = `Không có giao dịch nào vào ngày ${formattedDate}.`;
                replyMarkup = Menu.createManageDataMenu();
                newState.step = null;
                break;
            }

            newState.date = formattedDate;
            newState.transactions = transactions;
            newState.step = 'selectDeleteTransaction';

            responseText = `Danh sách giao dịch ngày ${formattedDate}:`;
            replyMarkup = Menu.createTransactionList(transactions, 'delete');
            break;
        }


        case 'delete_data':
            newState.currentMenu = 'deleteData';
            newState.previousMenu = 'manageData';
            newState.step = 'awaitingDeleteDate';
            newState.editMessageId = messageId;

            responseText = "*Nhập ngày cần xóa số liệu:*";
            replyMarkup = Menu.createDeleteDateOptions(); // <-- hiển thị 2 nút Hôm nay/Hôm qua
            break;

        case 'enter_share_date':
            newState.step = 'awaitingShareDate';
            StateManager.save(chatId, newState);
            Telegram.sendMessage(chatId, "Vui lòng nhập ngày chia cổ phần (d/m hoặc d/m/yyyy):");
            return;

        case 'skip_share_amount2':
            newState.amount2 = 0;
            newState.step = 'enterShareAmount3';
            responseText = `Ngày: ${state.date}\n*• Cổ đông:* ${state.customerName}\n*• Thu bù:* 0\n  _Nhập Mục khác:_`;
            replyMarkup = Menu.createShareSplitAmount3Options();
            break;

        case 'skip_share_amount3':
            newState.amount3 = 0;
            newState.step = 'confirmShareSplit';
            responseText = `Ngày: ${state.date}\n*• Cổ đông:* ${state.customerName}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* 0\n*• Ghi chú:* Chia cổ phần\nDữ liệu đã sẵn sàng để lưu:`;
            replyMarkup = Menu.createShareSplitSaveOptions();
            break;

        case 'back_to_share_amount2':
            newState.step = 'enterShareAmount2';
            responseText = `Ngày: ${state.date}\n*• Cổ đông:* ${state.customerName}\n  _Nhập Thu bù:_`;
            replyMarkup = Menu.createShareSplitAmount2Options();
            break;

        case 'back_to_share_amount3':
            newState.step = 'enterShareAmount3';
            responseText = `Ngày: ${state.date}\n*• Cổ đông:* ${state.customerName}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n  _Nhập Mục khác:_`;
            replyMarkup = Menu.createShareSplitAmount3Options();
            break;

        case 'save_share_split':
            if (!state.date || !state.customerName) {
                Telegram.sendMessage(chatId, 'Dữ liệu chia cổ phần đã được xử lý hoặc hết hạn. Vui lòng bắt đầu lại.', Menu.createStartMenu());
                return;
            }
            Sheets.addCustomerData(state.customerName, state.date, 0, state.amount2 || 0, state.amount3 || 0, 'Chia cổ phần');
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, `Lưu chia cổ phần cho *${state.customerName}* thành công ✅`, Menu.createShareholderMenu());
            return;

        case 'skip_edit_amount1':
            newState.step = 'editAmount2';
            StateManager.save(chatId, newState);
            responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n  _Nhập Thu bù_ (hiện tại: ${Sheets.formatNumberWithDot(state.amount2)}):`;
            replyMarkup = Menu.createEditTransactionOptions('editAmount2');
            break;
        case 'skip_edit_amount2':
            newState.step = 'editAmount3';
            StateManager.save(chatId, newState);
            responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n  _Nhập Mục khác_ (hiện tại: ${Sheets.formatNumberWithDot(state.amount3)}):`;
            replyMarkup = Menu.createEditTransactionOptions('editAmount3');
            break;
        case 'skip_edit_amount3':
            newState.step = 'editNote';
            StateManager.save(chatId, newState);
            responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(state.amount3 || 0)}\n  _Nhập Ghi chú_ (hiện tại: ${state.note || 'Không có'}):`;
            replyMarkup = Menu.createEditTransactionOptions('editNote');
            break;
        case 'skip_edit_note':
            newState.step = 'confirmEdit';
            StateManager.save(chatId, newState);
            responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(state.amount3 || 0)}\n*• Ghi chú:* ${state.note || 'Không có'}\nDữ liệu đã sẵn sàng để lưu:`;
            replyMarkup = Menu.createEditTransactionOptions('confirmEdit');
            break;
        case 'save_edited_data': {
            try {
                Sheets.updateTransaction(
                    state.rowIndex, state.date, state.customerName,
                    state.newAmount1 ?? state.amount1,
                    state.newAmount2 ?? state.amount2,
                    state.newAmount3 ?? state.amount3,
                    state.newNote ?? state.note
                );

                // Soạn thông báo mới
                const updatedText =
                    `Đã cập nhật giao dịch cho *${state.customerName}* ngày ${state.date}.`;

                // Xóa state và GỬI TIN NHẮN MỚI (không edit tin nhắn cũ)
                StateManager.clear(chatId);
                Telegram.sendMessage(chatId, updatedText, Menu.createPostEdit());

                return; // quan trọng: kết thúc sớm để KHÔNG chạy Telegram.editMessage ở cuối switch
            } catch (e) {
                responseText = `Lỗi khi cập nhật: ${e.message}`;
                replyMarkup = Menu.createStartMenu();
            }
            break;
        }


        case 'skip_positive_threshold':
            newState.step = 'editNegativeThreshold';
            StateManager.save(chatId, newState);
            responseText = `*Khách hàng:* ${state.customerName}\n*• Hạn mức dương:* ${Sheets.formatNumberWithDot(state.positiveThreshold || 0)}\n_Nhập hạn mức âm_ (hiện tại: ${Sheets.formatNumberWithDot(state.negativeThreshold)}):`;
            replyMarkup = Menu.createThresholdOptions('editNegative');
            break;
        case 'save_threshold':
            responseText = Sheets.updateCustomerThreshold(state.customerName, state.positiveThreshold || 0, state.negativeThreshold || 0);
            replyMarkup = Menu.createStartMenu();
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, responseText, replyMarkup);
            return;
        case 'back_to_previous':
            if (state.step === 'enterAmount2') {
                newState.step = 'enterAmount1';
                responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n  _Nhập Số liệu:_`;
                replyMarkup = Menu.createAmountOptions();
            } else if (state.step === 'enterAmount3') {
                newState.step = 'enterAmount2';
                responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n  _Nhập Thu bù:_`;
                replyMarkup = Menu.createAmount2Options();
            } else if (state.step === 'enterNote') {
                newState.step = 'enterAmount3';
                responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n  _Nhập Mục khác:_`;
                replyMarkup = Menu.createAmount3Options();
            } else if (state.step === 'editAmount2') {
                newState.step = 'editAmount1';
                responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n  _Nhập Số liệu_ (hiện tại: ${Sheets.formatNumberWithDot(state.amount1)}):`;
                replyMarkup = Menu.createEditTransactionOptions('editAmount1');
            } else if (state.step === 'editAmount3') {
                newState.step = 'editAmount2';
                responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n  _Nhập Thu bù_ (hiện tại: ${Sheets.formatNumberWithDot(state.amount2)}):`;
                replyMarkup = Menu.createEditTransactionOptions('editAmount2');
            } else if (state.step === 'editNote') {
                newState.step = 'editAmount3';
                responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n  _Nhập Mục khác_ (hiện tại: ${Sheets.formatNumberWithDot(state.amount3)}):`;
                replyMarkup = Menu.createEditTransactionOptions('editAmount3');
            } else if (state.step === 'confirmEdit') {
                newState.step = 'editNote';
                responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(state.amount3 || 0)}\n  _Nhập Ghi chú_ (hiện tại: ${state.note || 'Không có'}):`;
                replyMarkup = Menu.createEditTransactionOptions('editNote');
            } else if (state.step === 'editNegativeThreshold') {
                newState.step = 'editPositiveThreshold';
                responseText = `*Khách hàng:* ${state.customerName}\n_Nhập hạn mức dương_ (hiện tại: ${Sheets.formatNumberWithDot(state.positiveThreshold || 0)}):`;
                replyMarkup = Menu.createThresholdOptions('editPositive');
            } else {
                newState.currentMenu = 'mainMenu';
                newState.previousMenu = 'mainMenu';
                newState.step = null;
                responseText = "*Em chào đại ka! Đại ka muốn làm gì ✌*";
                replyMarkup = Menu.createStartMenu();
            }
            StateManager.save(chatId, newState);
            break;
        case 'go_back':
            if (state.step === 'selectEditTransaction' || state.step === 'selectDeleteTransaction') {
                newState.currentMenu = 'manageData';
                newState.previousMenu = 'mainMenu';
                newState.step = null;
                newState.transactions = null;
                newState.date = null;
                responseText = "Chọn hành động với số liệu:";
                replyMarkup = Menu.createManageDataMenu();
            } else if (state.currentMenu === 'addData') {
                newState.currentMenu = 'manageData';
                newState.previousMenu = 'mainMenu';
                newState.step = null;
                responseText = "Chọn hành động với số liệu:";
                replyMarkup = Menu.createManageDataMenu();
            } else if (state.currentMenu === 'customerMenu' || state.currentMenu === 'checkDebt' || state.currentMenu === 'manageShareholders') {
                newState.currentMenu = 'mainMenu';
                newState.previousMenu = 'mainMenu';
                newState.step = null;
                responseText = "*Em chào đại ka! Đại ka muốn làm gì ✌*";
                replyMarkup = Menu.createStartMenu();
            } else if (state.currentMenu === 'editData') {
                newState.currentMenu = 'manageData';
                newState.previousMenu = 'mainMenu';
                newState.step = null;
                responseText = "Chọn hành động với số liệu:";
                replyMarkup = Menu.createManageDataMenu();
            } else if (state.currentMenu === 'deleteData') {
                newState.currentMenu = 'manageData';
                newState.previousMenu = 'mainMenu';
                newState.step = null;
                responseText = "Chọn hành động với số liệu:";
                replyMarkup = Menu.createManageDataMenu();

            } else if (state.currentMenu === 'deleteCustomer' || state.currentMenu === 'editThreshold') {
                newState.currentMenu = 'customerMenu';
                newState.previousMenu = 'mainMenu';
                responseText = "Chọn hành động với khách hàng:";
                replyMarkup = Menu.createCustomerMenu();
            } else if (state.currentMenu === 'checkCustomer') {
                newState.currentMenu = 'checkData';
                newState.previousMenu = 'mainMenu';
                newState.step = 'awaitingTimeRange';
                responseText = "*BÁO CÁO SỐ LIỆU*\n\n_Nhập thời gian theo các định dạng:_\n• *Ngày:* _10/5 hoặc 10/5/2022_\n• *Khoảng ngày:* _10/5-12/9_\n• *Tháng:* _4/2022_\n• *Khoảng tháng:* _3/2022-6/2022_\n• *Năm:* _2022_\n• *Khoảng năm:* _2021-2022_";
                replyMarkup = Menu.createCheckData(false);
            } else if (state.currentMenu === 'checkTime' && state.previousMenu === 'checkCustomer') {
                newState.currentMenu = 'checkCustomer';
                newState.previousMenu = 'checkData';
                newState.step = null;
                newState.customerName = null;
                responseText = "Chọn khách hàng để kiểm tra:";
                replyMarkup = Menu.createCustomerList();
            } else if (state.currentMenu === 'reportCommission' || state.currentMenu === 'settingCommission' || state.currentMenu === 'awaitingCommissionInput' || state.currentMenu === 'splitShares') {
                newState.currentMenu = 'manageShareholders';
                newState.previousMenu = 'mainMenu';
                newState.step = null;
                responseText = "Chọn thao tác với cổ đông:";
                replyMarkup = Menu.createShareholderMenu();
            } else if (state.step === 'confirmDeleteCustomer') {
                newState.currentMenu = 'deleteCustomer';
                newState.previousMenu = 'customerMenu';
                newState.step = null;
                responseText = "Chọn khách hàng để xóa:";
                replyMarkup = Menu.createCustomerDeleteList();
            } else {
                newState.currentMenu = 'mainMenu';
                newState.previousMenu = 'mainMenu';
                newState.step = null;
                responseText = "*Em chào đại ka! Đại ka muốn làm gì ✌*";
                replyMarkup = Menu.createStartMenu();
            }
            break;
        case 'enter_date':
            newState.step = 'awaitingDate';
            responseText = "Vui lòng nhập ngày (d/m hoặc d/m/yyyy):";
            replyMarkup = Menu.createDateInput();
            break;
        case 'back_to_customer_list':
            newState.currentMenu = 'addData';
            newState.previousMenu = 'manageData';
            newState.step = null;
            newState.customerName = null;
            newState.date = null;
            responseText = "Chọn khách hàng để thêm số liệu:";
            replyMarkup = Menu.createCustomerList();
            break;
        case 'back_to_amount_options':
            newState.step = 'enterAmount1';
            responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n  _Nhập Số liệu:_`;
            replyMarkup = Menu.createAmountOptions();
            break;
        case 'skip_amount1':
            newState.amount1 = 0;
            newState.step = 'enterAmount2';
            responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* 0\n  _Nhập Thu bù:_`;
            replyMarkup = Menu.createAmount2Options();
            break;
        case 'skip_amount2':
            newState.amount2 = 0;
            newState.step = 'enterAmount3';
            responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* 0\n  _Nhập Mục khác:_`;
            replyMarkup = Menu.createAmount3Options();
            break;
        case 'skip_amount3':
            newState.amount3 = 0;
            newState.step = 'enterNote';
            responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* 0\n  _Nhập Ghi chú:_`;
            replyMarkup = Menu.createNoteOptions();
            break;
        case 'skip_note':
            if (!state.date || !state.customerName) {
                Telegram.sendMessage(chatId, 'Giao dịch đã được xử lý hoặc hết hạn. Vui lòng bắt đầu lại.', Menu.createStartMenu());
                return;
            }
            Sheets.addCustomerData(state.customerName, state.date, state.amount1 || 0, state.amount2 || 0, state.amount3 || 0, state.note);
            // Chỉnh sửa tin nhắn cũ để xóa nút và dòng "Nhập..."
            if (state.messageId) {
                const oldMessageText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(state.amount3 || 0)}\n*• Ghi chú:* Không có`;
                Telegram.editMessage(chatId, state.messageId, oldMessageText, {
                    inline_keyboard: []
                });
            }
            // Gửi tin nhắn mới (ngắn gọn) với 2 nút
responseText = `Lưu dữ liệu thành công ✅\n`;
replyMarkup = Menu.createPostSave();
StateManager.clear(chatId);
Telegram.sendMessage(chatId, responseText, replyMarkup);
return;
        case 'save_data':
            if (!state.date || !state.customerName) {
                Telegram.sendMessage(chatId, 'Giao dịch đã được xử lý hoặc hết hạn. Vui lòng bắt đầu lại.', Menu.createStartMenu());
                return;
            }
            Sheets.addCustomerData(state.customerName, state.date, state.amount1 || 0, state.amount2 || 0, state.amount3 || 0, state.note || '');
            // Chỉnh sửa tin nhắn cũ để xóa nút và dòng "Nhập..."
            if (state.messageId) {
                const oldMessageText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(state.amount3 || 0)}\n*• Ghi chú:* ${state.note || 'Không có'}`;
                Telegram.editMessage(chatId, state.messageId, oldMessageText, {
                    inline_keyboard: []
                });
            }
            // Gửi tin nhắn mới (ngắn gọn) với 2 nút
responseText = `Lưu dữ liệu thành công ✅\n`;
replyMarkup = Menu.createPostSave();
StateManager.clear(chatId);
Telegram.sendMessage(chatId, responseText, replyMarkup);
return;

        case 'return_to_main':
            newState.currentMenu = 'mainMenu';
            newState.previousMenu = 'mainMenu';
            newState.step = null;
            responseText = "*Em chào đại ka! Đại ka muốn làm gì ✌*";
            replyMarkup = Menu.createStartMenu();
            break;
        case 'back_to_transaction_list': {
            responseText = `Danh sách giao dịch ngày ${state.date}:`;
            const isEditFlow =
                state.currentMenu === 'editData' ||
                state.step === 'selectEditTransaction' ||
                (typeof state.step === 'string' && state.step.startsWith('edit'));
            const mode = isEditFlow ? 'edit' : 'delete';
            replyMarkup = Menu.createTransactionList(state.transactions || [], mode);
            break;
        }

        default:
            responseText = "Lựa chọn không hợp lệ. Vui lòng thử lại.";
            replyMarkup = Menu.createStartMenu();
            Telegram.sendMessage(chatId, responseText, replyMarkup);
            return;
    }

    StateManager.save(chatId, newState);
    if (responseText && replyMarkup) {
        Telegram.editMessage(chatId, messageId, responseText, replyMarkup);
    }
    Logger.logInfo('handleMenuAction', `Processed ${callbackData} in ${Date.now() - startTime}ms`, {
        chatId
    });
}

/**
 * Xử lý tin nhắn văn bản từ người dùng.
 * @param {string} text - Nội dung tin nhắn.
 * @param {string} chatId - ID của chat.
 * @param {string} messageId - ID của tin nhắn.
 */
function handleTextMessage(text, chatId, messageId) {
    safeExecute(() => {
        const state = StateManager.load(chatId);
        Logger.logInfo('handleTextMessage', `Received text: ${text}, state.step: ${state.step}`, {
            chatId
        });
        if (text === '/start') {
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, "*Em chào đại ka! Đại ka muốn làm gì ✌*", Menu.createStartMenu());
            return;
        }

        const newState = {
            ...state
        };
        const currentYear = new Date().getFullYear();

        if (state.step === 'awaitingShareholderName') {
            const shareholderName = text.toUpperCase().trim();
            if (!shareholderName) {
                Telegram.sendMessage(chatId, "Tên cổ đông không hợp lệ. Vui lòng nhập lại.");
                return;
            }
            const result = Config.addShareholder(shareholderName);
            Sheets.clearCustomerMenuCache();
            StateManager.clear(chatId);
            Telegram.sendMessage(chatId, result, Menu.createShareholderMenu());
        } else if (state.step === 'awaitingCustomerName') {
            if (text.trim()) {
                const customerName = text.toUpperCase();
                if (!Sheets.isCustomerExist(customerName)) {
                    const result = Sheets.addNewCustomer(customerName);
                    newState.currentMenu = 'mainMenu';
                    newState.previousMenu = 'mainMenu';
                    newState.step = null;
                    StateManager.save(chatId, newState);
                    Telegram.sendMessage(chatId, result, Menu.createStartMenu());
                } else {
                    Telegram.sendMessage(chatId, "Khách hàng đã tồn tại. Vui lòng nhập tên khác.");
                }
            }
        } else if (state.step === 'awaitingShareDate') {
            const fullDatePattern = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
            const shortDatePattern = /^\d{1,2}\/\d{1,2}$/;
            let formattedDate;

            if (fullDatePattern.test(text)) {
                const [day, month, year] = text.split("/").map(Number);
                if (day > 0 && day <= 31 && month > 0 && month <= 12 && year >= 2000) {
                    formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (d/m hoặc d/m/yyyy).");
                    return;
                }
            } else if (shortDatePattern.test(text)) {
                const [day, month] = text.split("/").map(Number);
                if (day > 0 && day <= 31 && month > 0 && month <= 12) {
                    formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${currentYear}`;
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (d/m hoặc d/m/yyyy).");
                    return;
                }
            } else {
                Telegram.sendMessage(chatId, "Định dạng ngày không đúng (d/m hoặc d/m/yyyy). Vui lòng nhập lại.");
                return;
            }

            newState.date = formattedDate;
            newState.step = 'enterShareAmount2';
            StateManager.save(chatId, newState);
            const responseText = `Ngày: ${formattedDate}\n*• Cổ đông:* ${state.customerName}\n  _Nhập Thu bù:_`;
            Telegram.editMessage(chatId, state.messageId, responseText, Menu.createShareSplitAmount2Options());
        } else if (state.step === 'awaitingDate') {
            const fullDatePattern = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
            const shortDatePattern = /^\d{1,2}\/\d{1,2}$/;
            let formattedDate;

            if (fullDatePattern.test(text)) {
                const [day, month, year] = text.split("/").map(Number);
                if (day > 0 && day <= 31 && month > 0 && month <= 12 && year >= 2000) {
                    formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (d/m hoặc d/m/yyyy).");
                    return;
                }
            } else if (shortDatePattern.test(text)) {
                const [day, month] = text.split("/").map(Number);
                if (day > 0 && day <= 31 && month > 0 && month <= 12) {
                    formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${currentYear}`;
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (d/m hoặc d/m/yyyy).");
                    return;
                }
            } else {
                Telegram.sendMessage(chatId, "Định dạng ngày không đúng (d/m hoặc d/m/yyyy). Vui lòng nhập lại.");
                return;
            }

            newState.date = formattedDate;
            newState.step = 'enterAmount1';
            StateManager.save(chatId, newState);
            const responseText = `Ngày: ${formattedDate}\n*• Khách hàng:* ${state.customerName}\n  _Nhập Số liệu:_`;
            Telegram.editMessage(chatId, state.messageId, responseText, Menu.createAmountOptions());
        } else if (state.step === 'enterShareAmount2') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount)) {
                newState.amount2 = amount;
                newState.step = 'enterShareAmount3';
                StateManager.save(chatId, newState);
                const responseText = `Ngày: ${state.date}\n*• Cổ đông:* ${state.customerName}\n*• Thu bù:* ${Sheets.formatNumberWithDot(amount)}\n  _Nhập Mục khác:_`;
                Telegram.editMessage(chatId, state.messageId, responseText, Menu.createShareSplitAmount3Options());
            } else {
                Telegram.sendMessage(chatId, "Thu bù không hợp lệ. Vui lòng nhập số.");
            }
        } else if (state.step === 'enterShareAmount3') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount)) {
                newState.amount3 = amount;
                newState.step = 'confirmShareSplit';
                StateManager.save(chatId, newState);
                const responseText = `Ngày: ${state.date}\n*• Cổ đông:* ${state.customerName}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(amount)}\n*• Ghi chú:* Chia cổ phần\nDữ liệu đã sẵn sàng để lưu:`;
                Telegram.editMessage(chatId, state.messageId, responseText, Menu.createShareSplitSaveOptions());
            } else {
                Telegram.sendMessage(chatId, "Mục khác không hợp lệ. Vui lòng nhập số.");
            }
        } else if (state.step === 'enterAmount1') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount)) {
                newState.amount1 = amount;
                newState.step = 'enterAmount2';
                StateManager.save(chatId, newState);
                const responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(amount)}\n  _Nhập Thu bù:_`;
                Telegram.editMessage(chatId, state.messageId, responseText, Menu.createAmount2Options());
            } else {
                Telegram.sendMessage(chatId, "Số liệu không hợp lệ. Vui lòng nhập số.");
            }
        } else if (state.step === 'enterAmount2') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount)) {
                newState.amount2 = amount;
                newState.step = 'enterAmount3';
                StateManager.save(chatId, newState);
                const responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(amount)}\n  _Nhập Mục khác:_`;
                Telegram.editMessage(chatId, state.messageId, responseText, Menu.createAmount3Options());
            } else {
                Telegram.sendMessage(chatId, "Thu bù không hợp lệ. Vui lòng nhập số.");
            }
        } else if (state.step === 'enterAmount3') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount)) {
                newState.amount3 = amount;
                newState.step = 'enterNote';
                StateManager.save(chatId, newState);
                const responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(amount)}\n  _Nhập Ghi chú:_`;
                Telegram.editMessage(chatId, state.messageId, responseText, Menu.createNoteOptions());
            } else {
                Telegram.sendMessage(chatId, "Mục khác không hợp lệ. Vui lòng nhập số.");
            }
        } else if (state.step === 'enterNote') {
            newState.note = text.trim() || '';
            newState.currentMenu = 'mainMenu';
            newState.previousMenu = 'mainMenu';
            newState.step = null;
            StateManager.save(chatId, newState);
            const responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(state.amount3 || 0)}\n*• Ghi chú:* ${text.trim() || 'Không có'}\nDữ liệu đã sẵn sàng để lưu:`;
            Telegram.editMessage(chatId, state.messageId, responseText, Menu.createSaveOptions());
        } else if (state.step === 'awaitingEditDate' || state.step === 'awaitingDeleteDate') {
            Logger.logInfo('handleTextMessage', `Processing date input for ${state.step}, date: ${text}`, {
                chatId
            });
            const fullDatePattern = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
            const shortDatePattern = /^\d{1,2}\/\d{1,2}$/;
            let formattedDate, inputDate;

            if (fullDatePattern.test(text)) {
                const [day, month, year] = text.split("/").map(Number);
                if (day > 0 && day <= 31 && month > 0 && month <= 12 && year === currentYear) {
                    formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
                    inputDate = new Date(year, month - 1, day);
                } else {
                    Telegram.sendMessage(chatId, `Ngày tháng không hợp lệ hoặc không trong năm hiện tại (${currentYear}). Vui lòng nhập lại (d/m hoặc d/m/yyyy).`);
                    return;
                }
            } else if (shortDatePattern.test(text)) {
                const [day, month] = text.split("/").map(Number);
                if (day > 0 && day <= 31 && month > 0 && month <= 12) {
                    formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${currentYear}`;
                    inputDate = new Date(currentYear, month - 1, day);
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (d/m hoặc d/m/yyyy).");
                    return;
                }
            } else {
                Telegram.sendMessage(chatId, "Định dạng ngày không đúng (d/m hoặc d/m/yyyy). Vui lòng nhập lại.");
                return;
            }

            const transactions = Sheets.getTransactionsByDate(formattedDate, { excludeShareholders: true });
            if (transactions.length === 0) {
                Telegram.sendMessage(chatId, `Không có giao dịch nào vào ngày ${formattedDate}.`);
                return;
            }

            newState.date = formattedDate;
            newState.transactions = transactions;
            newState.step = state.step === 'awaitingEditDate' ? 'selectEditTransaction' : 'selectDeleteTransaction';
            StateManager.save(chatId, newState);
            const responseText = `Danh sách giao dịch ngày ${formattedDate}:`;
            Telegram.sendMessage(chatId, responseText, Menu.createTransactionList(transactions, state.step === 'awaitingEditDate' ? 'edit' : 'delete'));
        } else if (state.step === 'editPositiveThreshold') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount) && amount >= 0) {
                newState.positiveThreshold = amount;
                newState.step = 'editNegativeThreshold';
                StateManager.save(chatId, newState);
                const responseText = `*Khách hàng:* ${state.customerName}\n*Hạn mức dương:* ${Sheets.formatNumberWithDot(amount)}\n_Nhập hạn mức âm_ (hiện tại: ${Sheets.formatNumberWithDot(state.negativeThreshold)}):`;
                Telegram.editMessage(chatId, state.editMessageId, responseText, Menu.createThresholdOptions('editNegative'));
            } else {
                Telegram.sendMessage(chatId, "Hạn mức dương không hợp lệ. Vui lòng nhập số không âm.");
            }
        } else if (state.step === 'editNegativeThreshold') {
  const amount = parseInt(text, 10);
  if (!isNaN(amount)) {
    const newState = { ...state, negativeThreshold: amount };
    StateManager.save(chatId, newState);

    const responseText =
      `*Khách hàng:* ${state.customerName}\n` +
      `*Hạn mức dương:* ${Sheets.formatNumberWithDot(state.positiveThreshold || 0)}\n` +
      `*Hạn mức âm:* ${Sheets.formatNumberWithDot(amount)}\n` +
      `Xác nhận lưu hạn mức?`;

    // Hiển thị màn hình XÁC NHẬN thay vì lưu ngay
    Telegram.editMessage(chatId, state.editMessageId, responseText, Menu.createThresholdOptions('confirm'));
  } else {
    Telegram.sendMessage(chatId, "Hạn mức âm không hợp lệ. Vui lòng nhập số.");
  }
        } else if (state.step === 'editAmount1') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount)) {
                newState.amount1 = amount;
                newState.step = 'editAmount2';
                StateManager.save(chatId, newState);
                const responseText = `*Ngày:* ${state.date}\n*Khách hàng:* ${state.customerName}\n*Số liệu:* ${Sheets.formatNumberWithDot(amount)}\n  _Nhập Thu bù_ (hiện tại: ${Sheets.formatNumberWithDot(state.amount2)}):`;
                Telegram.editMessage(chatId, state.editMessageId, responseText, Menu.createEditTransactionOptions('editAmount2'));
            } else {
                Telegram.sendMessage(chatId, "Số liệu không hợp lệ. Vui lòng nhập số.");
            }
        } else if (state.step === 'editAmount2') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount)) {
                newState.amount2 = amount;
                newState.step = 'editAmount3';
                StateManager.save(chatId, newState);
                const responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(amount)}\n  _Nhập Mục khác_ (hiện tại: ${Sheets.formatNumberWithDot(state.amount3)}):`;
                Telegram.editMessage(chatId, state.editMessageId, responseText, Menu.createEditTransactionOptions('editAmount3'));
            } else {
                Telegram.sendMessage(chatId, "Thu bù không hợp lệ. Vui lòng nhập số.");
            }
        } else if (state.step === 'editAmount3') {
            const amount = parseInt(text, 10);
            if (!isNaN(amount)) {
                newState.amount3 = amount;
                newState.step = 'editNote';
                StateManager.save(chatId, newState);
                const responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(amount)}\n  _Nhập Ghi chú_ (hiện tại: ${state.note || 'Không có'}):`;
                Telegram.editMessage(chatId, state.editMessageId, responseText, Menu.createEditTransactionOptions('editNote'));
            } else {
                Telegram.sendMessage(chatId, "Mục khác không hợp lệ. Vui lòng nhập số.");
            }
        } else if (state.step === 'editNote') {
            newState.note = text.trim() || '';
            newState.step = 'confirmEdit';
            StateManager.save(chatId, newState);
            const responseText = `Ngày: ${state.date}\n*• Khách hàng:* ${state.customerName}\n*• Số liệu:* ${Sheets.formatNumberWithDot(state.amount1 || 0)}\n*• Thu bù:* ${Sheets.formatNumberWithDot(state.amount2 || 0)}\n*• Mục khác:* ${Sheets.formatNumberWithDot(state.amount3 || 0)}\n*• Ghi chú:* ${text.trim() || 'Không có'}\nDữ liệu đã sẵn sàng để lưu:`;
            Telegram.editMessage(chatId, state.editMessageId, responseText, Menu.createEditTransactionOptions('confirmEdit'));
        } else if (state.step === 'awaitingDebtDate') {
            const fullDatePattern = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
            const shortDatePattern = /^\d{1,2}\/\d{1,2}$/;
            let formattedDate, specificDate;

            if (fullDatePattern.test(text)) {
                const [day, month, year] = text.split("/").map(Number);
                if (day > 0 && day <= 31 && month > 0 && month <= 12 && year >= 2000) {
                    formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
                    specificDate = new Date(year, month - 1, day);
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (d/m hoặc d/m/yyyy).");
                    return;
                }
            } else if (shortDatePattern.test(text)) {
                const [day, month] = text.split("/").map(Number);
                if (day > 0 && day <= 31 && month > 0 && month <= 12) {
                    formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${currentYear}`;
                    specificDate = new Date(currentYear, month - 1, day);
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (d/m hoặc d/m/yyyy).");
                    return;
                }
            } else {
                Telegram.sendMessage(chatId, "Định dạng ngày không đúng (d/m hoặc d/m/yyyy). Vui lòng nhập lại.");
                return;
            }

            const result = Sheets.getDebtReportForDate(specificDate, Config.getYearFiles());
            newState.currentMenu = 'mainMenu';
            newState.previousMenu = 'mainMenu';
            newState.step = null;
            StateManager.save(chatId, newState);
            Telegram.sendMessage(chatId, result, Menu.createStartMenu());
        } else if (state.step === 'awaitingCommission' && state.selectedShareholder) {
            const parts = text.trim().split(/\s+/);
            if (parts.length !== 2) {
                Telegram.sendMessage(chatId, "❌ Định dạng không hợp lệ. Vui lòng nhập theo định dạng: DD/MM/YYYY % (Ví dụ: 1/5/2026 10)");
                return;
            }

            const dateStr = parts[0];
            const rateStr = parts[1];

            // Parse ngày
            const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
            const dateMatch = dateStr.match(dateRegex);
            if (!dateMatch) {
                Telegram.sendMessage(chatId, "❌ Định dạng ngày không hợp lệ. Vui lòng dùng định dạng DD/MM/YYYY (Ví dụ: 01/05/2026).");
                return;
            }

            const day = parseInt(dateMatch[1], 10);
            const month = parseInt(dateMatch[2], 10);
            const year = parseInt(dateMatch[3], 10);
            const applyDate = new Date(year, month - 1, day);
            if (isNaN(applyDate.getTime())) {
                Telegram.sendMessage(chatId, "❌ Ngày không hợp lệ.");
                return;
            }
            
            // Cập nhật timezone string
            const formattedApplyDate = Utilities.formatDate(applyDate, Config.getTimezone(), "yyyy-MM-dd");

            // Parse tỷ lệ %
            let rateVal = parseFloat(rateStr);
            if (isNaN(rateVal)) {
                Telegram.sendMessage(chatId, "❌ Tỷ lệ phần trăm không hợp lệ. Vui lòng nhập số (Ví dụ: 10 hoặc 12.5).");
                return;
            }
            // Nếu người dùng nhập 10, ta hiểu là -10% tức là -0.10
            // Nếu người dùng nhập -10, ta cũng hiểu là -0.10
            const rateDecimal = -Math.abs(rateVal) / 100;

            try {
                const allRates = Config.getShareholderRates();
                const shareholderRates = allRates[state.selectedShareholder] || [];
                
                // Xóa cài đặt cũ nếu trùng ngày, sau đó thêm mới và sắp xếp lại
                const filteredRates = shareholderRates.filter(r => r.startDate !== formattedApplyDate);
                filteredRates.push({ startDate: formattedApplyDate, rate: rateDecimal });
                filteredRates.sort((a, b) => Config.parseConfigDateMs(a.startDate) - Config.parseConfigDateMs(b.startDate));
                
                allRates[state.selectedShareholder] = filteredRates;
                Config.setConfig('shareholderRates', allRates);

                StateManager.clear(chatId);
                const responseText = `✅ Đã cập nhật thành công mức hoa hồng cho cổ đông *${state.selectedShareholder}*.\n\nTừ ngày *${dateStr}*, tỷ lệ áp dụng là *${Math.abs(rateVal)}%*.`;
                Telegram.sendMessage(chatId, responseText, Menu.createStartMenu());
                Logger.logInfo('handleTextMessage', `Updated commission for ${state.selectedShareholder} to ${rateDecimal} starting ${formattedApplyDate}`);
            } catch (e) {
                Telegram.sendMessage(chatId, `❌ Lỗi khi cập nhật hoa hồng: ${e.message}`);
            }
        } else if (state.step === 'awaitingTimeRange') {
            const singleDatePattern = /^\d{1,2}\/\d{1,2}(\/\d{4})?$/;
            const dateRangePattern = /^(\d{1,2}\/\d{1,2}(\/\d{4})?)-(\d{1,2}\/\d{1,2}(\/\d{4})?)$/;
            const singleMonthPattern = /^\d{1,2}\/\d{4}$/;
            const monthRangePattern = /^\d{1,2}\/\d{4}-\d{1,2}\/\d{4}$/;
            const singleYearPattern = /^(?:năm\s*)?(\d{4})$/i;
            const yearRangePattern = /^\d{4}-\d{4}$/;
            const yearFiles = Config.getYearFiles();
            let result;

            if (singleDatePattern.test(text)) {
                const parts = text.split("/");
                let day, month, year;
                if (parts.length === 3) {
                    [day, month, year] = parts.map(Number);
                } else {
                    [day, month] = parts.map(Number);
                    year = currentYear;
                }
                if (day > 0 && day <= 31 && month > 0 && month <= 12 && year >= 2000) {
                    const specificDate = new Date(year, month - 1, day);
                    if (state.currentMenu === 'manageShareholders' || state.currentMenu === 'reportCommission') {
                        result = Sheets.calculateShareholderCommission(specificDate, specificDate, yearFiles);
                    } else {
                        result = state.customerName ?
                            `*Số liệu của khách hàng ${state.customerName} vào ngày ${Utilities.formatDate(specificDate, Config.getTimezone(), "dd/MM/yyyy")}:*\n\n${Sheets.formatNumberWithDot(Sheets.getCustomerDataInDaySimple(state.customerName, specificDate, yearFiles))}` :
                            Sheets.checkDataInRange(specificDate, specificDate, yearFiles);
                    }
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (ví dụ: 9/4 hoặc 9/4/2025).");
                    return;
                }
            } else if (dateRangePattern.test(text)) {
                const [start, end] = text.split('-').map(part => part.trim());
                const startParts = start.split("/");
                const endParts = end.split("/");
                let startDay, startMonth, startYear, endDay, endMonth, endYear;

                if (startParts.length === 3) {
                    [startDay, startMonth, startYear] = startParts.map(Number);
                } else {
                    [startDay, startMonth] = startParts.map(Number);
                    startYear = currentYear;
                }
                if (endParts.length === 3) {
                    [endDay, endMonth, endYear] = endParts.map(Number);
                } else {
                    [endDay, endMonth] = endParts.map(Number);
                    endYear = currentYear;
                }

                if (startDay > 0 && startDay <= 31 && startMonth > 0 && startMonth <= 12 && startYear >= 2000 &&
                    endDay > 0 && endDay <= 31 && endMonth > 0 && endMonth <= 12 && endYear >= 2000) {
                    const startDate = new Date(startYear, startMonth - 1, startDay);
                    const endDate = new Date(endYear, endMonth - 1, endDay);
                    if (startDate <= endDate) {
                        if (state.currentMenu === 'manageShareholders' || state.currentMenu === 'reportCommission') {
                            result = Sheets.calculateShareholderCommission(startDate, endDate, yearFiles);
                        } else {
                            result = state.customerName ?
                                Sheets.getCustomerDataInRangeSimple(state.customerName, startDate, endDate, yearFiles) :
                                Sheets.checkDataInRange(startDate, endDate, yearFiles);
                        }
                    } else {
                        Telegram.sendMessage(chatId, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc. Vui lòng nhập lại.");
                        return;
                    }
                } else {
                    Telegram.sendMessage(chatId, "Ngày tháng không hợp lệ. Vui lòng nhập lại (ví dụ: 1/4-10/4 hoặc 1/4/2025-10/4/2025).");
                    return;
                }
            } else if (singleMonthPattern.test(text)) {
                const [month, year] = text.split("/").map(Number);
                if (month > 0 && month <= 12 && year >= 2000) {
                    const startDate = new Date(year, month - 1, 1);
                    const endDate = new Date(year, month, 0);
                    if (state.currentMenu === 'manageShareholders' || state.currentMenu === 'reportCommission') {
                        result = Sheets.calculateShareholderCommission(startDate, endDate, yearFiles);
                    } else {
                        result = state.customerName ?
                            Sheets.getCustomerDataInMonthSimple(state.customerName, startDate, endDate, yearFiles) :
                            Sheets.checkDataInRange(startDate, endDate, yearFiles);
                    }
                } else {
                    Telegram.sendMessage(chatId, "Tháng hoặc năm không hợp lệ. Vui lòng nhập lại (ví dụ: 4/2025).");
                    return;
                }
            } else if (monthRangePattern.test(text)) {
                const [start, end] = text.split('-').map(part => part.trim());
                const [startMonth, startYear] = start.split("/").map(Number);
                const [endMonth, endYear] = end.split("/").map(Number);
                if (startMonth > 0 && startMonth <= 12 && startYear >= 2000 && endMonth > 0 && endMonth <= 12 && endYear >= 2000) {
                    const startDate = new Date(startYear, startMonth - 1, 1);
                    const endDate = new Date(endYear, endMonth, 0);
                    if (startDate <= endDate) {
                        if (state.currentMenu === 'manageShareholders' || state.currentMenu === 'reportCommission') {
                            result = Sheets.calculateShareholderCommission(startDate, endDate, yearFiles);
                        } else {
                            result = state.customerName ?
                                Sheets.getCustomerDataInRangeSimple(state.customerName, startDate, endDate, yearFiles) :
                                Sheets.checkDataInRange(startDate, endDate, yearFiles);
                        }
                    } else {
                        Telegram.sendMessage(chatId, "Tháng bắt đầu phải nhỏ hơn hoặc bằng tháng kết thúc. Vui lòng nhập lại.");
                        return;
                    }
                } else {
                    Telegram.sendMessage(chatId, "Tháng hoặc năm không hợp lệ. Vui lòng nhập lại (ví dụ: 3/2025-6/2025).");
                    return;
                }
            } else if (singleYearPattern.test(text)) {
                const y = Number(singleYearPattern.exec(text)[1]);
                if (y >= 2000) {
                    const startDate = new Date(y, 0, 1);
                    const endDate = new Date(y, 11, 31);
                    if (state.currentMenu === 'manageShareholders' || state.currentMenu === 'reportCommission') {
                        result = Sheets.calculateShareholderCommission(startDate, endDate, yearFiles);
                    } else {
                        result = state.customerName ?
                            Sheets.getCustomerDataInRangeSimple(state.customerName, startDate, endDate, yearFiles) :
                            Sheets.checkDataInRange(startDate, endDate, yearFiles);
                    }
                } else {
                    Telegram.sendMessage(chatId, "Năm không hợp lệ. Vui lòng nhập như 2025.");
                    return;
                }


            } else if (yearRangePattern.test(text)) {
                const [startYear, endYear] = text.split("-").map(Number);
                if (startYear >= 2000 && endYear >= 2000 && startYear <= endYear) {
                    const startDate = new Date(startYear, 0, 1);
                    const endDate = new Date(endYear, 11, 31);
                    if (state.currentMenu === 'manageShareholders' || state.currentMenu === 'reportCommission') {
                        result = Sheets.calculateShareholderCommission(startDate, endDate, yearFiles);
                    } else {
                        result = state.customerName ?
                            Sheets.getCustomerDataInRangeSimple(state.customerName, startDate, endDate, yearFiles) :
                            Sheets.checkDataInRange(startDate, endDate, yearFiles);
                    }
                } else {
                    Telegram.sendMessage(chatId, "Khoảng năm không hợp lệ. Vui lòng nhập lại (ví dụ: 2023-2025).");
                    return;
                }
            } else {
                Telegram.sendMessage(chatId, "Định dạng không đúng. Vui lòng nhập theo một trong các định dạng: \n- _Ngày: (ví dụ: 1/4-10/4 hoặc 1/4/2025-10/4/2025 hoặc 9/4 hoặc 9/4/2025)_\n- _Tháng: (ví dụ: 3/2025-6/2025 hoặc 4/2025)_\n- _Năm: (ví dụ: 2023-2025)_");
                return;
            }

            newState.currentMenu = 'mainMenu';
            newState.previousMenu = 'mainMenu';
            newState.step = null;
            StateManager.save(chatId, newState);
            const shouldEditReportMessage = state.currentMenu === 'checkData' || state.currentMenu === 'checkTime' || state.currentMenu === 'checkCustomer';
            const targetMessageId = state.editMessageId || state.messageId;
            if (shouldEditReportMessage && targetMessageId) {
                Telegram.editMessage(chatId, targetMessageId, result, Menu.createStartMenu());
            } else {
                Telegram.sendMessage(chatId, result, Menu.createStartMenu());
            }

        } else {
            Logger.logError('handleTextMessage', `Unexpected state.step: ${state.step}`, {
                chatId,
                text
            });
            Telegram.sendMessage(
                chatId,
                "Sử dụng menu để thao tác hoặc nhập /start để bắt đầu lại.",
                Menu.createStartMenu()
            );
        }
    }, 'handleTextMessage', chatId);
}

/**
 * Thực thi hàm an toàn với error handling.
 * @param {Function} fn - Hàm cần thực thi.
 * @param {string} context - Ngữ cảnh để ghi log.
 * @param {string} chatId - ID của chat.
 */
function safeExecute(fn, context, chatId) {
    try {
        fn();
    } catch (e) {
        Logger.logError(context, e.message, {
            chatId,
            stack: e.stack
        });
        if (chatId) {
            Telegram.sendMessage(chatId, `Lỗi hệ thống: ${e.message}`, Menu.createStartMenu());
        }
    }
}
