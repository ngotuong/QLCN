// Router.gs
const Router = {
    HEAVY_CALLBACK_PREFIXES: [
        'check_debt',
        'check_debt_today',
        'commission_this_month',
        'commission_prev_month',
        'commission_this_year',
        'commission_all_time',
        'check_this_year'
    ],

    STATELESS_NAV_CALLBACKS: {
        nav_main: {
            text: "*Em chào đại ka! Đại ka muốn làm gì ✌*",
            menu: () => Menu.createStartMenu()
        },
        nav_customer_menu: {
            text: "Chọn hành động với khách hàng:",
            menu: () => Menu.createCustomerMenu()
        },
        nav_manage_data: {
            text: "Chọn hành động với số liệu:",
            menu: () => Menu.createManageDataMenu()
        },
        nav_shareholders: {
            text: "Chọn thao tác với cổ đông:",
            menu: () => Menu.createShareholderMenu()
        },
        nav_admin: {
            text: "Chọn thao tác quản trị:",
            menu: () => Menu.createAdminMenu()
        }
    },

    shouldShowTyping(callbackData) {
        return this.HEAVY_CALLBACK_PREFIXES.some(prefix => callbackData.startsWith(prefix));
    },

    handleStatelessNavigation(callbackData, chatId, messageId) {
        const nav = this.STATELESS_NAV_CALLBACKS[callbackData];
        if (!nav) return false;
        StateManager.clear(chatId);
        Telegram.editMessage(chatId, messageId, nav.text, nav.menu());
        return true;
    }
};
