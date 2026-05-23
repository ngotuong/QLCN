// Telegram.gs
const Telegram = {
    /**
     * Gửi tin nhắn đến một chat Telegram.
     * @param {string} chatId - ID của chat.
     * @param {string} text - Nội dung tin nhắn.
     * @param {Object} [replyMarkup] - Bàn phím inline (tùy chọn).
     * @returns {boolean} True nếu gửi thành công, false nếu thất bại.
     */
     sendMessage(chatId, text, replyMarkup, options) {
    const url = `https://api.telegram.org/bot${Config.getTelegramApiToken()}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: text,
      // Giữ nguyên mặc định cũ là 'Markdown' để KHÔNG ảnh hưởng các nơi khác
      parse_mode: (options && options.parseMode) ? options.parseMode : 'Markdown'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    if (options && Object.prototype.hasOwnProperty.call(options, 'disable_web_page_preview')) {
      payload.disable_web_page_preview = options.disable_web_page_preview;
    }

    const startTime = Date.now();
    let retries = 3;
    while (retries > 0) {
      try {
        const response = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
        const code = response.getResponseCode();
        if (code === 200) {
          const result = JSON.parse(response.getContentText()).result;
          if (options && options.trackCleanup && result && result.message_id) {
            this.trackMessageForCleanup(chatId, result.message_id);
          }
          Logger.logInfo('Telegram.sendMessage', `Sent to ${chatId} in ${Date.now()-startTime}ms`, {
            text: text.substring(0, 120),
          });
          return true;
        }
        Logger.logError('Telegram.sendMessage', `Failed with code ${code}`, {
          chatId, response: response.getContentText()
        });
        Utilities.sleep(code === 429 ? 3000 : 500);
        retries--;
      } catch (e) {
        Logger.logError('Telegram.sendMessage', `Fetch error: ${e.message}`, { chatId });
        Utilities.sleep(500);
        retries--;
      }
    }
    Logger.logError('Telegram.sendMessage', `Failed after retries in ${Date.now()-startTime}ms`, { chatId });
	    return false;
	  },

    trackMessageForCleanup(chatId, messageId) {
        const properties = PropertiesService.getScriptProperties();
        const key = `cleanupMessages_${chatId}`;
        const now = Date.now();
        const current = JSON.parse(properties.getProperty(key) || '[]')
            .filter(item => item && item.id && now - Number(item.ts || 0) < 172800000);
        current.push({ id: Number(messageId), ts: now });
        const deduped = Array.from(new Map(current.map(item => [item.id, item])).values()).slice(-60);
        properties.setProperty(key, JSON.stringify(deduped));
    },

    cleanupTrackedMessages(chatId, extraMessageIds = []) {
        const properties = PropertiesService.getScriptProperties();
        const key = `cleanupMessages_${chatId}`;
        const stored = JSON.parse(properties.getProperty(key) || '[]')
            .map(item => Number(item.id || item))
            .filter(Boolean);
        const ids = Array.from(new Set(stored.concat(extraMessageIds.map(Number)).filter(Boolean)));
        ids.forEach(messageId => this.deleteMessage(chatId, messageId));
        properties.deleteProperty(key);
        return ids.length;
    },

    deleteMessage(chatId, messageId) {
        const url = `https://api.telegram.org/bot${Config.getTelegramApiToken()}/deleteMessage`;
        const payload = {
            chat_id: chatId,
            message_id: messageId
        };
        try {
            const response = UrlFetchApp.fetch(url, {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify(payload),
                muteHttpExceptions: true
            });
            if (response.getResponseCode() !== 200) {
                Logger.logInfo('Telegram.deleteMessage', `Delete skipped, code: ${response.getResponseCode()}`, {
                    chatId,
                    messageId
                });
                return false;
            }
            return true;
        } catch (e) {
            Logger.logInfo('Telegram.deleteMessage', `Delete failed: ${e.message}`, { chatId, messageId });
            return false;
        }
    },

    /**
     * Chỉnh sửa nội dung tin nhắn đã gửi.
     * @param {string} chatId - ID của chat.
     * @param {string} messageId - ID của tin nhắn cần chỉnh sửa.
     * @param {string} text - Nội dung mới.
     * @param {Object} [replyMarkup] - Bàn phím inline mới (tùy chọn).
     */
    editMessage(chatId, messageId, text, replyMarkup, options) {
        const startTime = Date.now();
        try {
            const url = `https://api.telegram.org/bot${Config.getTelegramApiToken()}/editMessageText`;
            const payload = {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: (options && options.parseMode) ? options.parseMode : 'Markdown'
            };
            if (replyMarkup) {
                payload.reply_markup = replyMarkup;
            }
            const requestOptions = {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify(payload),
                muteHttpExceptions: true
            };

            const response = UrlFetchApp.fetch(url, requestOptions);
            const responseCode = response.getResponseCode();
            const duration = Date.now() - startTime;
            if (responseCode !== 200) {
                Logger.logError('Telegram.editMessage', `Failed to edit message, code: ${responseCode}, duration: ${duration}ms`, {
                    chatId,
                    messageId,
                    text: text.substring(0, 50),
                    response: response.getContentText()
                });
                return false;
            }
            Logger.logInfo('Telegram.editMessage', `Edited message in chatId ${chatId}, duration: ${duration}ms`, {
                messageId,
                text: text.substring(0, 50)
            });
            return true;
        } catch (e) {
            const duration = Date.now() - startTime;
            Logger.logError('Telegram.editMessage', `Fetch error: ${e.message}, duration: ${duration}ms`, {
                chatId,
                messageId,
                text: text.substring(0, 50)
            });
            return false;
        }
    },

    // Thêm vào trong object Telegram
    answerCallback(callbackQueryId, text, showAlert) {
        const url = `https://api.telegram.org/bot${Config.getTelegramApiToken()}/answerCallbackQuery`;
        const payload = {
            callback_query_id: callbackQueryId,
            text: text || '',
            show_alert: !!showAlert
        };
        const options = {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        };
        const startTime = Date.now();
        try {
            const res = UrlFetchApp.fetch(url, options);
            const code = res.getResponseCode();
            if (code !== 200) {
                Logger.logError('Telegram.answerCallback', `Failed, code: ${code}`, {
                    response: res.getContentText()
                });
                return false;
            }
            Logger.logInfo('Telegram.answerCallback', `Ack in ${Date.now() - startTime}ms`);
            return true;
        } catch (e) {
            Logger.logError('Telegram.answerCallback', `Fetch error: ${e.message}`);
            return false;
        }
    },

    // Thêm vào trong object Telegram
    sendChatAction(chatId, action) {
        const url = `https://api.telegram.org/bot${Config.getTelegramApiToken()}/sendChatAction`;
        const payload = {
            chat_id: chatId,
            action: action || 'typing'
        };
        const options = {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        };
        try {
            UrlFetchApp.fetch(url, options);
            Logger.logInfo('Telegram.sendChatAction', `Sent ${payload.action} to ${chatId}`);
        } catch (e) {
            Logger.logError('Telegram.sendChatAction', `Failed: ${e.message}`, {
                chatId
            });
        }
    },


    /**
     * Cập nhật reply markup của một tin nhắn.
     * @param {string} chatId - ID của chat.
     * @param {string} messageId - ID của tin nhắn.
     * @param {Object} replyMarkup - Bàn phím inline mới.
     */
    updateMessageReplyMarkup(chatId, messageId, replyMarkup) {
        const url = `https://api.telegram.org/bot${Config.getTelegramApiToken()}/editMessageReplyMarkup`;
        const payload = {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: replyMarkup
        };
        const options = {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        };

        const startTime = Date.now();
        try {
            const response = UrlFetchApp.fetch(url, options);
            const responseCode = response.getResponseCode();
            const duration = Date.now() - startTime;
            if (responseCode !== 200) {
                Logger.logError('Telegram.updateMessageReplyMarkup', `Failed to update reply markup, code: ${responseCode}, duration: ${duration}ms`, {
                    chatId,
                    messageId,
                    response: response.getContentText()
                });
            } else {
                Logger.logInfo('Telegram.updateMessageReplyMarkup', `Updated reply markup in chatId ${chatId}, duration: ${duration}ms`, {
                    messageId
                });
            }
        } catch (e) {
            const duration = Date.now() - startTime;
            Logger.logError('Telegram.updateMessageReplyMarkup', `Fetch error: ${e.message}, duration: ${duration}ms`, {
                chatId,
                messageId
            });
        }
    }
};
