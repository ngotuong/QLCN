// Config.js
const Config = {
    TELEGRAM_API_TOKEN_PROPERTY: 'TELEGRAM_API_TOKEN',
    YEAR_FILES_PROPERTY: 'yearFiles',
    DEFAULT_LOG_SHEET_ID: '',
    DEFAULT_LOG_LEVEL: 'ERROR',
    DEFAULT_TIMEZONE: 'GMT+7',
    DEFAULT_EXCLUDED_CUSTOMERS: [],
    DEFAULT_NOTIFICATION_CHAT_IDS: [],
    DEFAULT_ALLOWED_CHAT_IDS: [],
    DEFAULT_SHAREHOLDER_CHAT_IDS: [],
    SHAREHOLDER_POLICY_START_DATE: '2026-05-01',
    SHAREHOLDER_POLICY_RATE: -0.10,
    _configCache: {},
    _shareholderRatesCache: null,
    _telegramApiTokenCache: null,

    getStringProperty(key, defaultValue = '') {
        const value = PropertiesService.getScriptProperties().getProperty(key);
        return value === null || value === undefined || value === '' ? defaultValue : value;
    },

    getArrayConfig(key, defaultValue = []) {
        const raw = PropertiesService.getScriptProperties().getProperty(key);
        if (!raw) return defaultValue.slice();
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.map(v => v.toString());
        } catch (e) {
            return raw.split(',').map(v => v.trim()).filter(Boolean);
        }
        return defaultValue.slice();
    },

    getLogSheetId() {
        return this.getStringProperty('LOG_SHEET_ID', this.DEFAULT_LOG_SHEET_ID);
    },

    getLogLevel() {
        return this.getStringProperty('LOG_LEVEL', this.DEFAULT_LOG_LEVEL);
    },

    getTimezone() {
        return this.getStringProperty('TIMEZONE', this.DEFAULT_TIMEZONE);
    },

    getAllowedChatIds() {
        return this.getArrayConfig('ALLOWED_CHAT_IDS', this.DEFAULT_ALLOWED_CHAT_IDS);
    },

    getShareholderChatIds() {
        return this.getArrayConfig('SHAREHOLDER_CHAT_IDS', this.DEFAULT_SHAREHOLDER_CHAT_IDS);
    },

    isShareholderChat(chatId) {
        return this.getShareholderChatIds().includes(chatId.toString());
    },

    isAuthorizedChat(chatId) {
        const key = chatId.toString();
        return this.getAllowedChatIds().includes(key) || this.getShareholderChatIds().includes(key);
    },

    getAdminChatIds() {
        return this.getArrayConfig('ADMIN_CHAT_IDS', this.getAllowedChatIds());
    },

    isAdminChat(chatId) {
        return this.getAdminChatIds().includes(chatId.toString());
    },

    getNotificationChatIds() {
        return this.getArrayConfig('NOTIFICATION_CHAT_IDS', this.DEFAULT_NOTIFICATION_CHAT_IDS);
    },

    getDailyDebtReportChatIds() {
        const notificationChatIds = this.getNotificationChatIds();
        return notificationChatIds.length ? notificationChatIds : this.getAdminChatIds();
    },

    getExcludedCustomers() {
        return this.getArrayConfig('EXCLUDED_CUSTOMERS', this.DEFAULT_EXCLUDED_CUSTOMERS).map(v => v.toUpperCase());
    },

    /**
     * Lấy Telegram bot token từ Script Properties.
     * Set key TELEGRAM_API_TOKEN trong Apps Script Project Settings.
     */
    getTelegramApiToken() {
        if (this._telegramApiTokenCache) return this._telegramApiTokenCache;
        const token = PropertiesService.getScriptProperties().getProperty(this.TELEGRAM_API_TOKEN_PROPERTY);
        if (!token) {
            throw new Error(`Missing Script Property: ${this.TELEGRAM_API_TOKEN_PROPERTY}`);
        }
        this._telegramApiTokenCache = token;
        return this._telegramApiTokenCache;
    },

    /**
     * Lấy cấu hình tỷ lệ hoa hồng
     */
    getShareholderRates() {
        const defaultRates = {
            "HP": [
                { startDate: "2000-01-01", rate: -0.025 },
                { startDate: "2026-05-01", rate: -0.10 }
            ],
            "L": [
                { startDate: "2000-01-01", rate: -0.025 },
                { startDate: "2024-07-01", rate: -0.05 },
                { startDate: "2026-05-01", rate: -0.10 }
            ]
        };
        if (this._shareholderRatesCache) return this._shareholderRatesCache;
        const rates = this.getConfig('shareholderRates');
        if (Object.keys(rates).length === 0) {
            const normalizedDefaults = this.normalizeShareholderRates(defaultRates);
            this.setConfig('shareholderRates', normalizedDefaults.rates);
            this._shareholderRatesCache = normalizedDefaults.rates;
            return this._shareholderRatesCache;
        }
        const normalized = this.normalizeShareholderRates(rates);
        if (normalized.changed) {
            this.setConfig('shareholderRates', normalized.rates);
        }
        this._shareholderRatesCache = normalized.rates;
        return this._shareholderRatesCache;
    },

    parseConfigDateMs(dateString) {
        const parts = (dateString || '').toString().split('-').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return 0;
        return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
    },

    normalizeShareholderRates(rates) {
        let changed = false;
        const normalized = { ...(rates || {}) };
        Object.keys(normalized).forEach(name => {
            const list = Array.isArray(normalized[name]) ? normalized[name].slice() : [];
            let hasPolicyDate = false;
            const cleaned = list
                .filter(item => item && item.startDate)
                .map(item => {
                    const rate = Number(item.rate) || 0;
                    if (item.startDate === this.SHAREHOLDER_POLICY_START_DATE) {
                        hasPolicyDate = true;
                        if (rate !== this.SHAREHOLDER_POLICY_RATE) changed = true;
                        return { startDate: item.startDate, rate: this.SHAREHOLDER_POLICY_RATE };
                    }
                    return { startDate: item.startDate, rate };
                });
            if (!hasPolicyDate) {
                cleaned.push({
                    startDate: this.SHAREHOLDER_POLICY_START_DATE,
                    rate: this.SHAREHOLDER_POLICY_RATE
                });
                changed = true;
            }
            cleaned.sort((a, b) => this.parseConfigDateMs(a.startDate) - this.parseConfigDateMs(b.startDate));
            normalized[name] = cleaned;
        });
        return { rates: normalized, changed };
    },

    getShareholderNames() {
        return Object.keys(this.getShareholderRates()).sort();
    },

    isShareholderName(name) {
        const key = (name || '').toString().toUpperCase().trim();
        return this.getShareholderNames().includes(key);
    },

    isExcludedCustomer(name) {
        const key = (name || '').toString().toUpperCase().trim();
        return this.getExcludedCustomers().includes(key) || this.isShareholderName(key);
    },

    addShareholder(name) {
        const key = (name || '').toString().toUpperCase().trim();
        if (!key) throw new Error('Tên cổ đông không hợp lệ.');
        const rates = this.getShareholderRates();
        if (rates[key]) {
            return `Cổ đông *${key}* đã tồn tại.`;
        }
        rates[key] = [
            { startDate: "2000-01-01", rate: 0 },
            { startDate: this.SHAREHOLDER_POLICY_START_DATE, rate: this.SHAREHOLDER_POLICY_RATE }
        ];
        this.setConfig('shareholderRates', rates);
        return `Đã thêm cổ đông *${key}*. Vui lòng vào *Cài đặt % hoa hồng* để đặt tỷ lệ.`;
    },

    /**
     * Lấy cấu hình từ PropertiesService.
     * @param {string} key - Khóa cấu hình.
     * @returns {Object} Giá trị cấu hình.
     */
    getConfig(key) {
        if (Object.prototype.hasOwnProperty.call(this._configCache, key)) {
            return this._configCache[key];
        }
        const properties = PropertiesService.getScriptProperties();
        const value = JSON.parse(properties.getProperty(key) || '{}');
        this._configCache[key] = value;
        return value;
    },

    /**
     * Lưu cấu hình vào PropertiesService.
     * @param {string} key - Khóa cấu hình.
     * @param {Object} value - Giá trị cấu hình.
     */
    setConfig(key, value) {
        const properties = PropertiesService.getScriptProperties();
        properties.setProperty(key, JSON.stringify(value));
        this._configCache[key] = value;
        if (key === 'shareholderRates') {
            this._shareholderRatesCache = value;
        }
    },

    /**
     * Lấy danh sách file theo năm.
     * @returns {Object} Danh sách file theo năm.
     */
    getYearFiles() {
        return this.getConfig(this.YEAR_FILES_PROPERTY);
    },

    /**
     * Kiểm tra các cấu hình bắt buộc trước khi xử lý request.
     */
    validateRequiredProperties() {
        this.getTelegramApiToken();
        const yearFiles = this.getYearFiles();
        if (!yearFiles || Object.keys(yearFiles).length === 0) {
            throw new Error(`Missing Script Property: ${this.YEAR_FILES_PROPERTY}`);
        }
    },

    /**
     * Lấy CUSTOMER_THRESHOLDS từ sheet CustomerSummary.
     * @returns {Object} Danh sách hạn mức công nợ theo khách hàng.
     */
    getCustomerThresholds() {
        const cache = CacheService.getScriptCache();
        const cached = cache.get('customerThresholds');
        if (cached) {
            Logger.logInfo('Config.getCustomerThresholds', 'Loaded thresholds from cache');
            return JSON.parse(cached);
        }
        try {
            const year = new Date().getFullYear();
            const spreadsheet = Sheets.getSpreadsheetForYear(year);
            if (!spreadsheet) throw new Error(`No spreadsheet for year ${year}`);
            const summarySheet = spreadsheet.getSheetByName("CustomerSummary");
            if (!summarySheet || summarySheet.getLastRow() < 2) {
                cache.put('customerThresholds', JSON.stringify({}), 600);
                return {};
            }

            const data = summarySheet.getRange(`A2:D${summarySheet.getLastRow()}`).getValues();
            const thresholds = {};
            data.forEach(row => {
                const name = (row[0] || '').toString().toUpperCase().trim();
                if (!name) return;
                const positive = Number(row[2]) || 0;
                const negative = Number(row[3]) || 0;
                if (positive !== 0 || negative !== 0) {
                    thresholds[name] = {
                        positive,
                        negative
                    };
                }
            });

            cache.put('customerThresholds', JSON.stringify(thresholds), 600); // 10 phút
            Logger.logInfo('Config.getCustomerThresholds', `Loaded ${Object.keys(thresholds).length} thresholds from sheet`);
            return thresholds;
        } catch (e) {
            Logger.logError('Config.getCustomerThresholds', `Failed to load`, {
                error: e.message
            });
            cache.put('customerThresholds', JSON.stringify({}), 300);
            return {};
        }
    }

};
