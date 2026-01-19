// 主题管理系统 - 简化版
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'system';
        this.systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.isTransitioning = false;
        this.init();
    }

    init() {
        // 应用初始主题
        this.applyTheme();

        // 绑定主题切换按钮
        this.bindThemeToggle();

        // 监听系统主题变化
        this.watchSystemTheme();

        // 添加点击涟漪效果
        this.addRippleEffect();

        console.log('主题管理器已初始化');
    }

    addRippleEffect() {
        document.addEventListener('click', (e) => {
            // 为所有按钮添加涟漪效果
            const button = e.target.closest('.btn-animated, .btn-theme-circle');
            if (button) {
                this.createRipple(e, button);
            }
        });
    }

    createRipple(event, element) {
        const ripple = document.createElement('span');
        const rect = element.getBoundingClientRect();

        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        ripple.classList.add('ripple');

        element.style.position = 'relative';
        element.style.overflow = 'hidden';
        element.appendChild(ripple);

        setTimeout(() => ripple.remove(), 600);
    }

    applyTheme() {
        // 根据当前设置决定使用什么主题
        let effectiveTheme = this.theme;

        if (this.theme === 'system') {
            effectiveTheme = this.systemPrefersDark ? 'dark' : 'light';
        }

        // 更新body类
        if (effectiveTheme === 'dark') {
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
        } else {
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
        }

        // 更新meta theme-color
        this.updateMetaThemeColor(effectiveTheme);

        // 更新切换按钮图标
        this.updateToggleIcon();
    }

    updateMetaThemeColor(theme) {
        let metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (!metaThemeColor) {
            metaThemeColor = document.createElement('meta');
            metaThemeColor.name = 'theme-color';
            document.head.appendChild(metaThemeColor);
        }

        if (theme === 'dark') {
            metaThemeColor.content = '#0f1a2f';
        } else {
            metaThemeColor.content = '#e8f4e8';
        }
    }

    async setTheme(theme, animate = true) {
        if (this.isTransitioning || theme === this.theme) return;

        this.isTransitioning = true;

        // 简化的主题切换：直接应用主题变化
        this.theme = theme;
        localStorage.setItem('theme', theme);
        this.applyTheme();

        // 显示主题切换通知
        this.showThemeToast(theme);

        this.isTransitioning = false;
    }

    toggleTheme() {
        // 循环切换：light -> dark -> system -> light
        let newTheme;
        switch (this.theme) {
            case 'light':
                newTheme = 'dark';
                break;
            case 'dark':
                newTheme = 'system';
                break;
            case 'system':
            default:
                newTheme = 'light';
                break;
        }

        this.setTheme(newTheme, true);
    }

    showThemeToast(theme) {
        let message;
        let icon;

        switch (theme) {
            case 'light':
                message = '已切换到浅色主题';
                icon = 'fas fa-sun';
                break;
            case 'dark':
                message = '已切换到深色主题';
                icon = 'fas fa-moon';
                break;
            case 'system':
                message = '已切换到跟随系统主题';
                icon = 'fas fa-desktop';
                break;
        }

        // 使用现有的toast系统
        if (window.fileManager && typeof window.fileManager.showToast === 'function') {
            window.fileManager.showToast(message, 'info');
        }
    }

    bindThemeToggle() {
        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                this.toggleTheme();
                this.createRipple(e, toggleBtn);
            });
        }
    }

    updateToggleIcon() {
        const toggleBtn = document.getElementById('themeToggle');
        if (!toggleBtn) return;

        const icon = toggleBtn.querySelector('i');
        const badge = toggleBtn.querySelector('.theme-badge');

        if (!icon) return;

        let iconClass, badgeClass, tooltipText;

        // 确定图标、徽章和提示文本
        if (this.theme === 'system') {
            iconClass = 'fas fa-desktop';
            tooltipText = '跟随系统主题（点击切换）';

            // 根据当前实际主题显示徽章颜色
            const effectiveTheme = this.systemPrefersDark ? 'dark' : 'light';
            badgeClass = effectiveTheme === 'dark' ? 'bg-dark' : 'bg-light';
        } else if (this.theme === 'dark') {
            iconClass = 'fas fa-sun';
            badgeClass = 'bg-dark';
            tooltipText = '深色主题';
        } else {
            iconClass = 'fas fa-moon';
            badgeClass = 'bg-light';
            tooltipText = '浅色主题';
        }

        // 更新图标
        icon.className = iconClass;

        // 更新徽章
        if (badge) {
            badge.className = `theme-badge ${badgeClass}`;
        }

        // 设置提示文本
        toggleBtn.title = tooltipText;
    }

    watchSystemTheme() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

        // 更新初始状态
        this.systemPrefersDark = prefersDark.matches;

        // 监听系统主题变化
        prefersDark.addEventListener('change', (e) => {
            this.systemPrefersDark = e.matches;

            // 只有在使用系统主题时才应用变化
            if (this.theme === 'system') {
                this.applyTheme();
                this.updateToggleIcon();
            }
        });
    }
}

// 初始化主题管理器
window.themeManager = new ThemeManager();