// 主应用入口
class FileTransferApp {
    constructor() {
        this.init();
    }

    init() {
        this.setupToastStyles();
        this.setupGlobalEvents();
        this.setupHashRouting();
        console.log('文件传输应用已启动');
    }

    setupHashRouting() {
        // 初始化时处理当前路由
        if (!window.location.hash) {
            window.location.hash = '#/';
        }

        // 监听路由变化
        window.addEventListener('hashchange', () => {
            this.handleRouteChange();
        });

        // 初始路由处理
        this.handleRouteChange();
    }

    handleRouteChange() {
        const hash = window.location.hash;

        // 更新页面标题
        const path = hash.startsWith('#/browse/') ? hash.substring(9) : '';
        if (path) {
            const pathParts = path.split('/');
            const currentFolder = pathParts[pathParts.length - 1] || '根目录';
            document.title = `${currentFolder} - FileFly`;
        } else {
            document.title = 'FileFly';
        }
    }

    setupToastStyles() {
        if (!document.querySelector('#toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.textContent = `
                .toast-notification {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: var(--light);
                    color: var(--dark);
                    padding: 12px 16px;
                    border-radius: var(--radius);
                    box-shadow: var(--shadow);
                    z-index: 9999;
                    border-left: 4px solid var(--primary);
                    animation: slideIn 0.3s ease-out;
                    max-width: 300px;
                    font-size: 0.875rem;
                }
                .toast-success { border-left-color: var(--success); }
                .toast-error,
                .toast-danger { border-left-color: var(--danger); }
                .toast-warning { border-left-color: var(--warning); }
                .toast-info { border-left-color: var(--primary); }
                .toast-content { display: flex; align-items: center; }
                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes slideOut {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    setupGlobalEvents() {
        // 全局点击事件处理
        document.addEventListener('click', (e) => {
            // 处理主题相关的点击
            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle && themeToggle.contains(e.target)) {
                return;
            }

            // 关闭所有打开的右键菜单
            const contextMenu = document.getElementById('contextMenu');
            if (contextMenu && contextMenu.style.display === 'block') {
                contextMenu.style.display = 'none';
            }
        });

        // 阻止右键菜单的默认行为
        document.addEventListener('contextmenu', (e) => {
            // 只在文件项上显示右键菜单
            if (!e.target.closest('.file-item')) {
                e.preventDefault();
            }
        });
    }
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', () => {
    window.app = new FileTransferApp();
});