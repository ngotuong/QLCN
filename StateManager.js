// StateManager.gs
const StateManager = {
    // Bộ nhớ tạm cho trạng thái trong phiên
    _tempStates: {},

    /**
     * Lưu trạng thái cho một chatId.
     * @param {string} chatId - ID của chat Telegram.
     * @param {Object} newState - Trạng thái mới để cập nhật.
     */
    save(chatId, newState) {
        try {
            const current = this._tempStates[chatId] || {};
            const merged = {
                ...current,
                ...newState
            };
            if (this._isSameState(current, merged)) {
                return;
            }
            this._tempStates[chatId] = merged;
            CacheService.getScriptCache().put(`userState_${chatId}`, JSON.stringify(merged), 43200);
            Logger.logInfo('StateManager.save', `Saved state`, {
                chatId
            });
        } catch (e) {
            Logger.logError('StateManager.save', `Failed`, {
                chatId,
                error: e.message
            });
            throw e;
        }
    },

    _isSameState(a, b) {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        return bKeys.every(key => a[key] === b[key]);
    },

    /**
     * Tải trạng thái của một chatId.
     * @param {string} chatId - ID của chat Telegram.
     * @returns {Object} Trạng thái hiện tại, hoặc object rỗng nếu không có.
     */
    load(chatId) {
        // ĐỌC không khóa để tránh chờ
        try {
            if (this._tempStates[chatId]) return this._tempStates[chatId];
            const cache = CacheService.getScriptCache();
            const cached = cache.get(`userState_${chatId}`);
            const state = cached ? JSON.parse(cached) : {};
            this._tempStates[chatId] = state;
            return state;
        } catch (e) {
            Logger.logError('StateManager.load', `Failed`, {
                chatId,
                error: e.message
            });
            return {};
        }
    },

    /**
     * Xóa trạng thái của một chatId.
     * @param {string} chatId - ID của chat Telegram.
     */
    clear(chatId) {
        try {
            const startTime = Date.now();
            // Xóa bộ nhớ tạm
            delete this._tempStates[chatId];

            // Xóa CacheService
            const cache = CacheService.getScriptCache();
            cache.remove(`userState_${chatId}`);

            const duration = Date.now() - startTime;
            Logger.logInfo('StateManager.clear', `Cleared state for chatId ${chatId} in ${duration}ms`);
        } catch (e) {
            Logger.logError('StateManager.clear', `Failed to clear state for chatId ${chatId}`, {
                error: e.message
            });
        }
    },

    /**
     * Đồng bộ trạng thái từ bộ nhớ tạm sang PropertiesService (gọi khi cần lưu lâu dài).
     * @param {string} chatId - ID của chat Telegram.
     */
    syncToPersistent(chatId) {
        try {
            const startTime = Date.now();
            if (this._tempStates[chatId]) {
                const states = Config.getConfig('userStates');
                states[chatId] = this._tempStates[chatId];
                Config.setConfig('userStates', states);
                const duration = Date.now() - startTime;
                Logger.logInfo('StateManager.syncToPersistent', `Synced state for chatId ${chatId} in ${duration}ms`);
            }
        } catch (e) {
            Logger.logError('StateManager.syncToPersistent', `Failed to sync state for chatId ${chatId}`, {
                error: e.message
            });
        }
    }
};
