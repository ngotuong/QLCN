// Menu.gs
const Menu = {
    _startMenuMarkup: JSON.stringify({
        inline_keyboard: [
            [
                { text: "👤 Khách hàng", callback_data: 'nav_customer_menu' },
                { text: "📝 Quản lý số liệu", callback_data: 'nav_manage_data' }
            ],
            [
                { text: "📊 Báo cáo số liệu", callback_data: 'check_data' },
                { text: "💰 Báo cáo công nợ", callback_data: 'check_debt' }
            ],
            [{ text: "🏢 Quản lý cổ đông", callback_data: 'nav_shareholders' }],
            [{ text: "⚙️ Cài đặt", callback_data: 'admin_menu' }]
        ]
    }),

    _manageDataMenuMarkup: JSON.stringify({
        inline_keyboard: [
            [{ text: "➕ Thêm số liệu", callback_data: 'add_data' }],
            [
                { text: "✏️ Sửa số liệu", callback_data: 'edit_data' },
                { text: "🗑️ Xóa số liệu", callback_data: 'delete_data' }
            ],
            [{ text: "🔙 Quay lại", callback_data: 'nav_main' }]
        ]
    }),

    /**
     * Tạo markup cho menu chính.
     * @returns {string} JSON string của inline keyboard.
     */
    createStartMenu() {
        return this._startMenuMarkup;
    },

    /**
     * Tạo markup cho menu Quản lý số liệu.
     * @returns {string} JSON string của inline keyboard.
     */
    createManageDataMenu() {
        return this._manageDataMenuMarkup;
    },

    createAdminMenu() {
        return JSON.stringify({
            inline_keyboard: [
                [
                    { text: "📋 Trạng thái", callback_data: 'admin_status' },
                    { text: "🎆 Khởi tạo năm mới", callback_data: 'admin_create_new_year' }
                ],
                [
                    { text: "🔄 Làm mới cache", callback_data: 'admin_refresh_cache' },
                    { text: "🧹 Xóa phiên hiện tại", callback_data: 'admin_clear_state' }
                ],
                [{ text: "🔙 Quay lại", callback_data: 'nav_main' }]
            ]
        });
    },

    /**
     * Tạo markup cho danh sách giao dịch trong ngày.
     * @param {Object[]} transactions - Danh sách giao dịch.
     * @param {string} action - Hành động (edit/delete).
     * @returns {string} JSON string của inline keyboard.
     */
    createTransactionList(transactions, action) {
        const startTime = Date.now();
        const inlineKeyboard = [];
        transactions.forEach((transaction, index) => {
            const text = `${transaction.customerName} : ${Sheets.formatNumberWithDot(transaction.amount1)} | ${Sheets.formatNumberWithDot(transaction.amount2)} | ${Sheets.formatNumberWithDot(transaction.amount3)} | ${transaction.note || 'Không'}`;
            inlineKeyboard.push([{
                text,
                callback_data: `${action}_transaction_${index}`
            }]);
        });
        inlineKeyboard.push([{
            text: "🔙 Quay lại",
            callback_data: 'go_back'
        }]);
        const markup = JSON.stringify({
            inline_keyboard: inlineKeyboard
        });
        Logger.logInfo('Menu.createTransactionList', `Created transaction list markup for ${action} with ${transactions.length} items in ${Date.now() - startTime}ms`);
        return markup;
    },

    /**
     * Tạo markup xác nhận xóa giao dịch.
     * @param {number} transactionIndex - Chỉ số giao dịch.
     * @returns {string} JSON string của inline keyboard.
     */
    createDeleteTransactionConfirmation(transactionIndex) {
        const startTime = Date.now();
        const markup = JSON.stringify({
            inline_keyboard: [
                [{
                        text: "✅ Xác nhận",
                        callback_data: `confirm_delete_transaction_${transactionIndex}`
                    },
                    {
                        text: "❌ Hủy",
                        callback_data: 'go_back'
                    }
                ]
            ]
        });
        Logger.logInfo('Menu.createDeleteTransactionConfirmation', `Created delete confirmation markup for transaction index ${transactionIndex} in ${Date.now() - startTime}ms`);
        return markup;
    },

    /**
     * Tạo markup cho chỉnh sửa giao dịch.
     * @param {string} step - Bước hiện tại (editAmount1, editAmount2, editAmount3, editNote, confirmEdit).
     * @returns {string} JSON string của inline keyboard.
     */
    createEditTransactionOptions(step) {
        const startTime = Date.now();
        const inlineKeyboard = [];
        if (step === 'editAmount1') {
            inlineKeyboard.push(
                [{
                    text: "💾 Lưu",
                    callback_data: 'save_edited_data'
                }],
                [{
                    text: "⏭️ Bỏ qua Số liệu",
                    callback_data: 'skip_edit_amount1'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_transaction_list'
                }]
            );
        } else if (step === 'editAmount2') {
            inlineKeyboard.push(
                [{
                    text: "💾 Lưu",
                    callback_data: 'save_edited_data'
                }],
                [{
                    text: "⏭️ Bỏ qua Thu bù",
                    callback_data: 'skip_edit_amount2'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_previous'
                }]
            );
        } else if (step === 'editAmount3') {
            inlineKeyboard.push(
                [{
                    text: "💾 Lưu",
                    callback_data: 'save_edited_data'
                }],
                [{
                    text: "⏭️ Bỏ qua Mục khác",
                    callback_data: 'skip_edit_amount3'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_previous'
                }]
            );
        } else if (step === 'editNote') {
            inlineKeyboard.push(
                [{
                    text: "💾 Lưu",
                    callback_data: 'save_edited_data'
                }],
                [{
                    text: "⏭️ Bỏ qua Ghi chú",
                    callback_data: 'skip_edit_note'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_previous'
                }]
            );
        } else if (step === 'confirmEdit') {
            inlineKeyboard.push(
                [{
                    text: "💾 Lưu",
                    callback_data: 'save_edited_data'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_previous'
                }]
            );
        }
        const markup = JSON.stringify({
            inline_keyboard: inlineKeyboard
        });
        Logger.logInfo('Menu.createEditTransactionOptions', `Created edit transaction options markup for step ${step} in ${Date.now() - startTime}ms`);
        return markup;
    },

    /**
     * Tạo markup cho menu khách hàng.
     * @returns {string} JSON string của inline keyboard.
     */
    // Menu.gs – THAY THẾ HOÀN TOÀN HÀM NÀY
    createCustomerMenu() {
        return JSON.stringify({
            inline_keyboard: [
                [{
                        text: "➕ Thêm khách hàng",
                        callback_data: 'add_customer'
                    },
                    {
                        text: "➖ Xóa khách hàng",
                        callback_data: 'delete_customer'
                    }
                ],
                [{
                    text: "✏️ Chỉnh sửa hạn mức",
                    callback_data: 'edit_threshold'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'nav_main'
                }]
            ]
        });
    },


    /**
     * Tạo markup cho danh sách khách hàng để thêm số liệu hoặc kiểm tra.
     * @returns {string} JSON string của inline keyboard.
     */
    createCustomerList() {
        const startTime = Date.now();
        const cache = CacheService.getScriptCache();
        const cacheKey = 'customerListMarkup';
        let markup = cache.get(cacheKey);
        if (!markup) {
            markup = PropertiesService.getScriptProperties().getProperty(cacheKey);
            if (!markup) {
                const customerNames = Sheets.getCachedCustomerList();
                const inlineKeyboard = [];
                for (let i = 0; i < customerNames.length; i += 3) {
                    const row = customerNames.slice(i, i + 3).map(name => ({
                        text: `👤 ${name}`,
                        callback_data: 'customer_' + name.replace(/\s/g, "_")
                    }));
                    inlineKeyboard.push(row);
                }
                inlineKeyboard.push([{
                    text: "🔙 Quay lại",
                    callback_data: 'go_back'
                }]);
                markup = JSON.stringify({
                    inline_keyboard: inlineKeyboard
                });
                cache.put(cacheKey, markup, 86400);
                PropertiesService.getScriptProperties().setProperty(cacheKey, markup);
                Logger.logInfo('Menu.createCustomerList', `Cached customer list markup with ${customerNames.length} customers in ${Date.now() - startTime}ms`);
            } else {
                cache.put(cacheKey, markup, 86400);
                Logger.logInfo('Menu.createCustomerList', `Retrieved customer list markup from PropertiesService in ${Date.now() - startTime}ms`);
            }
        } else {
            Logger.logInfo('Menu.createCustomerList', `Retrieved customer list markup from cache in ${Date.now() - startTime}ms`);
        }
        return markup;
    },

    // Gợi ý ngày nhanh cho Sửa số liệu
    createEditDateOptions() {
        const startTime = Date.now();
        const markup = JSON.stringify({
            inline_keyboard: [
                [{
                        text: "📅 Hôm nay",
                        callback_data: "edit_today"
                    }],
                    [{
                        text: "📅 Hôm qua",
                        callback_data: "edit_yesterday"
                    }],
                

                [{
                    text: "🔙 Quay lại",
                    callback_data: "go_back"
                }]
            ]
        });
        Logger.logInfo('Menu.createEditDateOptions',
            `Created edit date quick options in ${Date.now() - startTime}ms`);
        return markup;
    },

    // Gợi ý ngày nhanh cho Xóa số liệu
    createDeleteDateOptions() {
        const startTime = Date.now();
        const markup = JSON.stringify({
            inline_keyboard: [
                [{
                        text: "📅 Hôm nay",
                        callback_data: "delete_today"
                    }],
                    [{
                        text: "📅 Hôm qua",
                        callback_data: "delete_yesterday"
                    }
                ],
                [{
                    text: "🔙 Quay lại",
                    callback_data: "go_back"
                }]
            ]
        });
        Logger.logInfo('Menu.createDeleteDateOptions',
            `Created delete date quick options in ${Date.now() - startTime}ms`);
        return markup;
    },


    /**
     * Tạo markup cho danh sách khách hàng để xóa.
     * @returns {string} JSON string của inline keyboard.
     */
    createCustomerDeleteList() {
        const startTime = Date.now();
        const cache = CacheService.getScriptCache();
        const cacheKey = 'customerDeleteListMarkup';
        let markup = cache.get(cacheKey);
        if (!markup) {
            markup = PropertiesService.getScriptProperties().getProperty(cacheKey);
            if (!markup) {
                const customerNames = Sheets.getCachedCustomerList();
                const inlineKeyboard = [];
                for (let i = 0; i < customerNames.length; i += 3) {
                    const row = customerNames.slice(i, i + 3).map(name => ({
                        text: `👤 ${name}`,
                        callback_data: 'delete_customer_' + name.replace(/\s/g, "_")
                    }));
                    inlineKeyboard.push(row);
                }
                inlineKeyboard.push([{
                    text: "🔙 Quay lại",
                    callback_data: 'go_back'
                }]);
                markup = JSON.stringify({
                    inline_keyboard: inlineKeyboard
                });
                cache.put(cacheKey, markup, 86400);
                PropertiesService.getScriptProperties().setProperty(cacheKey, markup);
                Logger.logInfo('Menu.createCustomerDeleteList', `Cached customer delete list markup with ${customerNames.length} customers in ${Date.now() - startTime}ms`);
            } else {
                cache.put(cacheKey, markup, 86400);
                Logger.logInfo('Menu.createCustomerDeleteList', `Retrieved customer delete list markup from PropertiesService in ${Date.now() - startTime}ms`);
            }
        } else {
            Logger.logInfo('Menu.createCustomerDeleteList', `Retrieved customer delete list markup from cache in ${Date.now() - startTime}ms`);
        }
        return markup;
    },

    /**
     * Tạo markup cho danh sách khách hàng để chỉnh sửa hạn mức.
     * @returns {string} JSON string của inline keyboard.
     */
    createCustomerThresholdList() {
        const startTime = Date.now();
        const cache = CacheService.getScriptCache();
        const cacheKey = 'customerThresholdListMarkup';
        let markup = cache.get(cacheKey);
        if (!markup) {
            markup = PropertiesService.getScriptProperties().getProperty(cacheKey);
            if (!markup) {
                const customerNames = Sheets.getCachedCustomerList();
                const inlineKeyboard = [];
                for (let i = 0; i < customerNames.length; i += 3) {
                    const row = customerNames.slice(i, i + 3).map(name => ({
                        text: `👤 ${name}`,
                        callback_data: 'threshold_customer_' + name.replace(/\s/g, "_")
                    }));
                    inlineKeyboard.push(row);
                }
                inlineKeyboard.push([{
                    text: "🔙 Quay lại",
                    callback_data: 'go_back'
                }]);
                markup = JSON.stringify({
                    inline_keyboard: inlineKeyboard
                });
                cache.put(cacheKey, markup, 86400);
                PropertiesService.getScriptProperties().setProperty(cacheKey, markup);
                Logger.logInfo('Menu.createCustomerThresholdList', `Cached customer threshold list markup with ${customerNames.length} customers in ${Date.now() - startTime}ms`);
            } else {
                cache.put(cacheKey, markup, 86400);
                Logger.logInfo('Menu.createCustomerThresholdList', `Retrieved customer threshold list markup from PropertiesService in ${Date.now() - startTime}ms`);
            }
        } else {
            Logger.logInfo('Menu.createCustomerThresholdList', `Retrieved customer threshold list markup from cache in ${Date.now() - startTime}ms`);
        }
        return markup;
    },

    /**
     * Tạo markup xác nhận xóa khách hàng.
     * @param {string} customerName - Tên khách hàng.
     * @returns {string} JSON string của inline keyboard.
     */
    createDeleteConfirmation(customerName) {
        return JSON.stringify({
            inline_keyboard: [
                [{
                        text: "✅ Xác nhận",
                        callback_data: `confirm_delete_${customerName.replace(/\s/g, "_")}`
                    },
                    {
                        text: "❌ Hủy",
                        callback_data: 'go_back'
                    }
                ]
            ]
        });
    },

    /**
     * Tạo markup cho tùy chọn chỉnh sửa hạn mức.
     * @param {string} step - Bước hiện tại (editPositive, editNegative).
     * @returns {string} JSON string của inline keyboard.
     */
    createThresholdOptions(mode) {
    if (mode === 'editPositive') {
      // (giữ nguyên nút "Bỏ qua hạn mức dương" nếu bạn vẫn muốn)
      return {
        inline_keyboard: [
          [{ text: "⏭️ Bỏ qua hạn mức dương", callback_data: "skip_positive_threshold" }],
          [{ text: "↩️ Quay lại", callback_data: "back_to_previous" }]
        ]
      };
    }

    if (mode === 'editNegative') {
      // ❌ KHÔNG còn nút "Bỏ qua hạn mức âm"
      return {
        inline_keyboard: [
          [{ text: "↩️ Quay lại", callback_data: "back_to_previous" }]
        ]
      };
    }

    if (mode === 'confirm') {
      // Màn hình xác nhận sau khi nhập hạn mức âm
      return {
        inline_keyboard: [
          [{ text: "💾 Lưu", callback_data: "save_threshold" }],
          [{ text: "↩️ Quay lại", callback_data: "back_to_previous" }]
        ]
      };
    }

    // fallback
    return { inline_keyboard: [[{ text: "↩️ Quay lại", callback_data: "back_to_previous" }]] };
  },

    /**
     * Tạo markup cho tùy chọn kiểm tra công nợ.
     * @returns {string} JSON string của inline keyboard.
     */
    createCheckDebtOptions() {
        const startTime = Date.now();
        const markup = JSON.stringify({
            inline_keyboard: [
                [{
                    text: "📅 Công nợ hôm nay",
                    callback_data: 'check_debt_today'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'go_back'
                }]
            ]
        });
        Logger.logInfo('Menu.createCheckDebtOptions', `Created check debt options markup in ${Date.now() - startTime}ms`);
        return markup;
    },

    /**
     * Tạo markup cho tùy chọn báo cáo cổ đông.
     * @returns {string} JSON string của inline keyboard.
     */
    createShareholderOptions() {
        const startTime = Date.now();
        const markup = this.createShareholderReportOnlyMenu(true);
        Logger.logInfo('Menu.createShareholderOptions', `Created shareholder options markup in ${Date.now() - startTime}ms`);
        return markup;
    },

    createShareholderReportOnlyMenu(includeBack = false, includeExit = false) {
        const keyboard = [
            [
                { text: "📅 Tháng này", callback_data: 'commission_this_month' },
                { text: "📆 Tháng trước", callback_data: 'commission_prev_month' }
            ],
            [
                { text: "🗓️ Năm nay", callback_data: 'commission_this_year' },
                { text: "🌍 Toàn thời gian", callback_data: 'commission_all_time' }
            ]
        ];
        if (includeBack) {
            keyboard.push([{ text: "🔙 Quay lại", callback_data: 'go_back' }]);
        }
        if (includeExit) {
            keyboard.push([{ text: "Thoát", callback_data: 'shareholder_exit' }]);
        }
        return JSON.stringify({ inline_keyboard: keyboard });
    },

    createShareholderGroupMenu() {
        return this.createShareholderReportOnlyMenu(false, true);
    },


    /**
     * Tạo markup cho tùy chọn kiểm tra số liệu theo thời gian.
     * @param {boolean} isCustomerReport - Nếu true, ẩn tùy chọn "Báo cáo khách hàng"
     * @returns {string} JSON string của inline keyboard.
     */
    createCheckData(isCustomerReport = false) {
        const keyboard = [];
        if (!isCustomerReport) {
            keyboard.push([{
                text: "👤 Báo cáo khách hàng",
                callback_data: 'check_by_customer'
            }]);
        }
        keyboard.push(
            [{
                text: "📅 Hôm nay",
                callback_data: 'check_today'
            }, {
                text: "📆 Tháng này",
                callback_data: 'check_this_month'
            }, {
                text: "🗓️ Năm nay",
                callback_data: 'check_this_year'
            }],
            [{
                text: "🌍 Toàn Thời Gian",
                callback_data: 'check_all'
            }],
            [{
                text: "🔙 Quay Lại",
                callback_data: 'go_back'
            }]
        );

        return JSON.stringify({
            inline_keyboard: keyboard
        });
    },

    /**
     * Tạo markup cho menu Quản lý cổ đông.
     */
    createShareholderMenu() {
        return JSON.stringify({
            inline_keyboard: [
                [{
                    text: "📊 Báo cáo hoa hồng",
                    callback_data: 'report_commission'
                }],
                [{
                        text: "➕ Thêm cổ đông",
                        callback_data: 'add_shareholder'
                    },
                    {
                        text: "💸 Chia cổ phần",
                        callback_data: 'split_shares'
                    }
                ],
                [{
                    text: "⚙️ Cài đặt % hoa hồng",
                    callback_data: 'setting_commission'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'go_back'
                }]
            ]
        });
    },

    /**
     * Menu chọn cổ đông để chỉnh % hoa hồng.
     */
    createSettingCommissionMenu() {
        const rows = Config.getShareholderNames().map(name => ([{
            text: `Cổ đông ${name}`,
            callback_data: `set_comm_${name.replace(/\s/g, "_")}`
        }]));
        rows.push([{ text: "🔙 Quay lại", callback_data: 'manage_shareholders' }]);
        return JSON.stringify({
            inline_keyboard: rows
        });
    },

    createShareholderList(action) {
        const callbackPrefix = action === 'split' ? 'split_share_' : 'shareholder_';
        const rows = Config.getShareholderNames().map(name => ([{
            text: `👥 ${name}`,
            callback_data: callbackPrefix + name.replace(/\s/g, "_")
        }]));
        rows.push([{ text: "🔙 Quay lại", callback_data: 'manage_shareholders' }]);
        return JSON.stringify({ inline_keyboard: rows });
    },

    createShareSplitAmount2Options() {
        return JSON.stringify({
            inline_keyboard: [
                [
                    { text: "⏭️ Bỏ qua Thu Bù", callback_data: 'skip_share_amount2' }
                ],
                [{ text: "📅 Nhập ngày khác", callback_data: 'enter_share_date' }],
                [{ text: "🔙 Quay lại", callback_data: 'split_shares' }]
            ]
        });
    },

    createShareSplitAmount3Options() {
        return JSON.stringify({
            inline_keyboard: [
                [
                    { text: "💾 Lưu", callback_data: 'save_share_split' },
                    { text: "⏭️ Bỏ qua Mục Khác", callback_data: 'skip_share_amount3' }
                ],
                [{ text: "🔙 Quay lại", callback_data: 'back_to_share_amount2' }]
            ]
        });
    },

    createShareSplitSaveOptions() {
        return JSON.stringify({
            inline_keyboard: [
                [{ text: "💾 Lưu", callback_data: 'save_share_split' }],
                [{ text: "🔙 Quay lại", callback_data: 'back_to_share_amount3' }]
            ]
        });
    },

    /**
     * Tạo markup cho danh sách năm.
     * @param {string} currentMenu - Menu hiện tại (check_year hoặc manageShareholders).
     * @returns {string} JSON string của inline keyboard.
     */
    createYearSelection(currentMenu) {
        try {
            const yearFiles = Config.getYearFiles();
            let years = Object.keys(yearFiles).map(Number).sort();
            // Giới hạn các năm từ 2021 trở đi cho menu Báo cáo cổ đông
            if (currentMenu === 'manageShareholders') {
                years = years.filter(year => year >= 2021);
            }
            const inlineKeyboard = [];

            for (let i = 0; i < years.length; i += 3) {
                const row = years.slice(i, i + 3).map(year => ({
                    text: `${year}`,
                    callback_data: 'year_' + year
                }));
                inlineKeyboard.push(row);
            }

            inlineKeyboard.push([{
                text: "🔙 Quay lại",
                callback_data: 'go_back'
            }]);
            Logger.logInfo('Menu.createYearSelection', `Created year selection markup with ${years.length} years for ${currentMenu}`);
            return JSON.stringify({
                inline_keyboard: inlineKeyboard
            });
        } catch (e) {
            Logger.logError('Menu.createYearSelection', `Failed to create year selection markup`, {
                error: e.message
            });
            return JSON.stringify({
                inline_keyboard: [
                    [{
                        text: "🔙 Quay lại",
                        callback_data: 'go_back'
                    }]
                ]
            });
        }
    },

    /**
     * Tạo markup cho tùy chọn nhập ngày.
     * @returns {string} JSON string của inline keyboard.
     */
    createDateInput() {
        return JSON.stringify({
            inline_keyboard: [
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_amount_options'
                }]
            ]
        });
    },

    /**
     * Tạo markup cho tùy chọn nhập số liệu.
     * @returns {string} JSON string của inline keyboard.
     */
    createAmountOptions() {
        return JSON.stringify({
            inline_keyboard: [
                [{
                        text: "💾 Lưu",
                        callback_data: 'save_data'
                    },
                    {
                        text: "⏭️ Bỏ qua Số Liệu",
                        callback_data: 'skip_amount1'
                    }
                ],
                [{
                    text: "📅 Nhập ngày khác",
                    callback_data: 'enter_date'
                }],
                [{
                    text: "🔙 Quay Lại",
                    callback_data: 'back_to_customer_list'
                }]
            ]
        });
    },

    /**
     * Tạo markup cho tùy chọn nhập thu bù.
     * @returns {string} JSON string của inline keyboard.
     */
    createAmount2Options() {
        return JSON.stringify({
            inline_keyboard: [
                [{
                        text: "💾 Lưu",
                        callback_data: 'save_data'
                    },
                    {
                        text: "⏭️ Bỏ qua Thu Bù",
                        callback_data: 'skip_amount2'
                    }
                ],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_previous'
                }]
            ]
        });
    },

    /**
     * Tạo markup cho tùy chọn nhập mục khác.
     * @returns {string} JSON string của inline keyboard.
     */
    createAmount3Options() {
        return JSON.stringify({
            inline_keyboard: [
                [{
                        text: "💾 Lưu",
                        callback_data: 'save_data'
                    },
                    {
                        text: "⏭️ Bỏ qua Mục Khác",
                        callback_data: 'skip_amount3'
                    }
                ],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_previous'
                }]
            ]
        });
    },

    /**
     * Tạo markup cho tùy chọn nhập ghi chú.
     * @returns {string} JSON string của inline keyboard.
     */
    createNoteOptions() {
        return JSON.stringify({
            inline_keyboard: [
                [{
                        text: "💾 Lưu",
                        callback_data: 'save_data'
                    },
                    {
                        text: "⏭️ Bỏ qua Ghi Chú",
                        callback_data: 'skip_note'
                    }
                ],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_previous'
                }]
            ]
        });
    },

    /**
     * Tạo markup cho tùy chọn lưu dữ liệu.
     * @returns {string} JSON string của inline keyboard.
     */
    createSaveOptions() {
        return JSON.stringify({
            inline_keyboard: [
                [{
                    text: "💾 Lưu",
                    callback_data: 'save_data'
                }],
                [{
                    text: "🔙 Quay lại",
                    callback_data: 'back_to_previous'
                }]
            ]
        });
    },
    // Menu sau khi lưu CHỈNH SỬA (2 nút cùng 1 hàng)
    createPostEdit() {
        const startTime = Date.now();
        const markup = JSON.stringify({
            inline_keyboard: [
                [{
                        text: "✏️ Sửa số liệu",
                        callback_data: "edit_data"
                    },
                    {
                        text: "🏠 Menu chính",
                        callback_data: "return_to_main"
                    }
                ]
            ]
        });
        Logger.logInfo('Menu.createPostEdit',
            `Created post-edit menu in ${Date.now() - startTime}ms`);
        return markup;
    },



    /**
     * Tạo markup sau khi lưu dữ liệu.
     * @returns {string} JSON string của inline keyboard.
     */
    createPostSave() {
  return JSON.stringify({
    inline_keyboard: [
      [
        { text: "📝 Thêm Số Liệu", callback_data: 'add_data_again' }
      ],
      [
        { text: "✏️ Sửa số liệu",  callback_data: 'edit_data' },
        { text: "🗑️ Xoá số liệu",  callback_data: 'delete_data' }
      ],
      [
        { text: "🏠 Menu chính",  callback_data: 'return_to_main' }
      ]
    ]
  });
},

    /**
     * Tạo nút quay lại một callback cụ thể.
     * @param {string} targetCallback - Callback đích.
     * @returns {string} JSON string của inline keyboard.
     */
    createBackButton(targetCallback) {
        return JSON.stringify({
            inline_keyboard: [
                [{ text: "🔙 Quay lại", callback_data: targetCallback || 'go_back' }]
            ]
        });
}

};
