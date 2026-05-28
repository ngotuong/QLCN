// Sheets.gs
const Sheets = {
    _slRowsMemoryCache: {},

    /**
     * Lấy spreadsheet cho một năm cụ thể.
     * @param {number} year - Năm cần lấy spreadsheet.
     * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet|null} Spreadsheet hoặc null nếu không tìm thấy.
     */
    getSpreadsheetForYear(year) {
        try {
            const cache = CacheService.getScriptCache();
            const yearFiles = Config.getYearFiles();
            const url = yearFiles[year];
            if (!url) {
                Logger.logError('Sheets.getSpreadsheetForYear', `No file found for year ${year}`);
                return null;
            }

            // Cache id theo năm để các hàm khác dùng openById (nhanh hơn openByUrl)
            const cacheKey = `sheetInfo_${year}`;
            let sheetInfo = cache.get(cacheKey);
            if (sheetInfo) {
                const {
                    spreadsheetId
                } = JSON.parse(sheetInfo);
                return SpreadsheetApp.openById(spreadsheetId);
            }

            const ss = SpreadsheetApp.openByUrl(url);
            const spreadsheetId = ss.getId();
            cache.put(cacheKey, JSON.stringify({
                spreadsheetId
            }), 86400); // 1 ngày
            return ss;
        } catch (e) {
            Logger.logError('Sheets.getSpreadsheetForYear', `Cannot open file for year ${year}`, {
                error: e.message
            });
            return null;
        }
    },

    /**
     * Lấy dữ liệu SL đã parse theo năm. Cache theo lastRow để tự đổi key khi có append/delete.
     * @param {number} year
     * @returns {Object[]} rows đã parse
     */
    getSlRowsForYear(year) {
        const ss = this.getSpreadsheetForYear(year);
        if (!ss) return [];
        const sheet = ss.getSheetByName("SL");
        if (!sheet) return [];

        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return [];

        const cache = CacheService.getScriptCache();
        const version = PropertiesService.getScriptProperties().getProperty(`slRowsVersion_${year}`) || '1';
        const cacheKey = `slRows:${year}:${lastRow}:${version}`;
        if (this._slRowsMemoryCache[cacheKey]) {
            return this._slRowsMemoryCache[cacheKey];
        }
        const cached = cache.get(cacheKey);
        if (cached) {
            const rows = JSON.parse(cached).map(row => ({
                ...row,
                date: row.date ? new Date(row.date) : null
            }));
            this._slRowsMemoryCache[cacheKey] = rows;
            return rows;
        }

        const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
        const rows = values.map((row, index) => {
            const date = this.parseDateCell(row[0]);
            const dateMs = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() : null;
            return {
                rowIndex: index + 2,
                date,
                dateMs,
                dateText: date ? this.formatDateJS(date) : '',
                customerName: (row[1] || '').toString().trim(),
                customerKey: (row[1] || '').toString().toUpperCase().trim(),
                amount1: Number(row[2]) || 0,
                amount2: Number(row[3]) || 0,
                amount3: Number(row[4]) || 0,
                note: row[5] || ''
            };
        });

        const serialized = JSON.stringify(rows);
        if (serialized.length < 90000) {
            cache.put(cacheKey, serialized, 300);
        }
        this._slRowsMemoryCache[cacheKey] = rows;
        return rows;
    },

    invalidateSlCache(year) {
        if (!year) return;
        Object.keys(this._slRowsMemoryCache)
            .filter(key => key.startsWith(`slRows:${year}:`))
            .forEach(key => delete this._slRowsMemoryCache[key]);
        PropertiesService.getScriptProperties().setProperty(`slRowsVersion_${year}`, String(Date.now()));
    },

    clearCustomerMenuCache() {
        const keys = ['customerList', 'customerListMarkup', 'customerDeleteListMarkup', 'customerThresholdListMarkup'];
        CacheService.getScriptCache().removeAll(keys);
        const properties = PropertiesService.getScriptProperties();
        keys.slice(1).forEach(key => properties.deleteProperty(key));
    },

    clearRuntimeCache() {
        const cache = CacheService.getScriptCache();
        const keys = [
            'customerList',
            'customerListMarkup',
            'customerDeleteListMarkup',
            'customerThresholdListMarkup',
            'customerThresholds',
            'startMenuMarkup'
        ];
        const yearFiles = Config.getYearFiles();
        Object.keys(yearFiles || {}).forEach(year => {
            keys.push(`sheetInfo_${year}`);
            this.invalidateSlCache(Number(year));
        });
        cache.removeAll(keys);

        const properties = PropertiesService.getScriptProperties();
        ['customerListMarkup', 'customerDeleteListMarkup', 'customerThresholdListMarkup', 'startMenuMarkup'].forEach(key => {
            properties.deleteProperty(key);
        });
        this._slRowsMemoryCache = {};
        return 'Đã làm mới cache dữ liệu và menu.';
    },

    parseDateCell(value) {
        if (!value) return null;
        if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
            return value;
        }
        if (typeof value === 'string') {
            const parts = value.trim().split('/');
            if (parts.length === 3) {
                const [day, month, year] = parts.map(Number);
                const date = new Date(year, month - 1, day);
                if (!isNaN(date.getTime())) return date;
            }
        }
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
    },


    /**
     * Thêm dữ liệu giao dịch cho khách hàng vào sheet SL.
     * @param {string} customerName - Tên khách hàng.
     * @param {string} date - Ngày giao dịch (dd/MM/yyyy).
     * @param {number} amount1 - Số liệu.
     * @param {number} amount2 - Thu bù.
     * @param {number} amount3 - Mục khác.
     * @param {string} note - Ghi chú.
     */
    addCustomerData(customerName, date, amount1, amount2, amount3, note) {
        try {
            const startTime = Date.now();
            if (!date || typeof date !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
                throw new Error(`Invalid date format: ${date || 'undefined'}`);
            }
            const year = parseInt(date.split('/')[2], 10);
            const cache = CacheService.getScriptCache();
            let sheetInfo = JSON.parse(cache.get(`sheetInfo_${year}`) || '{}');

            if (!sheetInfo.spreadsheetId) {
                const spreadsheet = this.getSpreadsheetForYear(year);
                if (!spreadsheet) throw new Error(`No spreadsheet for year ${year}`);
                sheetInfo = {
                    spreadsheetId: spreadsheet.getId()
                };
                cache.put(`sheetInfo_${year}`, JSON.stringify(sheetInfo), 86400);
            }

            const spreadsheet = SpreadsheetApp.openById(sheetInfo.spreadsheetId);
            const sheet = spreadsheet.getSheetByName("SL") || spreadsheet.insertSheet("SL");
            sheet.appendRow([date, customerName, amount1 || 0, amount2 || 0, amount3 || 0, note || '']);
            this.invalidateSlCache(year);

            const duration = Date.now() - startTime;
            Logger.logInfo('Sheets.addCustomerData', `Added data for ${customerName} on ${date} in ${duration}ms`, {
                amount1: amount1 || 0,
                amount2: amount2 || 0,
                amount3: amount3 || 0
            });
        } catch (e) {
            Logger.logError('Sheets.addCustomerData', `Failed to add data`, {
                customerName,
                date,
                error: e.message
            });
            throw e;
        }
    },

    /**
     * Thêm khách hàng mới vào sheet CustomerSummary.
     * @param {string} customerName - Tên khách hàng.
     * @returns {string} Thông báo kết quả.
     */
    addNewCustomer(customerName) {
        try {
            if (Config.isShareholderName(customerName)) {
                return `*${customerName}* là cổ đông. Vui lòng quản lý trong menu cổ đông.`;
            }
            const year = new Date().getFullYear();
            const spreadsheet = this.getSpreadsheetForYear(year);
            if (!spreadsheet) throw new Error(`No spreadsheet for year ${year}`);
            const sheet = spreadsheet.getSheetByName("CustomerSummary") || spreadsheet.insertSheet("CustomerSummary");
            const lastRow = Math.max(sheet.getLastRow(), 1);
            const columnA = lastRow >= 2 ? sheet.getRange(`A2:A${lastRow}`).getValues().flat() : [];
            if (columnA.includes(customerName)) {
                Logger.logInfo('Sheets.addNewCustomer', `Customer ${customerName} already exists`, { customerName });
                return `Khách hàng *${customerName}* đã tồn tại trong hệ thống.`;
            }
            let firstEmptyRow = columnA.findIndex(row => !row) + 2;
            if (firstEmptyRow === 1) firstEmptyRow = columnA.length + 2;
            
            sheet.getRange(firstEmptyRow, 1).setValue(customerName);
            sheet.getRange(firstEmptyRow, 2).setValue(new Date()); // LastUpdated
            sheet.getRange(firstEmptyRow, 3).setValue(0); // Positive threshold
            sheet.getRange(firstEmptyRow, 4).setValue(0); // Negative threshold
            
            this.clearCustomerMenuCache();

            Logger.logInfo('Sheets.addNewCustomer', `Added new customer ${customerName} to CustomerSummary and cleared cache`);
            return `Khách hàng mới *${customerName}* đã được thêm vào hệ thống.`;
        } catch (e) {
            Logger.logError('Sheets.addNewCustomer', `Failed to add new customer`, { customerName, error: e.message });
            throw e;
        }
    },

    /**
     * Kiểm tra khách hàng có tồn tại trong sheet CustomerSummary không.
     * @param {string} customerName - Tên khách hàng.
     * @returns {boolean} True nếu tồn tại, false nếu không.
     */
    isCustomerExist(customerName) {
        try {
            const year = new Date().getFullYear();
            const spreadsheet = this.getSpreadsheetForYear(year);
            const sheet = spreadsheet.getSheetByName("CustomerSummary");
            if (!sheet) return false;
            const lastRow = sheet.getLastRow();
            if (lastRow < 2) return false;
            const columnA = sheet.getRange(`A2:A${lastRow}`).getValues().flat();
            return columnA.includes(customerName);
        } catch (e) {
            Logger.logError('Sheets.isCustomerExist', `Failed to check customer existence`, { customerName, error: e.message });
            return false;
        }
    },

    /**
     * Lấy danh sách khách hàng từ sheet CustomerSummary.
     * @returns {string[]} Mảng tên khách hàng.
     */
    getListOfCustomers() {
        try {
            const year = new Date().getFullYear();
            const spreadsheet = this.getSpreadsheetForYear(year);
            const sheet = spreadsheet.getSheetByName("CustomerSummary");
            if (!sheet) return [];
            const lastRow = sheet.getLastRow();
            if (lastRow < 2) return [];
            const range = sheet.getRange("A2:A" + lastRow);
            const values = range.getValues().flat().filter(name => name && !Config.isExcludedCustomer(name));
            Logger.logInfo('Sheets.getListOfCustomers', `Retrieved ${values.length} customers from CustomerSummary`);
            return values;
        } catch (e) {
            Logger.logError('Sheets.getListOfCustomers', `Failed to get customer list`, { error: e.message });
            return [];
        }
    },

    /**
     * Cache danh sách khách hàng để giảm truy cập sheet.
     * @returns {string[]} Mảng tên khách hàng.
     */
    getCachedCustomerList() {
        const startTime = Date.now();
        const cache = CacheService.getScriptCache();
        let customers = cache.get('customerList');
        if (!customers) {
            const year = new Date().getFullYear();
            const spreadsheet = this.getSpreadsheetForYear(year);
            const summarySheet = spreadsheet.getSheetByName("CustomerSummary");
            if (summarySheet && summarySheet.getLastRow() > 1) {
                customers = JSON.stringify(summarySheet.getRange("A2:A" + summarySheet.getLastRow()).getValues().flat()
                    .filter(name => name && !Config.isExcludedCustomer(name)));
            } else {
                customers = JSON.stringify(this.getListOfCustomers());
            }
            cache.put('customerList', customers, 2592000); // Cache 30 ngày
            Logger.logInfo('Sheets.getCachedCustomerList', `Cached customer list in ${Date.now() - startTime}ms`);
        } else {
            Logger.logInfo('Sheets.getCachedCustomerList', `Retrieved customer list from cache in ${Date.now() - startTime}ms`);
        }
        return JSON.parse(customers);
    },

    /**
     * Cập nhật hạn mức công nợ cho một khách hàng trong sheet CustomerSummary.
     * @param {string} customerName - Tên khách hàng.
     * @param {number} positiveThreshold - Hạn mức dương.
     * @param {number} negativeThreshold - Hạn mức âm.
     * @returns {string} Thông báo kết quả.
     */
    updateCustomerThreshold(customerName, positiveThreshold, negativeThreshold) {
        try {
            const startTime = Date.now();
            const year = new Date().getFullYear();
            const spreadsheet = this.getSpreadsheetForYear(year);
            if (!spreadsheet) throw new Error(`No spreadsheet for year ${year}`);
            const summarySheet = spreadsheet.getSheetByName("CustomerSummary");
            if (!summarySheet) throw new Error(`No CustomerSummary sheet for year ${year}`);

            const lastRow = summarySheet.getLastRow();
            if (lastRow < 2) throw new Error(`No customer data in CustomerSummary`);

            const customerNames = summarySheet.getRange(`A2:A${lastRow}`).getValues().flat();
            const rowIndex = customerNames.indexOf(customerName);
            if (rowIndex === -1) {
                Logger.logInfo('Sheets.updateCustomerThreshold', `Customer ${customerName} not found in CustomerSummary`, {
                    customerName
                });
                return `Khách hàng *${customerName}* không tồn tại trong hệ thống.`;
            }

            // Cập nhật hạn mức và thời gian cập nhật
            summarySheet.getRange(rowIndex + 2, 2).setValue(new Date()); // LastUpdated
            summarySheet.getRange(rowIndex + 2, 3).setValue(positiveThreshold); // PositiveThreshold
            summarySheet.getRange(rowIndex + 2, 4).setValue(negativeThreshold); // NegativeThreshold
            CacheService.getScriptCache().remove('customerThresholds');
            // Xóa cache để làm mới danh sách khách hàng và hạn mức
            Logger.logInfo('Sheets.updateCustomerThreshold', `Updated threshold for ${customerName} in ${Date.now() - startTime}ms`, {
                positiveThreshold,
                negativeThreshold
            });
            return `Đã cập nhật hạn mức cho *${customerName}*:\n- Hạn mức dương: ${this.formatNumberWithDot(positiveThreshold)}\n- Hạn mức âm: ${this.formatNumberWithDot(negativeThreshold)}`;
        } catch (e) {
            Logger.logError('Sheets.updateCustomerThreshold', `Failed to update threshold`, {
                customerName,
                error: e.message
            });
            throw e;
        }
    },

    /**
     * Lấy số liệu khách hàng trong một ngày.
     * @param {string} customerName - Tên khách hàng.
     * @param {Date} specificDate - Ngày cần kiểm tra.
     * @param {Object} yearFiles - Danh sách file theo năm.
     * @returns {number} Tổng số liệu.
     */
    getCustomerDataInDaySimple(customerName, specificDate, yearFiles) {
        try {
            const year = specificDate.getFullYear();
            if (!yearFiles[year]) return 0;
            const startTime = new Date(specificDate).setHours(0, 0, 0, 0);
            const endTime = new Date(specificDate).setHours(23, 59, 59, 999);

            let soLieu = 0;
            this.getSlRowsForYear(year).forEach(row => {
                if (row.dateMs && row.dateMs >= startTime && row.dateMs <= endTime && row.customerKey === customerName.toUpperCase()) {
                    soLieu += row.amount1;
                }
            });
            Logger.logInfo('Sheets.getCustomerDataInDaySimple', `Retrieved data for ${customerName} on ${specificDate.toDateString()}`, {
                soLieu
            });
            return soLieu;
        } catch (e) {
            Logger.logError('Sheets.getCustomerDataInDaySimple', `Failed to get data`, {
                customerName,
                date: specificDate,
                error: e.message
            });
            return 0;
        }
    },

    /**
     * Lấy số liệu khách hàng trong một tháng.
     * @param {string} customerName - Tên khách hàng.
     * @param {Date} startDate - Ngày bắt đầu.
     * @param {Date} endDate - Ngày kết thúc.
     * @param {Object} yearFiles - Danh sách file theo năm.
     * @returns {string} Báo cáo số liệu theo ngày.
     */
    getCustomerDataInMonthSimple(customerName, startDate, endDate, yearFiles) {
        try {
            const year = startDate.getFullYear();
            if (!yearFiles[year]) return `Không tìm thấy dữ liệu cho năm ${year}`;
            const startTime = new Date(startDate).setHours(0, 0, 0, 0);
            const endTime = new Date(endDate).setHours(23, 59, 59, 999);

            let dailyData = new Map();
            let total = 0;

            this.getSlRowsForYear(year).forEach(row => {
                if (row.dateMs && row.dateMs >= startTime && row.dateMs <= endTime && row.customerKey === customerName.toUpperCase()) {
                    const dayKey = row.dateText;
                    const soLieu = row.amount1;
                    dailyData.set(dayKey, (dailyData.get(dayKey) || 0) + soLieu);
                    total += soLieu;
                }
            });

            let resultText = `*BÁO CÁO KHÁCH HÀNG ${customerName} THÁNG ${startDate.getMonth() + 1}/${year}*\n\n`;
            dailyData.forEach((amount, date) => {
                resultText += `• _${date}_: ${this.formatNumberWithDot(amount)}\n`;
            });
            resultText += `\n*Tổng:* ${this.formatNumberWithDot(total)}`;
            Logger.logInfo('Sheets.getCustomerDataInMonthSimple', `Retrieved monthly data for ${customerName}`, {
                month: startDate.getMonth() + 1,
                year
            });
            return dailyData.size > 0 ? resultText : `Không có dữ liệu cho ${customerName} trong tháng ${startDate.getMonth() + 1}/${year}.`;
        } catch (e) {
            Logger.logError('Sheets.getCustomerDataInMonthSimple', `Failed to get monthly data`, {
                customerName,
                month: startDate.getMonth() + 1,
                year,
                error: e.message
            });
            return `Lỗi khi lấy dữ liệu cho ${customerName}.`;
        }
    },

    /**
     * Lấy số liệu khách hàng trong một năm.
     * @param {string} customerName - Tên khách hàng.
     * @param {Date} startDate - Ngày bắt đầu.
     * @param {Date} endDate - Ngày kết thúc.
     * @param {Object} yearFiles - Danh sách file theo năm.
     * @returns {string} Báo cáo số liệu theo tháng.
     */
    getCustomerDataInYearSimple(customerName, startDate, endDate, yearFiles) {
        try {
            const year = startDate.getFullYear();
            if (!yearFiles[year]) return `Không tìm thấy dữ liệu cho năm ${year}`;
            const startTime = Date.now();
            const startTimeMs = new Date(startDate).setHours(0, 0, 0, 0);
            const endTimeMs = new Date(endDate).setHours(23, 59, 59, 999);

            let monthlyData = new Map();
            for (let month = 0; month < 12; month++) {
                monthlyData.set(this.formatDateJS(new Date(year, month, 1), "MM/yyyy"), 0);
            }
            let total = 0;
            let hasRows = false;

            // Xử lý dữ liệu trong bộ nhớ
            this.getSlRowsForYear(year).forEach(row => {
                if (row.dateMs && row.dateMs >= startTimeMs && row.dateMs <= endTimeMs && row.customerKey === customerName.toUpperCase()) {
                    hasRows = true;
                    const monthKey = this.formatDateJS(row.date, "MM/yyyy");
                    const soLieu = row.amount1;
                    monthlyData.set(monthKey, (monthlyData.get(monthKey) || 0) + soLieu);
                    total += soLieu;
                }
            });

            let resultText = `*BÁO CÁO KHÁCH HÀNG ${customerName} NĂM ${year}*\n\n`;
            monthlyData.forEach((amount, month) => {
                resultText += `• Tháng ${month}: ${this.formatNumberWithDot(amount)}\n`;
            });
            resultText += `\n*Tổng:* ${this.formatNumberWithDot(total)}`;
            Logger.logInfo('Sheets.getCustomerDataInYearSimple', `Retrieved yearly data for ${customerName} in ${Date.now() - startTime}ms`, {
                year
            });
            return hasRows ? resultText : `Không có dữ liệu cho ${customerName} trong năm ${year}.`;
        } catch (e) {
            Logger.logError('Sheets.getCustomerDataInYearSimple', `Failed to get yearly data`, {
                customerName,
                year,
                error: e.message
            });
            return `Lỗi khi lấy dữ liệu cho ${customerName}.`;
        }
    },

    /**
     * Lấy số liệu khách hàng trong một khoảng thời gian.
     * @param {string} customerName - Tên khách hàng.
     * @param {Date} startDate - Ngày bắt đầu.
     * @param {Date} endDate - Ngày kết thúc.
     * @param {Object} yearFiles - Danh sách file theo năm.
     * @returns {string} Báo cáo số liệu theo ngày (cho ngày-ngày) hoặc năm (cho check_all).
     */
    getCustomerDataInRangeSimple(customerName, startDate, endDate, yearFiles) {
        try {
            const startYear = startDate.getFullYear();
            const endYear = endDate.getFullYear();
            
            const isSingleDay = startDate.getTime() === endDate.getTime();
            const isSingleMonth = startDate.getDate() === 1 && 
                                  endDate.getDate() === new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate() && 
                                  startDate.getMonth() === endDate.getMonth() && 
                                  startDate.getFullYear() === endDate.getFullYear();
            const isFullYear = startDate.getDate() === 1 && startDate.getMonth() === 0 &&
                               endDate.getDate() === 31 && endDate.getMonth() === 11 &&
                               startDate.getFullYear() === endDate.getFullYear();

            let title = '';
            if (isSingleDay) {
                title = `BÁO CÁO KHÁCH HÀNG ${customerName} NGÀY ${Utilities.formatDate(startDate, Config.getTimezone(), "dd/MM/yyyy")}`;
            } else if (isSingleMonth) {
                title = `BÁO CÁO KHÁCH HÀNG ${customerName} THÁNG ${startDate.getMonth() + 1}/${startDate.getFullYear()}`;
            } else if (isFullYear) {
                title = `BÁO CÁO KHÁCH HÀNG ${customerName} NĂM ${startDate.getFullYear()}`;
            } else {
                title = `BÁO CÁO KHÁCH HÀNG ${customerName} TỪ ${Utilities.formatDate(startDate, Config.getTimezone(), "dd/MM/yyyy")} ĐẾN ${Utilities.formatDate(endDate, Config.getTimezone(), "dd/MM/yyyy")}`;
            }
            
            let totalResult = `*${title}*\n\n`;

            let dataByDate = new Map();
            let total = 0;
            let hasRows = false;
            const startTime = new Date(startDate).setHours(0, 0, 0, 0);
            const endTime = new Date(endDate).setHours(23, 59, 59, 999);
            const isDailyReport = (endDate - startDate) / (1000 * 60 * 60 * 24) <= 30; // Kiểm tra nếu là báo cáo ngày
            const isMonthlyReport = isFullYear && startYear === endYear;

            if (isMonthlyReport) {
                for (let month = 0; month < 12; month++) {
                    dataByDate.set(this.formatDateJS(new Date(startYear, month, 1), "MM/yyyy"), 0);
                }
            }

            for (let year = startYear; year <= endYear; year++) {
                if (yearFiles[year]) {
                    this.getSlRowsForYear(year).forEach(row => {
                        if (row.dateMs && row.dateMs >= startTime && row.dateMs <= endTime && row.customerKey === customerName.toUpperCase()) {
                            hasRows = true;
                            const key = isDailyReport ?
                                row.dateText :
                                isMonthlyReport ? this.formatDateJS(row.date, "MM/yyyy") : row.date.getFullYear().toString();
                            const soLieu = row.amount1;
                            dataByDate.set(key, (dataByDate.get(key) || 0) + soLieu);
                            total += soLieu;
                        }
                    });
                }
            }

            if (isDailyReport) {
                const sortedDates = Array.from(dataByDate.keys()).sort((a, b) => {
                    const [aDay, aMonth, aYear] = a.split('/').map(Number);
                    const [bDay, bMonth, bYear] = b.split('/').map(Number);
                    return new Date(aYear, aMonth - 1, aDay) - new Date(bYear, bMonth - 1, bDay);
                });
                sortedDates.forEach(date => {
                    const amount = dataByDate.get(date);
                    totalResult += `• Ngày ${date}: ${this.formatNumberWithDot(amount)}\n`;
                });
            } else if (isMonthlyReport) {
                const sortedMonths = Array.from(dataByDate.keys()).sort((a, b) => {
                    const [aMonth, aYear] = a.split('/').map(Number);
                    const [bMonth, bYear] = b.split('/').map(Number);
                    return new Date(aYear, aMonth - 1, 1) - new Date(bYear, bMonth - 1, 1);
                });
                sortedMonths.forEach(month => {
                    const amount = dataByDate.get(month);
                    totalResult += `• Tháng ${month}: ${this.formatNumberWithDot(amount)}\n`;
                });
            } else {
                const sortedYears = Array.from(dataByDate.keys()).sort((a, b) => Number(a) - Number(b));
                sortedYears.forEach(year => {
                    const amount = dataByDate.get(year);
                    totalResult += `• Năm ${year}: ${this.formatNumberWithDot(amount)}\n`;
                });
            }

            totalResult += `\n*Tổng:* ${this.formatNumberWithDot(total)}`;
            Logger.logInfo('Sheets.getCustomerDataInRangeSimple', `Retrieved range data for ${customerName}`, {
                startDate,
                endDate,
                isDailyReport
            });
            return hasRows ? totalResult : `Không có dữ liệu cho ${customerName} từ ${Utilities.formatDate(startDate, Config.getTimezone(), "dd/MM/yyyy")} đến ${Utilities.formatDate(endDate, Config.getTimezone(), "dd/MM/yyyy")}.`;
        } catch (e) {
            Logger.logError('Sheets.getCustomerDataInRangeSimple', `Failed to get range data`, {
                customerName,
                startDate,
                endDate,
                error: e.message
            });
            return `Lỗi khi lấy dữ liệu cho ${customerName}.`;
        }
    },

    /**
     * Kiểm tra số liệu trong một khoảng thời gian cho tất cả khách hàng.
     * @param {Date} startDate - Ngày bắt đầu.
     * @param {Date} endDate - Ngày kết thúc.
     * @param {Object} yearFiles - Danh sách file theo năm.
     * @returns {string} Báo cáo số liệu tổng hợp.
     */
    checkDataInRange(startDate, endDate, yearFiles) {
        try {
            const startYear = startDate.getFullYear();
            const endYear = endDate.getFullYear();
            let customerData = new Map();
            const startTime = new Date(startDate).setHours(0, 0, 0, 0);
            const endTime = new Date(endDate).setHours(23, 59, 59, 999);

            for (let year = startYear; year <= endYear; year++) {
                if (yearFiles[year]) {
                    this.getSlRowsForYear(year).forEach(row => {
                        if (row.dateMs && row.dateMs >= startTime && row.dateMs <= endTime) {
                            const customerName = row.customerKey;
                            const amount = row.amount1;
                            customerData.set(customerName, (customerData.get(customerName) || 0) + amount);
                        }
                    });
                }
            }

            let totalAmount = 0;
            const positiveCustomerData = [];
            const negativeCustomerData = [];

            for (const [customerName, amount] of customerData.entries()) {
                totalAmount += amount;
                if (amount >= 0) positiveCustomerData.push([customerName, amount]);
                else negativeCustomerData.push([customerName, amount]);
            }

            const sortedPositive = positiveCustomerData.sort((a, b) => b[1] - a[1]);
            const sortedNegative = negativeCustomerData.sort((a, b) => a[1] - b[1]);

            const isSingleDay = startDate.getTime() === endDate.getTime();
            const isSingleMonth = startDate.getDate() === 1 && 
                                  endDate.getDate() === new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate() && 
                                  startDate.getMonth() === endDate.getMonth() && 
                                  startDate.getFullYear() === endDate.getFullYear();
            const isFullYear = startDate.getDate() === 1 && startDate.getMonth() === 0 &&
                               endDate.getDate() === 31 && endDate.getMonth() === 11 &&
                               startDate.getFullYear() === endDate.getFullYear();

            let title = '';
            if (isSingleDay) {
                title = `BÁO CÁO SỐ LIỆU NGÀY ${Utilities.formatDate(startDate, Config.getTimezone(), "dd/MM/yyyy")}`;
            } else if (isSingleMonth) {
                title = `BÁO CÁO SỐ LIỆU THÁNG ${startDate.getMonth() + 1}/${startDate.getFullYear()}`;
            } else if (isFullYear) {
                title = `BÁO CÁO SỐ LIỆU NĂM ${startDate.getFullYear()}`;
            } else {
                title = `BÁO CÁO SỐ LIỆU TỪ ${Utilities.formatDate(startDate, Config.getTimezone(), "dd/MM/yyyy")} ĐẾN ${Utilities.formatDate(endDate, Config.getTimezone(), "dd/MM/yyyy")}`;
            }
            
            let resultText = `*${title}*\n`;

            resultText += '\n*Khách hàng được thu:*\n';
            sortedPositive.forEach(([customerName, amount]) => {
                if (amount > 0) resultText += `• *${customerName}*: ${this.formatNumberWithDot(amount)}\n`;
            });
            resultText += '\n';

            resultText += '*Khách hàng phải bù:*\n';
            sortedNegative.forEach(([customerName, amount]) => {
                if (amount < 0) resultText += `• *${customerName}*: ${this.formatNumberWithDot(amount)}\n`;
            });
            resultText += '\n';

            resultText += `*TỔNG KẾT:* ${this.formatNumberWithDot(totalAmount)}`;
            Logger.logInfo('Sheets.checkDataInRange', `Checked data range`, {
                startDate,
                endDate
            });
            return resultText;
        } catch (e) {
            Logger.logError('Sheets.checkDataInRange', `Failed to check data range`, {
                startDate,
                endDate,
                error: e.message
            });
            return `Lỗi khi kiểm tra dữ liệu.`;
        }
    },

    /**
     * Lấy báo cáo công nợ đến ngày hiện tại.
     * @returns {string} Báo cáo công nợ.
     */
    getDebtReport() {
        try {
            const year = new Date().getFullYear();
            const ss = this.getSpreadsheetForYear(year);
            if (!ss) return `Không tìm thấy file dữ liệu cho năm ${year}.`;

            const sheet = ss.getSheetByName("QLCN");
            if (!sheet) return `Không tìm thấy sheet QLCN trong file năm ${year}.`;

            // Đọc vừa đủ vùng có dữ liệu (giữ nguyên B5:C100 như thiết kế hiện tại)
            const data = sheet.getRange("B5:C100").getValues();

            // Sort custom: dương giảm dần, âm tăng dần, số 0 cuối
            data.sort((a, b) => {
                const da = a[1] || 0,
                    db = b[1] || 0;
                const sa = da > 0 ? 1 : da < 0 ? -1 : 0;
                const sb = db > 0 ? 1 : db < 0 ? -1 : 0;
                if (sa !== sb) return sb - sa;
                return sa === 1 ? db - da : sa === -1 ? da - db : 0;
            });

            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const formattedDate = Utilities.formatDate(yesterday, Config.getTimezone(), "dd/MM/yyyy");

            let message = `*CÔNG NỢ TÍNH ĐẾN HẾT NGÀY ${formattedDate}:*\n\n*Khách hàng phải thu:*\n`;
            let totalDebt = 0,
                totalRealReceive = 0,
                totalRealPay = 0;

            for (const [nameRaw, debt] of data) {
                const name = (nameRaw || '').toString().toUpperCase();
                if (!name || Config.isExcludedCustomer(name)) continue;
                if (debt > 0) {
                    let formattedDebt = this.formatNumberWithDot(debt);
                    if (this.shouldMarkDebt(name, debt, true)) {
                        formattedDebt += "✨";
                        totalRealReceive += debt;
                    }
                    message += `• *${name}*: ${formattedDebt}\n`;
                    totalDebt += debt;
                }
            }

            message += `\n*Khách hàng phải bù:*\n`;
            for (const [nameRaw, debt] of data) {
                const name = (nameRaw || '').toString().toUpperCase();
                if (!name || Config.isExcludedCustomer(name)) continue;
                if (debt < 0) {
                    let formattedDebt = this.formatNumberWithDot(debt);
                    if (this.shouldMarkDebt(name, debt, false)) {
                        formattedDebt += "❗️";
                        totalRealPay += debt;
                    }
                    message += `• *${name}*: ${formattedDebt}\n`;
                    totalDebt += debt;
                }
            }

            message += `\n*Tổng hôm nay* ${totalDebt < 0 ? "*phải bù:*" : "*phải thu:*"} ${this.formatNumberWithDot(Math.abs(totalDebt))}\n`;
            const realTotal = totalRealReceive + totalRealPay;
            message += `*Thực ${realTotal > 0 ? "thu" : "bù"}*: ${this.formatNumberWithDot(Math.abs(realTotal))}`;
            Logger.logInfo('Sheets.getDebtReport', `Generated debt report`);
            return message;
        } catch (e) {
            Logger.logError('Sheets.getDebtReport', `Failed to generate debt report`, {
                error: e.message
            });
            return `Lỗi khi lấy báo cáo công nợ.`;
        }
    },


    /**
     * Lấy báo cáo công nợ cho một ngày cụ thể.
     * @param {Date} specificDate - Ngày cần kiểm tra.
     * @param {Object} yearFiles - Danh sách file theo năm.
     * @returns {string} Báo cáo công nợ.
     */
    getDebtReportForDate(specificDate, yearFiles) {
        try {
            const year = specificDate.getFullYear();
            const ss = this.getSpreadsheetForYear(year);
            if (!ss) return `Không tìm thấy file dữ liệu cho năm ${year}.`;

            const qlcn = ss.getSheetByName("QLCN");
            if (!qlcn) return `Không tìm thấy sheet QLCN trong file năm ${year}.`;
            const names = new Set(qlcn.getRange("B5:B100").getValues()
                .flat().filter(Boolean).map(n => n.toString().toUpperCase()));
            const endTime = new Date(specificDate).setHours(23, 59, 59, 999);

            const map = new Map();
            for (const row of this.getSlRowsForYear(year)) {
                if (!row.dateMs || row.dateMs > endTime) continue;
                const name = row.customerKey;
                if (!names.has(name)) continue;
                const soLieu = row.amount1;
                const thuBu = row.amount2;
                const mucKhac = row.amount3;
                const debt = soLieu - thuBu - mucKhac;
                map.set(name, (map.get(name) || 0) + debt);
            }

            const arr = Array.from(map.entries())
                .filter(([n]) => !Config.isExcludedCustomer(n));

            // Sort: dương giảm dần, âm tăng dần
            arr.sort((a, b) => {
                const da = a[1],
                    db = b[1];
                const sa = da > 0 ? 1 : da < 0 ? -1 : 0;
                const sb = db > 0 ? 1 : db < 0 ? -1 : 0;
                if (sa !== sb) return sb - sa;
                return sa === 1 ? db - da : sa === -1 ? da - db : 0;
            });

            const fDate = Utilities.formatDate(specificDate, Config.getTimezone(), "dd/MM/yyyy");
            let msg = `*CÔNG NỢ TÍNH ĐẾN HẾT NGÀY ${fDate}:*\n\n*Khách hàng phải thu:*\n`;
            let totalDebt = 0,
                totalRealReceive = 0,
                totalRealPay = 0;
            let cnt = 1;

            for (const [name, debt] of arr) {
                if (debt > 0) {
                    let val = this.formatNumberWithDot(debt);
                    if (this.shouldMarkDebt(name, debt, true)) {
                        val += "✨";
                        totalRealReceive += debt;
                    }
                    msg += `${cnt++}. ${name}: ${val}\n`;
                    totalDebt += debt;
                }
            }

            msg += `\n*Khách hàng phải bù:*\n`;
            cnt = 1;
            for (const [name, debt] of arr) {
                if (debt < 0) {
                    let val = this.formatNumberWithDot(debt);
                    if (this.shouldMarkDebt(name, debt, false)) {
                        val += "❗️";
                        totalRealPay += debt;
                    }
                    msg += `${cnt++}. ${name}: ${val}\n`;
                    totalDebt += debt;
                }
            }

            msg += `\n*Tổng hôm nay* ${totalDebt < 0 ? "*phải bù:*" : "*phải thu:*"} ${this.formatNumberWithDot(Math.abs(totalDebt))}\n`;
            const realTotal = totalRealReceive + totalRealPay;
            msg += `*Thực ${realTotal > 0 ? "thu" : "bù"}*: ${this.formatNumberWithDot(Math.abs(realTotal))}`;
            Logger.logInfo('Sheets.getDebtReportForDate', `Generated debt report for ${fDate}`);
            return msg;
        } catch (e) {
            Logger.logError('Sheets.getDebtReportForDate', `Failed`, {
                date: specificDate,
                error: e.message
            });
            return `Lỗi khi lấy báo cáo công nợ.`;
        }
    },


    /**
     * Lấy tỷ lệ hoa hồng theo cổ đông và thời gian.
     * @param {string} shareholderName - Tên cổ đông ("HP" hoặc "L")
     * @param {number} dateMs - Thời gian giao dịch (milliseconds)
     * @returns {number} Tỷ lệ hoa hồng
     */
    getShareholderRate(shareholderName, dateMs) {
        const rates = Config.getShareholderRates()[shareholderName];
        if (!rates) return 0;
        let rate = 0;
        for (let i = 0; i < rates.length; i++) {
            if (dateMs >= Config.parseConfigDateMs(rates[i].startDate)) {
                rate = rates[i].rate;
            }
        }
        return rate;
    },

    isCommissionRevenueRow(row) {
        return row.customerKey && !Config.isExcludedCustomer(row.customerKey);
    },

    calculateShareholderCommissionGeneric(startDate, endDate, yearFiles) {
        try {
            const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const startMs = start.setHours(0, 0, 0, 0);
            const endMs = end.setHours(23, 59, 59, 999);

            const currentYear = new Date().getFullYear();
            const startYear = start.getFullYear();
            const endYear = end.getFullYear();
            const shareholders = Config.getShareholderNames();
            if (!shareholders.length) return 'Chưa có cổ đông nào trong cấu hình.';
            if (!yearFiles[startYear]) return `Không tìm thấy file dữ liệu cho năm ${startYear}.`;
            const shareholderSet = new Set(shareholders);
            const excludedCustomerSet = new Set(Config.getExcludedCustomers());
            const isShareholder = (name) => shareholderSet.has(name);
            const isCommissionRevenue = (row) => row.customerKey && !shareholderSet.has(row.customerKey) && !excludedCustomerSet.has(row.customerKey);
            const rawRates = Config.getShareholderRates();
            const rateTimelines = shareholders.reduce((acc, name) => {
                acc[name] = (rawRates[name] || [])
                    .map(item => ({
                        startMs: Config.parseConfigDateMs(item.startDate),
                        rate: Number(item.rate) || 0
                    }))
                    .sort((a, b) => a.startMs - b.startMs);
                return acc;
            }, {});
            const getRate = (name, dateMs) => {
                const timeline = rateTimelines[name] || [];
                let rate = 0;
                for (let i = 0; i < timeline.length; i++) {
                    if (dateMs >= timeline[i].startMs) rate = timeline[i].rate;
                    else break;
                }
                return rate;
            };

            const includeNoHienTai = (startYear === currentYear && endYear === currentYear);
            const initMap = () => shareholders.reduce((acc, name) => {
                acc[name] = 0;
                return acc;
            }, {});

            const beforeCommission = initMap();
            const beforeThuBu = initMap();
            const beforeMucKhac = initMap();
            const inRangeCommission = initMap();
            const inRangeThuBu = initMap();
            const inRangeMucKhac = initMap();
            const currentCommission = initMap();
            const currentThuBu = initMap();
            const currentMucKhac = initMap();
            let soLieuInRangeTotal = 0;

            this.getSlRowsForYear(startYear).forEach(row => {
                const d = row.dateMs;
                if (!d || d >= startMs) return;
                if (isCommissionRevenue(row)) {
                    shareholders.forEach(name => {
                        beforeCommission[name] += row.amount1 * getRate(name, d);
                    });
                }
                if (isShareholder(row.customerKey)) {
                    beforeThuBu[row.customerKey] += row.amount2;
                    beforeMucKhac[row.customerKey] += row.amount3;
                }
            });

            for (let year = startYear; year <= endYear; year++) {
                if (!yearFiles[year]) continue;
                const from = Math.max(startMs, new Date(year, 0, 1).setHours(0, 0, 0, 0));
                const to = Math.min(endMs, new Date(year, 11, 31).setHours(23, 59, 59, 999));
                if (from > to) continue;

                this.getSlRowsForYear(year).forEach(row => {
                    const d = row.dateMs;
                    if (!d || d < from || d > to) return;
                    if (isCommissionRevenue(row)) {
                        soLieuInRangeTotal += row.amount1;
                        shareholders.forEach(name => {
                            inRangeCommission[name] += row.amount1 * getRate(name, d);
                        });
                    }
                    if (isShareholder(row.customerKey)) {
                        inRangeThuBu[row.customerKey] += row.amount2;
                        inRangeMucKhac[row.customerKey] += row.amount3;
                    }
                });
            }

            if (includeNoHienTai && yearFiles[currentYear]) {
                const now = new Date();
                const todayEndMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
                const jan1Ms = new Date(currentYear, 0, 1).setHours(0, 0, 0, 0);
                const prevDec31 = new Date(currentYear - 1, 11, 31).setHours(0, 0, 0, 0);

                this.getSlRowsForYear(currentYear).forEach(row => {
                    const d = row.dateMs;
                    if (!d) return;
                    if (d >= jan1Ms && d <= todayEndMs) {
                        if (isCommissionRevenue(row)) {
                            shareholders.forEach(name => {
                                currentCommission[name] += row.amount1 * getRate(name, d);
                            });
                        }
                        if (isShareholder(row.customerKey)) {
                            currentThuBu[row.customerKey] += row.amount2;
                        }
                    }
                    if (isShareholder(row.customerKey) && ((d >= jan1Ms && d <= todayEndMs) || d === prevDec31)) {
                        currentMucKhac[row.customerKey] += row.amount3;
                    }
                });
            }

            const fmt = (n) => this.formatNumberWithDot(Number(n || 0).toFixed(0));
            const isSingleDay = start.getFullYear() === end.getFullYear() &&
                start.getMonth() === end.getMonth() &&
                start.getDate() === end.getDate();
            const isSingleMonth = (startYear === endYear) && (start.getDate() === 1) &&
                (end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate());
            const isFullYear = (startYear === endYear) && (start.getMonth() === 0 && start.getDate() === 1) &&
                (end.getMonth() === 11 && end.getDate() === 31);

            let title;
            if (isSingleDay) title = `BÁO CÁO CỔ ĐÔNG NGÀY ${Utilities.formatDate(start, Config.getTimezone(), "dd/MM/yyyy")}`;
            else if (isSingleMonth) title = `BÁO CÁO CỔ ĐÔNG THÁNG ${start.getMonth() + 1}/${start.getFullYear()}`;
            else if (isFullYear) title = `BÁO CÁO CỔ ĐÔNG NĂM ${start.getFullYear()}`;
            else title = `BÁO CÁO CỔ ĐÔNG TỪ ${Utilities.formatDate(start, Config.getTimezone(), "dd/MM/yyyy")} ĐẾN ${Utilities.formatDate(end, Config.getTimezone(), "dd/MM/yyyy")}`;

            const block = (name) => {
                const noDau = beforeCommission[name] - beforeThuBu[name] - beforeMucKhac[name];
                const noCuoi = noDau + inRangeCommission[name] - inRangeThuBu[name] - inRangeMucKhac[name];
                const rows = [
                    ["Nợ đầu kỳ", fmt(noDau)],
                    ["Số liệu", fmt(inRangeCommission[name])],
                    ["Thu bù", fmt(inRangeThuBu[name])],
                    ["Mục khác", fmt(inRangeMucKhac[name])],
                    ["Nợ cuối kỳ", fmt(noCuoi)]
                ];
                if (includeNoHienTai) {
                    rows.push(["Nợ hiện tại", fmt(currentCommission[name] - currentThuBu[name] - currentMucKhac[name])]);
                }

                const body = rows.map(([label, value]) => `*${label}:* ${value}`).join("\n");
                return `👨‍💼 *${name}*\n${body}`;
            };

            return `*${title}*\n*Doanh thu:* ${fmt(soLieuInRangeTotal)}\n\n${shareholders.map(block).join("\n\n")}`;
        } catch (e) {
            Logger.logError('Sheets.calculateShareholderCommissionGeneric', 'Failed', { error: e.message });
            return `Lỗi khi tính báo cáo cổ đông: ${e.message}`;
        }
    },

    /**
     * Tính hoa hồng cổ đông cho một khoảng thời gian.
     * @param {Date} startDate - Ngày bắt đầu.
     * @param {Date} endDate - Ngày kết thúc.
     * @param {Object} yearFiles - Danh sách file theo năm.
     * @returns {string} Báo cáo hoa hồng.
     */
    calculateShareholderCommission(startDate, endDate, yearFiles) {
        return this.calculateShareholderCommissionGeneric(startDate, endDate, yearFiles);
    },



    /**
     * Chuyển công nợ từ năm trước sang năm hiện tại.
     * @returns {string} Thông báo kết quả.
     */
    transferDebtFromPreviousYear(targetYear) {
        try {
            const currentYear = Number(targetYear) || new Date().getFullYear();
            const previousYear = currentYear - 1;
            const newData = this.buildDebtTransferRows(previousYear);

            const currSpreadsheet = this.getSpreadsheetForYear(currentYear);
            if (!currSpreadsheet) return `Không tìm thấy file dữ liệu cho năm ${currentYear}.`;

            const currSlSheet = currSpreadsheet.getSheetByName("SL") || currSpreadsheet.insertSheet("SL");

            if (newData.length > 0) {
                currSlSheet.insertRows(2, newData.length);
                currSlSheet.getRange(2, 1, newData.length, 6).setValues(newData);
                this.invalidateSlCache(currentYear);
            }
            Logger.logInfo('Sheets.transferDebtFromPreviousYear', `Transferred debt from ${previousYear} to ${currentYear}`);
            return `Đã chuyển công nợ từ năm ${previousYear} sang năm ${currentYear}.`;
        } catch (e) {
            Logger.logError('Sheets.transferDebtFromPreviousYear', `Failed to transfer debt`, {
                error: e.message
            });
            return `Lỗi khi chuyển công nợ.`;
        }
    },

    buildDebtTransferRows(previousYear) {
        const prevSpreadsheet = this.getSpreadsheetForYear(previousYear);
        if (!prevSpreadsheet) throw new Error(`Không tìm thấy file dữ liệu cho năm ${previousYear}.`);

        const prevSlSheet = prevSpreadsheet.getSheetByName("SL");
        if (!prevSlSheet) throw new Error(`Không tìm thấy sheet SL trong file năm ${previousYear}.`);
        if (prevSlSheet.getLastRow() < 2) return [];

        const prevData = prevSlSheet.getRange("A2:F" + prevSlSheet.getLastRow()).getValues();
        const excludedCustomers = new Set(Config.getExcludedCustomers());
        const customerDebt = new Map();

        prevData.forEach(row => {
            const name = row[1] ? row[1].toString().toUpperCase().trim() : "";
            if (!name || excludedCustomers.has(name)) return;
            const soLieu = Number(row[2]) || 0;
            const thuBu = Number(row[3]) || 0;
            const mucKhac = Number(row[4]) || 0;
            const debt = soLieu - thuBu - mucKhac;
            customerDebt.set(name, (customerDebt.get(name) || 0) + debt);
        });

        const rows = [];
        customerDebt.forEach((debt, name) => {
            if (debt !== 0) {
                rows.push(["31/12/" + previousYear, name, 0, 0, -debt, `Công nợ tồn ${previousYear}`]);
            }
        });
        return rows;
    },

    /**
     * Tự động tạo file mới cho năm hiện tại, cập nhật Config, và chuyển công nợ tồn sang.
     */
    previewCreateNewYearFile(targetYear) {
        try {
            const newYear = Number(targetYear) || (new Date().getFullYear() + 1);
            const prevYear = newYear - 1;
            const yearFiles = Config.getYearFiles();

            const lines = [
                `*KIỂM TRA KHỞI TẠO NĂM ${newYear}*`
            ];

            if (yearFiles[newYear]) {
                lines.push(`⚠️ File năm ${newYear} đã tồn tại trong yearFiles.`);
            } else {
                lines.push(`✅ File năm ${newYear} chưa tồn tại, có thể khởi tạo khi đến thời điểm.`);
            }

            const prevUrl = yearFiles[prevYear];
            if (!prevUrl) {
                lines.push(`❌ Không tìm thấy file năm ${prevYear}.`);
                return lines.join('\n');
            }
            lines.push(`✅ Có file năm ${prevYear}.`);

            const prevIdMatch = prevUrl.match(/[-\w]{25,}/);
            if (!prevIdMatch) {
                lines.push(`❌ Không đọc được ID file từ link năm ${prevYear}.`);
                return lines.join('\n');
            }

            const prevFile = DriveApp.getFileById(prevIdMatch[0]);
            lines.push(`✅ Có quyền đọc/copy file gốc: ${prevFile.getName()}.`);

            const parents = prevFile.getParents();
            lines.push(parents.hasNext() ? `✅ Có thư mục chứa file gốc.` : `⚠️ Không thấy thư mục cha, khi chạy thật sẽ copy vào Drive root.`);

            const ss = SpreadsheetApp.openById(prevFile.getId());
            const sl = ss.getSheetByName("SL");
            const summary = ss.getSheetByName("CustomerSummary");
            lines.push(sl ? `✅ Sheet SL tồn tại, ${Math.max(0, sl.getLastRow() - 1)} dòng dữ liệu.` : `❌ Thiếu sheet SL.`);
            lines.push(summary ? `✅ Sheet CustomerSummary tồn tại.` : `⚠️ Thiếu sheet CustomerSummary.`);

            const transferRows = this.buildDebtTransferRows(prevYear);
            const shareholderRows = transferRows.filter(row => Config.isShareholderName(row[1]));
            lines.push(`✅ Dự kiến kết chuyển ${transferRows.length} dòng công nợ sang năm ${newYear}.`);
            lines.push(`✅ Trong đó có ${shareholderRows.length} dòng công nợ cổ đông${shareholderRows.length ? ': ' + shareholderRows.map(row => row[1]).join(', ') : '.'}`);
            lines.push(`\n_Dry-run không tạo file, không sửa Script Properties, không ghi dữ liệu._`);
            return lines.join('\n');
        } catch (e) {
            Logger.logError('Sheets.previewCreateNewYearFile', 'Failed', { error: e.message });
            return `❌ Lỗi khi kiểm tra khởi tạo năm mới: ${e.message}`;
        }
    },

    countDebtTransferRows(previousYear) {
        return this.buildDebtTransferRows(previousYear).length;
    },

    testCreateNewYearFileSandbox(targetYear) {
        let testFile = null;
        try {
            const newYear = Number(targetYear) || (new Date().getFullYear() + 1);
            const prevYear = newYear - 1;
            const yearFiles = Config.getYearFiles();
            const prevUrl = yearFiles[prevYear];
            if (!prevUrl) return `❌ Không tìm thấy file năm ${prevYear}.`;

            const prevIdMatch = prevUrl.match(/[-\w]{25,}/);
            if (!prevIdMatch) return `❌ Không đọc được ID file từ link năm ${prevYear}.`;

            const prevFile = DriveApp.getFileById(prevIdMatch[0]);
            const parents = prevFile.getParents();
            const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
            testFile = prevFile.makeCopy(`TEST_QLCN_${newYear}_${Utilities.formatDate(new Date(), Config.getTimezone(), "yyyyMMdd_HHmmss")}`, folder);

            const testSpreadsheet = SpreadsheetApp.openById(testFile.getId());
            const slSheet = testSpreadsheet.getSheetByName("SL");
            if (!slSheet) throw new Error('File test thiếu sheet SL.');

            if (slSheet.getLastRow() > 1) {
                slSheet.getRange(2, 1, slSheet.getLastRow() - 1, slSheet.getLastColumn()).clearContent();
            }

            const transferRows = this.buildDebtTransferRows(prevYear);
            if (transferRows.length > 0) {
                slSheet.insertRows(2, transferRows.length);
                slSheet.getRange(2, 1, transferRows.length, 6).setValues(transferRows);
            }

            const writtenRows = Math.max(0, slSheet.getLastRow() - 1);
            const shareholderRows = transferRows.filter(row => Config.isShareholderName(row[1]));
            const result = [
                `*SANDBOX KHỞI TẠO NĂM ${newYear}*`,
                `✅ Đã copy thử file ${prevYear}.`,
                `✅ Đã xóa dữ liệu SL trong file test.`,
                `✅ Đã ghi thử ${transferRows.length} dòng công nợ tồn.`,
                `✅ Trong đó có ${shareholderRows.length} dòng cổ đông${shareholderRows.length ? ': ' + shareholderRows.map(row => row[1]).join(', ') : '.'}`,
                writtenRows === transferRows.length ? `✅ Số dòng SL sau test khớp.` : `⚠️ Số dòng SL sau test là ${writtenRows}, dự kiến ${transferRows.length}.`,
                `🧹 File test đã được đưa vào thùng rác.`,
                `_Không sửa yearFiles và không ảnh hưởng file thật._`
            ].join('\n');

            testFile.setTrashed(true);
            return result;
        } catch (e) {
            if (testFile) {
                try {
                    testFile.setTrashed(true);
                } catch (cleanupError) {
                    Logger.logError('Sheets.testCreateNewYearFileSandbox.cleanup', cleanupError.message);
                }
            }
            Logger.logError('Sheets.testCreateNewYearFileSandbox', 'Failed', { error: e.message });
            return `❌ Lỗi sandbox khởi tạo năm mới: ${e.message}`;
        }
    },

    createNewYearFileAndTransferDebt(targetYear) {
        try {
            const currentYear = Number(targetYear) || new Date().getFullYear();
            const prevYear = currentYear - 1;
            const yearFiles = Config.getYearFiles();
            
            if (yearFiles[currentYear]) {
                return `File cho năm ${currentYear} đã tồn tại trong hệ thống.`;
            }

            if (!yearFiles[prevYear]) {
                return `Không tìm thấy file của năm ${prevYear} để nhân bản.`;
            }

            // Lấy ID file cũ
            const prevUrl = yearFiles[prevYear];
            const prevIdMatch = prevUrl.match(/[-\w]{25,}/);
            if (!prevIdMatch) return "Không thể lấy ID từ link file cũ.";
            const prevId = prevIdMatch[0];

            const prevFile = DriveApp.getFileById(prevId);
            // Lấy thư mục chứa file cũ để lưu file mới vào cùng chỗ
            const folders = prevFile.getParents();
            const folder = folders.hasNext() ? folders.next() : DriveApp.getRootFolder();
            
            // Nhân bản file
            const newFile = prevFile.makeCopy(`QLCN_${currentYear}`, folder);
            const newUrl = newFile.getUrl();
            
            // Cập nhật URL vào Config
            yearFiles[currentYear] = newUrl;
            Config.setConfig(Config.YEAR_FILES_PROPERTY, yearFiles);

            // Xóa dữ liệu cũ trong file mới
            const newSpreadsheet = SpreadsheetApp.openById(newFile.getId());
            
            const slSheet = newSpreadsheet.getSheetByName("SL");
            if (slSheet && slSheet.getLastRow() > 1) {
                // Xóa từ dòng 2 đến hết
                slSheet.getRange(2, 1, slSheet.getLastRow() - 1, slSheet.getLastColumn()).clearContent();
                this.invalidateSlCache(currentYear);
            }

            // Ghi chú: Chúng ta KHÔNG clear dữ liệu trong sheet QLCN nữa
            // Vì QLCN giờ chỉ chứa công thức (như =UNIQUE và =SUMIFS) liên kết với sheet SL.
            // Khi sheet SL bị làm sạch ở trên, QLCN sẽ tự động làm sạch theo.
            // Gọi hàm chuyển công nợ tồn
            const transferResult = this.transferDebtFromPreviousYear(currentYear);
            
            return `✅ *ĐÃ TẠO NĂM ${currentYear} THÀNH CÔNG*\n\n` +
                   `🔗 *Link file mới:* ${newUrl}\n` +
                   `📦 *Kết quả kết chuyển:* ${transferResult}`;
            
        } catch (e) {
            Logger.logError('Sheets.createNewYearFileAndTransferDebt', 'Failed to automate new year', { error: e.message });
            return `❌ Lỗi khi tự động tạo năm mới: ${e.message}\nLưu ý: Nếu lỗi do thiếu quyền truy cập Drive, vui lòng chạy lại script từ Editor để cấp quyền.`;
        }
    },

    /**
     * Kiểm tra xem có nên đánh dấu công nợ không.
     * @param {string} name - Tên khách hàng.
     * @param {number} debt - Giá trị công nợ.
     * @param {boolean} isPositive - True nếu công nợ dương.
     * @returns {boolean} True nếu cần đánh dấu.
     */
    shouldMarkDebt(name, debt, isPositive) {
        if (name === "ONE" && this.isMonday()) {
            return true;
        }
        const thresholds = Config.getCustomerThresholds();
        if (thresholds[name]) {
            if (isPositive) {
                return debt >= thresholds[name].positive;
            } else {
                return debt <= thresholds[name].negative;
            }
        }
        return false;
    },

    /**
     * Kiểm tra xem hôm nay có phải thứ Hai không.
     * @returns {boolean} True nếu là thứ Hai.
     */
    isMonday() {
        return new Date().getDay() === 1;
    },

    /**
     * Định dạng số với dấu chấm phân cách hàng nghìn.
     * @param {number} number - Số cần định dạng.
     * @returns {string} Chuỗi số đã định dạng.
     */
    formatNumberWithDot(number) {
        return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    },

    /**
     * Định dạng ngày tháng nhanh (bằng Javascript native để tối ưu hóa trong vòng lặp)
     * @param {Date} dateObj - Đối tượng Date
     * @param {string} format - Định dạng (mặc định dd/MM/yyyy)
     */
    formatDateJS(dateObj, format = "dd/MM/yyyy") {
        const d = dateObj.getDate().toString().padStart(2, '0');
        const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const y = dateObj.getFullYear();
        if (format === "MM/yyyy") return `${m}/${y}`;
        return `${d}/${m}/${y}`;
    },

    /**
     * Xóa khách hàng khỏi sheet QLCN.
     * @param {string} customerName - Tên khách hàng cần xóa.
     * @returns {string} Thông báo kết quả.
     */
    deleteCustomer(customerName) {
        try {
            const year = new Date().getFullYear();
            const spreadsheet = this.getSpreadsheetForYear(year);
            if (!spreadsheet) throw new Error(`No spreadsheet for year ${year}`);
            const slSheet = spreadsheet.getSheetByName("SL");
            if (slSheet) {
                const lastRow = slSheet.getLastRow();
                if (lastRow > 1) {
                    const customerNames = slSheet.getRange("B2:B" + lastRow).getValues().flat();
                    if (customerNames.includes(customerName)) {
                        Logger.logInfo('Sheets.deleteCustomer', `Cannot delete customer ${customerName} due to existing data in SL`, {
                            customerName
                        });
                        return `Không thể xóa khách hàng ${customerName} vì đã có số liệu trong hệ thống.`;
                    }
                }
            }
            const summarySheet = spreadsheet.getSheetByName("CustomerSummary");
            if (!summarySheet) throw new Error(`No CustomerSummary sheet for year ${year}`);
            
            const lastRowSum = summarySheet.getLastRow();
            if (lastRowSum < 2) return `Khách hàng ${customerName} không tồn tại.`;

            const columnA = summarySheet.getRange("A2:A" + lastRowSum).getValues().flat();
            const rowIndex = columnA.indexOf(customerName);
            if (rowIndex === -1) {
                Logger.logInfo('Sheets.deleteCustomer', `Customer ${customerName} not found in CustomerSummary`, { customerName });
                return `Khách hàng ${customerName} không tồn tại.`;
            }
            summarySheet.deleteRow(rowIndex + 2);
            
            this.clearCustomerMenuCache();
            Logger.logInfo('Sheets.deleteCustomer', `Deleted customer ${customerName} from CustomerSummary and cleared cache`);
            return `Đã xóa khách hàng ${customerName}.`;
        } catch (e) {
            Logger.logError('Sheets.deleteCustomer', `Failed to delete customer`, {
                customerName,
                error: e.message
            });
            throw e;
        }
    },

    /**
     * Lấy danh sách giao dịch trong một ngày.
     * @param {string} date - Ngày (dd/MM/yyyy).
     * @returns {Object[]} Danh sách giao dịch.
     */
    getTransactionsByDate(date, options = {}) {
        try {
            const startTime = Date.now();
            const year = parseInt(date.split('/')[2], 10);
            const transactions = this.getSlRowsForYear(year)
                .filter(row => row.dateText === date && (!options.excludeShareholders || !Config.isShareholderName(row.customerKey)))
                .map(row => ({
                    rowIndex: row.rowIndex,
                    date: row.dateText,
                    customerName: row.customerName,
                    amount1: row.amount1,
                    amount2: row.amount2,
                    amount3: row.amount3,
                    note: row.note
                }));

            Logger.logInfo('Sheets.getTransactionsByDate',
                `Retrieved ${transactions.length} transactions for ${date} in ${Date.now() - startTime}ms`);
            return transactions;
        } catch (e) {
            Logger.logError('Sheets.getTransactionsByDate', `Failed to get transactions for ${date}`, {
                error: e.message
            });
            return [];
        }
    },


    /**
     * Cập nhật giao dịch trong sheet SL.
     * @param {number} rowIndex - Chỉ số dòng cần cập nhật.
     * @param {string} date - Ngày giao dịch.
     * @param {string} customerName - Tên khách hàng.
     * @param {number} amount1 - Số liệu.
     * @param {number} amount2 - Thu bù.
     * @param {number} amount3 - Mục khác.
     * @param {string} note - Ghi chú.
     */
    updateTransaction(rowIndex, date, customerName, amount1, amount2, amount3, note) {
        try {
            const startTime = Date.now();
            if (!date || typeof date !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
                throw new Error(`Invalid date format: ${date || 'undefined'}`);
            }
            const year = parseInt(date.split('/')[2], 10);
            const spreadsheet = this.getSpreadsheetForYear(year);
            if (!spreadsheet) throw new Error(`No spreadsheet for year ${year}`);
            const sheet = spreadsheet.getSheetByName("SL");
            if (!sheet) throw new Error(`No SL sheet for year ${year}`);

            sheet.getRange(rowIndex, 1, 1, 6).setValues([
                [date, customerName, amount1, amount2, amount3, note]
            ]);
            this.invalidateSlCache(year);
            Logger.logInfo('Sheets.updateTransaction', `Updated transaction at row ${rowIndex} for ${customerName} on ${date} in ${Date.now() - startTime}ms`, {
                amount1,
                amount2,
                amount3,
                note
            });
        } catch (e) {
            Logger.logError('Sheets.updateTransaction', `Failed to update transaction`, {
                rowIndex,
                customerName,
                date,
                error: e.message
            });
            throw e;
        }
    },

    /**
     * Xóa giao dịch khỏi sheet SL.
     * @param {number} rowIndex - Chỉ số dòng cần xóa.
     * @param {string} date - Ngày giao dịch (dd/MM/yyyy).
     * @param {string} customerName - Tên khách hàng.
     */
    deleteTransaction(rowIndex, date, customerName) {
        try {
            const startTime = Date.now();
            Logger.logInfo('Sheets.deleteTransaction', `Attempting to delete row ${rowIndex} for ${customerName} on ${date}`);
            const year = parseInt(date.split('/')[2], 10);
            if (isNaN(year)) throw new Error(`Invalid year parsed from date: ${date}`);
            const spreadsheet = this.getSpreadsheetForYear(year);
            if (!spreadsheet) throw new Error(`No spreadsheet for year ${year}`);
            const sheet = spreadsheet.getSheetByName("SL");
            if (!sheet) throw new Error(`No SL sheet for year ${year}`);

            sheet.deleteRow(rowIndex);
            this.invalidateSlCache(year);
            Logger.logInfo('Sheets.deleteTransaction', `Deleted transaction at row ${rowIndex} for ${customerName} on ${date} in ${Date.now() - startTime}ms`);
        } catch (e) {
            Logger.logError('Sheets.deleteTransaction', `Failed to delete transaction`, {
                rowIndex,
                customerName,
                date,
                error: e.message
            });
            throw e;
        }
    },
};
