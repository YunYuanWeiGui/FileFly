// 文件管理功能 - 支持路由、拖拽移动和批量操作
class FileManager {
    constructor() {
        this.apiBase = '/api';
        this.files = [];
        this.currentPath = '';
        this.breadcrumbs = [];
        this.selectedItems = new Set();
        this.draggedItem = null;
        this.isBatchDownloading = false;
        this.dropHandled = false; // 防止重复处理拖拽
        this.batchOperationInProgress = false; // 防止批量操作重复执行
        this.isMobile = window.innerWidth <= 768; // 检测是否是移动端
        this.clickTimer = null; // 用于区分单击和双击

        this.init();
    }

    init() {
        this.bindEvents();
        this.loadFilesFromPath();
        this.addBatchOperationStyles();
        console.log('文件管理器已初始化，当前设备:', this.isMobile ? '移动端' : '桌面端');
    }

    bindEvents() {
        // 刷新按钮
        document.getElementById('refreshBtn')?.addEventListener('click', () => {
            this.loadFiles(this.currentPath);
            this.showToast('刷新成功', 'info');
        });

        // 搜索功能
        document.getElementById('searchFiles')?.addEventListener('input', (e) => {
            this.searchFiles(e.target.value);
        });

        // 新建文件夹按钮
        document.getElementById('createFolderBtn')?.addEventListener('click', () => {
            this.createFolder();
        });

        // 空状态上传按钮
        document.getElementById('emptyUploadBtn')?.addEventListener('click', () => {
            if (window.uploader && window.uploader.openUploadModal) {
                window.uploader.openUploadModal();
            }
        });

        // 监听路由变化
        window.addEventListener('hashchange', () => {
            this.loadFilesFromPath();
        });

        // 监听窗口大小变化，更新移动端状态
        window.addEventListener('resize', () => {
            this.isMobile = window.innerWidth <= 768;
            console.log('设备状态更新:', this.isMobile ? '移动端' : '桌面端');
        });

        // 初始化时获取当前路径
        this.getCurrentPathFromHash();

        // 初始化批量操作按钮事件
        this.bindBatchOperationEvents();
    }

    bindBatchOperationEvents() {
        // 延迟绑定，确保DOM已加载
        setTimeout(() => {
            // 全选复选框
            const selectAllCheckbox = document.getElementById('selectAllCheckbox');
            if (selectAllCheckbox) {
                // 清除之前的事件监听器
                const newCheckbox = selectAllCheckbox.cloneNode(true);
                selectAllCheckbox.parentNode.replaceChild(newCheckbox, selectAllCheckbox);

                newCheckbox.addEventListener('change', (e) => {
                    this.toggleSelectAll(e.target.checked);
                });
            }

            // 批量下载按钮
            const batchDownloadBtn = document.getElementById('batchDownloadBtn');
            if (batchDownloadBtn) {
                // 清除之前的事件监听器
                const newBtn = batchDownloadBtn.cloneNode(true);
                batchDownloadBtn.parentNode.replaceChild(newBtn, batchDownloadBtn);

                newBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.batchOperationInProgress) {
                        this.batchDownload();
                    }
                });
            }

            // 批量删除按钮
            const batchDeleteBtn = document.getElementById('batchDeleteBtn');
            if (batchDeleteBtn) {
                // 清除之前的事件监听器
                const newBtn = batchDeleteBtn.cloneNode(true);
                batchDeleteBtn.parentNode.replaceChild(newBtn, batchDeleteBtn);

                newBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.batchOperationInProgress) {
                        this.batchDelete();
                    }
                });
            }

            // 取消选择按钮
            const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
            if (cancelSelectionBtn) {
                // 清除之前的事件监听器
                const newBtn = cancelSelectionBtn.cloneNode(true);
                cancelSelectionBtn.parentNode.replaceChild(newBtn, cancelSelectionBtn);

                newBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.clearSelection();
                });
            }
        }, 100);
    }

    getCurrentPathFromHash() {
        // 从URL获取当前路径
        const hash = window.location.hash;
        let path = '';

        if (hash && hash.startsWith('#/browse/')) {
            path = hash.substring(9); // 移除 '#/browse/'
        } else if (hash && hash.startsWith('#/')) {
            path = hash.substring(2);
        }

        // 解码URL编码的路径
        this.currentPath = decodeURIComponent(path);

        // 更新上传器的当前路径
        if (window.uploader) {
            window.uploader.updateCurrentPath(this.currentPath);
        }

        return this.currentPath;
    }

    updateUrlPath(path) {
        // 更新URL但不刷新页面
        const encodedPath = encodeURIComponent(path || '');
        const newHash = path ? `#/browse/${encodedPath}` : '#/';
        window.history.pushState(null, '', newHash);
        this.currentPath = path;

        // 更新上传器的当前路径
        if (window.uploader) {
            window.uploader.updateCurrentPath(this.currentPath);
        }
    }

    loadFilesFromPath() {
        const path = this.getCurrentPathFromHash();
        this.loadFiles(path);
    }

    async loadFiles(path = '') {
        try {
            const loadingElement = document.getElementById('loadingState');
            const emptyElement = document.getElementById('emptyState');

            if (loadingElement) loadingElement.style.display = 'block';
            if (emptyElement) emptyElement.style.display = 'none';

            const response = await fetch(`${this.apiBase}/files?path=${encodeURIComponent(path)}`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`加载失败: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.files = data.files || [];
                this.breadcrumbs = data.breadcrumbs || [];
                this.renderBreadcrumbs();
                this.renderFiles();
                this.updateFileCount();
            } else {
                throw new Error(data.error || '无效的响应数据');
            }

        } catch (error) {
            this.showToast('加载文件列表失败: ' + error.message, 'danger');
            this.renderFiles([]);
            this.updateFileCount();
        } finally {
            const loadingElement = document.getElementById('loadingState');
            if (loadingElement) loadingElement.style.display = 'none';
        }
    }

    updateFileCount() {
        const fileCountElement = document.getElementById('fileCount');
        if (!fileCountElement) return;

        const folderCount = this.files.filter(file => file.type === 'folder').length;
        const fileCount = this.files.filter(file => file.type === 'file').length;

        if (folderCount === 0 && fileCount === 0) {
            fileCountElement.textContent = '空文件夹';
        } else {
            let countText = '';
            if (folderCount > 0) {
                countText += `${folderCount}个文件夹`;
            }
            if (fileCount > 0) {
                if (countText) countText += ' ';
                countText += `${fileCount}个文件`;
            }
            fileCountElement.textContent = countText || '0个项目';
        }
    }

    renderBreadcrumbs() {
        const container = document.getElementById('breadcrumbContainer');
        if (!container) return;

        // 如果没有面包屑数据，创建一个根目录
        if (!this.breadcrumbs || this.breadcrumbs.length === 0) {
            this.breadcrumbs = [{ name: '根目录', path: '' }];
        }

        let html = '';
        this.breadcrumbs.forEach((crumb, index) => {
            const isLast = index === this.breadcrumbs.length - 1;

            if (isLast) {
                // 当前页面，不可点击
                html += `
                    <li class="breadcrumb-item active" aria-current="page">
                        ${index === 0 ? '<i class="fas fa-home me-1"></i>' : '<i class="fas fa-folder me-1"></i>'}
                        ${this.escapeHtml(crumb.name)}
                    </li>
                `;
            } else {
                // 可点击的导航项
                const href = crumb.path ? `#/browse/${encodeURIComponent(crumb.path)}` : '#/';
                html += `
                    <li class="breadcrumb-item">
                        <a href="${href}">
                            ${index === 0 ? '<i class="fas fa-home me-1"></i>' : '<i class="fas fa-folder me-1"></i>'}
                            ${this.escapeHtml(crumb.name)}
                        </a>
                    </li>
                `;
            }
        });

        container.innerHTML = html;
    }

    renderFiles() {
        const container = document.getElementById('fileGrid');
        const emptyState = document.getElementById('emptyState');

        if (!container) {
            console.error('找不到文件网格容器');
            return;
        }

        // 添加父文件夹映射项（如果不是根目录）
        const displayFiles = [...this.files];
        if (this.currentPath && this.currentPath !== '') {
            // 添加"返回上一级"的父文件夹映射
            const parentPath = this.getParentPath(this.currentPath);
            displayFiles.unshift({
                name: '...',
                path: parentPath,
                type: 'parent',
                size: 0,
                modified: '',
                file_count: 0,
                url: `/browse/${parentPath}`
            });
        }

        if (displayFiles.length === 0) {
            container.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            this.updateBatchToolbar();
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        let html = '';
        displayFiles.forEach((file, index) => {
            const isFolder = file.type === 'folder';
            const isParent = file.type === 'parent';
            const fileSize = isFolder ? `${file.file_count || 0} 个项目` : isParent ? '' : this.formatSize(file.size);
            const modifiedTime = isParent ? '' : this.formatDate(file.modified);
            const escapedPath = this.escapeHtml(file.path);
            const escapedName = this.escapeHtml(file.name);
            // 修复：正确编码路径，包括中文等特殊字符
            const encodedPath = encodeURIComponent(file.path || '');
            const icon = isParent ? 'fa-level-up-alt' : (isFolder ? 'fa-folder' : 'fa-file');
            const iconColor = isParent ? '#6c757d' : (isFolder ? 'var(--warning)' : 'var(--primary)');
            const isSelected = this.selectedItems.has(file.path);
            const selectionClass = isSelected ? 'selected' : '';
            const safePath = this.escapeHtml(file.path || '');
            const safeType = this.escapeHtml(file.type || '');

            // 修复文件夹悬浮菜单溢出的问题：限制文件操作按钮为两行
            const fileActions = isParent ?
                `<button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); window.fileManager.openFolder('${this.escapeJsString(file.path)}')">
                    <i class="fas fa-level-up-alt"></i>
                </button>` :
                (isFolder ?
                    `<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); window.fileManager.openFolder('${this.escapeJsString(file.path)}')">
                        <i class="fas fa-folder-open"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="event.stopPropagation(); window.fileManager.downloadFolder('${this.escapeJsString(encodedPath)}')">
                        <i class="fas fa-download"></i>
                    </button>` :
                    `<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); window.fileManager.downloadFile('${this.escapeJsString(encodedPath)}')">
                        <i class="fas fa-download"></i>
                    </button>`
                );

            // 如果不是父文件夹项，添加重命名和删除按钮（第二行）
            const extraActions = !isParent ? `
                <button class="btn btn-sm btn-outline-secondary" 
                        onclick="event.stopPropagation(); window.fileManager.renameItem('${this.escapeJsString(file.path)}')">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" 
                        onclick="event.stopPropagation(); window.fileManager.deleteItem('${this.escapeJsString(file.path)}', '${this.escapeJsString(file.type)}')">
                    <i class="fas fa-trash"></i>
                </button>
            ` : '';

            html += `
                <div class="file-item ${isParent ? 'parent' : (isFolder ? 'folder' : 'file')} ${selectionClass}" 
                     ${isParent ? '' : 'draggable="true"'}
                     data-path="${safePath}"
                     data-type="${safeType}"
                     data-name="${escapedName}"
                     ${isParent ? 'oncontextmenu="event.preventDefault(); return false;"' : ''}>
                    
                    ${!isParent ? `
                        <div class="file-checkbox">
                            <input type="checkbox" 
                                   class="form-check-input file-select-checkbox" 
                                   id="file-${index}"
                                   ${isSelected ? 'checked' : ''}
                                   data-path="${safePath}"
                                   onclick="event.stopPropagation();">
                        </div>
                    ` : ''}
                    
                    <div class="file-icon">
                        <i class="fas ${icon} fa-3x" style="color: ${iconColor};"></i>
                        ${isFolder && !isParent ? '<div class="folder-badge"></div>' : ''}
                    </div>
                    
                    <div class="file-info">
                        <div class="file-name" title="${escapedName}" style="${isParent ? 'color: #6c757d;' : ''}">
                            ${escapedName}
                        </div>
                        <div class="file-details">
                            <span class="file-size" style="${isParent ? 'color: #6c757d;' : ''}">${fileSize}</span>
                            ${!isParent ? `<span class="file-modified">${modifiedTime}</span>` : ''}
                        </div>
                    </div>
                    
                    <div class="file-overlay">
                        <div class="file-actions">
                            <div class="file-actions-row">
                                ${fileActions}
                            </div>
                            ${extraActions ? `
                                <div class="file-actions-row">
                                    ${extraActions}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // 绑定所有事件
        this.bindAllEvents();

        // 更新批量操作工具栏
        this.updateBatchToolbar();
    }

    // 新增：转义JavaScript字符串中的特殊字符
    escapeJsString(str) {
        if (!str) return '';
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/'/g, "\\'")
            .replace(/`/g, '\\`')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    bindAllEvents() {
        // 为所有文件项绑定事件
        const fileItems = document.querySelectorAll('.file-item');

        fileItems.forEach(item => {
            const path = item.dataset.path;
            const type = item.dataset.type;
            const isParent = item.classList.contains('parent');
            const isFolder = type === 'folder';

            // 移除所有之前的事件监听器（通过克隆节点）
            const newItem = item.cloneNode(true);
            if (item.parentNode) {
                item.parentNode.replaceChild(newItem, item);
            }

            // 绑定复选框事件
            const checkbox = newItem.querySelector('.file-select-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    this.toggleFileSelection(path, e.target.checked);
                });

                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }

            // 为父文件夹项绑定拖拽事件（支持拖动文件到返回上一级）
            if (isParent) {
                this.bindDragEventsForParentItem(newItem);
            }

            // 根据设备类型绑定不同的交互
            if (this.isMobile) {
                this.bindMobileEvents(newItem, path, type, isParent, isFolder, checkbox);
            } else {
                this.bindDesktopEvents(newItem, path, type, isParent, isFolder, checkbox);
            }

            // 为非父文件夹项绑定拖拽事件
            if (!isParent) {
                this.bindDragEventsForItem(newItem, path, type);
            }
        });

        // 为空白区域绑定拖拽事件
        this.bindDragEventsForBlankArea();
    }

    bindMobileEvents(item, path, type, isParent, isFolder, checkbox) {
        // 移动端交互逻辑
        if (isParent) {
            // 移动端：父文件夹项单击返回上一级
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.target.closest('.file-checkbox') ||
                    e.target.closest('.file-actions') ||
                    e.target.closest('.btn-sm')) {
                    return;
                }
                this.openFolder(path);
            });
        } else if (isFolder) {
            // 移动端：文件夹单击进入，长按选择
            let longPressTimer = null;
            let isLongPress = false;

            item.addEventListener('touchstart', (e) => {
                isLongPress = false;
                longPressTimer = setTimeout(() => {
                    isLongPress = true;
                    // 长按：切换选择状态
                    if (checkbox) {
                        const newState = !checkbox.checked;
                        checkbox.checked = newState;
                        this.toggleFileSelection(path, newState);
                        e.preventDefault(); // 防止触发其他事件
                    }
                }, 500); // 500毫秒视为长按
            });

            item.addEventListener('touchend', (e) => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }

                if (!isLongPress && !e.target.closest('.file-checkbox') &&
                    !e.target.closest('.file-actions') && !e.target.closest('.btn-sm')) {
                    // 短按：进入文件夹
                    this.openFolder(path);
                }
            });

            item.addEventListener('touchmove', (e) => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            });

            // 防止点击时触发双击
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                // 防止点击复选框或操作按钮时触发
                if (e.target.closest('.file-checkbox') ||
                    e.target.closest('.file-actions') ||
                    e.target.closest('.btn-sm')) {
                    return;
                }
                // 移动端单击文件夹进入（如果没有长按触发）
                if (!isLongPress) {
                    this.openFolder(path);
                }
            });
        } else {
            // 移动端：文件单击选择，取消双击下载
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.target.closest('.file-checkbox') ||
                    e.target.closest('.file-actions') ||
                    e.target.closest('.btn-sm')) {
                    return;
                }
                // 单击文件：切换选择状态
                if (checkbox) {
                    const newState = !checkbox.checked;
                    checkbox.checked = newState;
                    this.toggleFileSelection(path, newState);
                }
            });
        }
    }

    bindDesktopEvents(item, path, type, isParent, isFolder, checkbox) {
        // 桌面端交互逻辑
        if (isParent) {
            // 桌面端：父文件夹项双击返回上一级，单击无操作
            let clickCount = 0;
            let clickTimer = null;

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.target.closest('.file-checkbox') ||
                    e.target.closest('.file-actions') ||
                    e.target.closest('.btn-sm')) {
                    return;
                }

                clickCount++;
                if (clickCount === 1) {
                    // 第一次单击，设置计时器
                    clickTimer = setTimeout(() => {
                        // 单次单击，无操作
                        clickCount = 0;
                    }, 300);
                } else if (clickCount === 2) {
                    // 双击，清除计时器并执行操作
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    this.openFolder(path);
                }
            });
        } else if (isFolder) {
            // 桌面端：文件夹双击进入，单击无操作（仅复选框选中）
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                // 防止点击复选框或操作按钮时触发
                if (e.target.closest('.file-checkbox') ||
                    e.target.closest('.file-actions') ||
                    e.target.closest('.btn-sm')) {
                    return;
                }
                // 桌面端单击文件夹无操作
            });

            item.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                // 桌面端双击文件夹进入
                this.openFolder(path);
            });
        } else {
            // 桌面端：文件无单击操作，取消双击下载，仅通过复选框选择
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                // 防止点击复选框或操作按钮时触发
                if (e.target.closest('.file-checkbox') ||
                    e.target.closest('.file-actions') ||
                    e.target.closest('.btn-sm')) {
                    return;
                }
                // 桌面端单击文件无操作
            });

            // 取消文件双击下载功能
            item.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                // 桌面端文件双击无操作
                console.log('文件双击（功能已取消）');
            });
        }
    }

    bindDragEventsForParentItem(item) {
        // 为父文件夹项绑定拖拽事件，支持拖动文件到返回上一级
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!this.draggedItem || this.draggedItem.path === item.dataset.path) return;

            // 显示拖拽效果
            item.classList.add('drag-over');
            e.dataTransfer.dropEffect = 'move';
        });

        item.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            item.classList.remove('drag-over');

            if (!this.draggedItem || this.dropHandled) return;

            this.dropHandled = true;

            // 显示确认框
            if (confirm(`确定要将 "${this.draggedItem.name}" 移动到上一级目录吗？`)) {
                // 移动到父目录
                const parentPath = this.getParentPath(this.currentPath);
                this.moveItem(this.draggedItem.path, parentPath);
            }
        });

        // 防止拖拽开始和结束时的样式问题
        item.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });

        item.addEventListener('dragend', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
        });
    }

    bindDragEventsForItem(item, path, type) {
        // 开始拖拽
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', path);
            e.dataTransfer.effectAllowed = 'move';
            this.draggedItem = { path, type, name: item.dataset.name };
            item.classList.add('dragging');
        });

        // 拖拽结束
        item.addEventListener('dragend', (e) => {
            e.preventDefault();
            item.classList.remove('dragging');
            this.draggedItem = null;
            this.dropHandled = false;
            document.querySelectorAll('.file-item').forEach(el => {
                el.classList.remove('drag-over');
            });
        });

        // 拖拽经过
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!this.draggedItem || this.draggedItem.path === path) return;

            // 如果是文件夹，显示拖拽效果
            if (type === 'folder') {
                item.classList.add('drag-over');
                e.dataTransfer.dropEffect = 'move';
            }
        });

        // 拖拽离开
        item.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');
        });

        // 放置
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            item.classList.remove('drag-over');

            if (!this.draggedItem || this.dropHandled || this.draggedItem.path === path) {
                return;
            }

            // 只有文件夹可以接收放置
            if (type === 'folder') {
                this.dropHandled = true;

                // 显示确认框
                if (confirm(`确定要将 "${this.draggedItem.name}" 移动到 "${item.dataset.name}" 中吗？`)) {
                    this.moveItem(this.draggedItem.path, path);
                }
            }
        });
    }

    getParentPath(path) {
        if (!path || path === '') return '';

        // 分割路径
        const parts = path.split('/').filter(p => p);

        // 移除最后一部分
        if (parts.length > 0) {
            parts.pop();
        }

        return parts.join('/');
    }

    // 添加拖拽事件到空白区域
    bindDragEventsForBlankArea() {
        const fileGrid = document.getElementById('fileGrid');
        if (!fileGrid) return;

        fileGrid.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 隐藏所有文件夹的拖拽效果
            document.querySelectorAll('.file-item:not(.parent)').forEach(el => {
                if (el.dataset.type === 'folder') {
                    el.classList.remove('drag-over');
                }
            });

            // 在空白区域添加视觉反馈
            fileGrid.classList.add('drag-over-blank');
        });

        fileGrid.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fileGrid.classList.remove('drag-over-blank');
        });

        fileGrid.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            fileGrid.classList.remove('drag-over-blank');

            if (!this.draggedItem || this.dropHandled) return;

            // 检查是否拖拽到了具体的文件项上
            const targetItem = e.target.closest('.file-item');
            if (targetItem) {
                return; // 由文件项的drop事件处理
            }

            this.dropHandled = true;

            // 拖拽到空白区域（移动到当前文件夹） - 不弹窗，直接移动
            this.moveItem(this.draggedItem.path, this.currentPath);
        });
    }

    openFolder(path) {
        // 清空选择状态
        this.clearSelection();
        this.updateUrlPath(path);
        this.loadFiles(path);
    }

    // 下载文件的方法
    downloadFile(filePath) {
        try {
            // filePath已经是编码后的字符串，直接使用
            window.open(`/download/${filePath}`, '_blank');
        } catch (error) {
            console.error('下载文件失败:', error);
            this.showToast('下载失败: ' + error.message, 'danger');
        }
    }

    // 下载文件夹的方法
    downloadFolder(folderPath) {
        try {
            // folderPath已经是编码后的字符串，直接使用
            window.open(`/download-folder/${folderPath}`, '_blank');
        } catch (error) {
            console.error('下载文件夹失败:', error);
            this.showToast('下载失败: ' + error.message, 'danger');
        }
    }

    async moveItem(sourcePath, targetDir) {
        try {
            // 确保targetDir是字符串，即使是undefined或null也转为空字符串
            targetDir = targetDir || '';

            const requestData = {
                source_path: sourcePath,
                target_dir: targetDir
            };

            const response = await fetch(`${this.apiBase}/files/move`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '移动失败');
            }

            const result = await response.json();
            this.showToast(result.message || '移动成功', 'success');

            // 刷新文件列表
            await this.loadFiles(this.currentPath);

        } catch (error) {
            this.showToast('移动失败: ' + error.message, 'danger');
        }
    }

    async renameItem(path) {
        try {
            const oldName = path.split('/').pop();
            const newName = prompt('请输入新名称:', oldName);
            if (!newName || newName.trim() === '' || newName === oldName) return;

            const response = await fetch(`${this.apiBase}/files/rename`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    old_path: path,
                    new_name: newName.trim()
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '重命名失败');
            }

            const result = await response.json();
            this.showToast(result.message || '重命名成功', 'success');

            // 刷新文件列表
            await this.loadFiles(this.currentPath);

        } catch (error) {
            this.showToast('重命名失败: ' + error.message, 'danger');
        }
    }

    async deleteItem(path, type) {
        try {
            const itemType = type === 'folder' ? '文件夹' : '文件';
            const confirmMsg = type === 'folder'
                ? `确定要删除文件夹 "${path.split('/').pop()}" 及其所有内容吗？此操作不可撤销。`
                : `确定要删除文件 "${path.split('/').pop()}" 吗？`;

            if (!confirm(confirmMsg)) return;

            const response = await fetch(`${this.apiBase}/files/delete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    filepath: path
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '删除失败');
            }

            const result = await response.json();
            this.showToast(result.message || '删除成功', 'success');

            // 刷新文件列表
            await this.loadFiles(this.currentPath);

        } catch (error) {
            this.showToast('删除失败: ' + error.message, 'danger');
        }
    }

    async createFolder() {
        try {
            const folderName = prompt('请输入文件夹名称:');
            if (!folderName || folderName.trim() === '') return;

            // 修复API调用参数
            const requestData = {
                path: this.currentPath || '',
                name: folderName.trim()
            };

            console.log('创建文件夹请求数据:', requestData);

            const response = await fetch(`${this.apiBase}/files/create-folder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '创建文件夹失败');
            }

            const result = await response.json();
            this.showToast(result.message || '文件夹创建成功', 'success');

            // 刷新文件列表
            await this.loadFiles(this.currentPath);

        } catch (error) {
            this.showToast('创建文件夹失败: ' + error.message, 'danger');
        }
    }

    searchFiles(query) {
        const fileItems = document.querySelectorAll('.file-item:not(.parent)');
        const lowerQuery = query.toLowerCase();

        let visibleCount = 0;

        fileItems.forEach(item => {
            const name = item.dataset.name.toLowerCase();

            if (name.includes(lowerQuery)) {
                item.style.display = '';
                visibleCount++;
            } else {
                item.style.display = 'none';
            }
        });
    }

    // 批量操作功能
    toggleFileSelection(filePath, isSelected) {
        if (isSelected) {
            this.selectedItems.add(filePath);
        } else {
            this.selectedItems.delete(filePath);
        }

        const fileItem = document.querySelector(`.file-item[data-path="${filePath}"]`);
        if (fileItem) {
            if (isSelected) {
                fileItem.classList.add('selected');
            } else {
                fileItem.classList.remove('selected');
            }
        }

        this.updateBatchToolbar();
    }

    toggleSelectAll(isSelected) {
        const checkboxes = document.querySelectorAll('.file-select-checkbox');
        const fileItems = document.querySelectorAll('.file-item:not(.parent)');

        if (isSelected) {
            // 选择所有
            checkboxes.forEach(checkbox => {
                const path = checkbox.dataset.path;
                if (path) {
                    checkbox.checked = true;
                    this.selectedItems.add(path);
                }
            });

            fileItems.forEach(item => {
                const path = item.dataset.path;
                if (path) {
                    this.selectedItems.add(path);
                    item.classList.add('selected');
                }
            });
        } else {
            // 取消所有选择
            this.selectedItems.clear();
            document.querySelectorAll('.file-item.selected').forEach(item => {
                item.classList.remove('selected');
            });

            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        }

        this.updateBatchToolbar();
    }

    clearSelection() {
        this.selectedItems.clear();
        document.querySelectorAll('.file-item.selected').forEach(item => {
            item.classList.remove('selected');
        });

        document.querySelectorAll('.file-select-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });

        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }

        this.updateBatchToolbar();
    }

    updateBatchToolbar() {
        const batchToolbar = document.getElementById('batchToolbar');
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');

        if (batchToolbar) {
            if (this.selectedItems.size > 0) {
                batchToolbar.style.display = 'flex';
                document.getElementById('selectedCount').textContent = `已选择 ${this.selectedItems.size} 个项目`;

                // 更新全选复选框状态
                const totalItems = document.querySelectorAll('.file-item:not(.parent)').length;
                if (selectAllCheckbox) {
                    selectAllCheckbox.checked = this.selectedItems.size === totalItems;
                    selectAllCheckbox.indeterminate = this.selectedItems.size > 0 && this.selectedItems.size < totalItems;
                }
            } else {
                batchToolbar.style.display = 'none';
                if (selectAllCheckbox) {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = false;
                }
            }
        }
    }

    async batchDownload() {
        if (this.selectedItems.size === 0) return;

        if (this.batchOperationInProgress) return;

        this.batchOperationInProgress = true;

        try {
            // 收集选中的文件信息
            const selectedFiles = [];
            const selectedFolders = [];

            Array.from(this.selectedItems).forEach(filePath => {
                const file = this.files.find(f => f.path === filePath);
                if (file) {
                    if (file.type === 'file') {
                        selectedFiles.push(file);
                    } else if (file.type === 'folder') {
                        selectedFolders.push(file);
                    }
                }
            });

            // 如果没有选中任何项目，直接返回
            if (selectedFiles.length === 0 && selectedFolders.length === 0) {
                this.showToast('请先选择要下载的文件或文件夹', 'warning');
                this.batchOperationInProgress = false;
                return;
            }

            // 逐个下载选中的文件（不创建压缩包）
            for (const file of selectedFiles) {
                // 使用延迟以避免浏览器阻止多个下载
                await new Promise(resolve => setTimeout(resolve, 300));
                this.downloadFile(encodeURIComponent(file.path));
            }

            // 逐个下载选中的文件夹（每个文件夹单独下载为ZIP）
            for (const folder of selectedFolders) {
                // 使用延迟以避免浏览器阻止多个下载
                await new Promise(resolve => setTimeout(resolve, 500));
                this.downloadFolder(encodeURIComponent(folder.path));
            }

            if (selectedFiles.length > 0 || selectedFolders.length > 0) {
                this.showToast(`开始下载 ${selectedFiles.length + selectedFolders.length} 个项目`, 'success');
            }

            // 清空选择
            this.clearSelection();

        } catch (error) {
            this.showToast('批量下载失败: ' + error.message, 'danger');
        } finally {
            this.batchOperationInProgress = false;
        }
    }

    async batchDelete() {
        if (this.selectedItems.size === 0) {
            this.showToast('请先选择要删除的项目', 'warning');
            return;
        }

        if (this.batchOperationInProgress) return;

        this.batchOperationInProgress = true;

        const confirmMsg = `确定要删除选中的 ${this.selectedItems.size} 个项目吗？此操作不可撤销。`;
        if (!confirm(confirmMsg)) {
            this.batchOperationInProgress = false;
            return;
        }

        try {
            let successCount = 0;
            let errorCount = 0;

            // 逐个删除选中的项目
            for (const filePath of this.selectedItems) {
                try {
                    const response = await fetch(`${this.apiBase}/files/delete`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({
                            filepath: filePath
                        })
                    });

                    if (response.ok) {
                        successCount++;
                    } else {
                        const errorData = await response.json();
                        console.error(`删除失败 ${filePath}:`, errorData.error);
                        errorCount++;
                    }

                    // 添加延迟以避免请求过于频繁
                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    console.error(`删除失败 ${filePath}:`, error);
                    errorCount++;
                }
            }

            // 显示结果
            let message = `已删除 ${successCount} 个项目`;
            if (errorCount > 0) {
                message += `，${errorCount} 个项目删除失败`;
                this.showToast(message, 'warning');
            } else {
                this.showToast(message, 'success');
            }

            // 刷新文件列表
            await this.loadFiles(this.currentPath);

            // 清空选择
            this.clearSelection();

        } catch (error) {
            this.showToast('批量删除失败: ' + error.message, 'danger');
        } finally {
            this.batchOperationInProgress = false;
        }
    }

    // 工具方法
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now - date;
            const diffHours = diffMs / (1000 * 60 * 60);

            if (diffHours < 24) {
                return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            } else {
                return date.toLocaleDateString('zh-CN');
            }
        } catch (e) {
            return '未知时间';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : 
                                 type === 'error' || type === 'danger' ? 'exclamation-circle' :
                                 type === 'warning' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
                ${this.escapeHtml(message)}
            </div>
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    addBatchOperationStyles() {
        if (!document.querySelector('#batch-styles')) {
            const style = document.createElement('style');
            style.id = 'batch-styles';
            style.textContent = `
                /* 批量操作工具栏 */
                .batch-toolbar {
                    position: fixed;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: var(--surface);
                    border: var(--glass-border);
                    border-radius: var(--radius-lg);
                    box-shadow: var(--shadow-xl);
                    backdrop-filter: var(--glass-blur);
                    padding: 0.75rem 1.25rem;
                    z-index: 999;
                    display: none;
                    align-items: center;
                    gap: 1rem;
                    animation: slideUp 0.3s ease;
                    width: auto;
                    max-width: 95%;
                    white-space: nowrap;
                }
                
                @keyframes slideUp {
                    from {
                        transform: translate(-50%, 20px);
                        opacity: 0;
                    }
                    to {
                        transform: translate(-50%, 0);
                        opacity: 1;
                    }
                }
                
                .batch-toolbar-info {
                    font-weight: 600;
                    color: var(--dark);
                    margin-right: 1rem;
                    font-size: 0.85rem;
                }
                
                .batch-toolbar-actions {
                    display: flex;
                    gap: 0.5rem;
                }
                
                .select-all-container {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    padding: 0.5rem 1rem;
                    background: var(--surface-secondary);
                    border-radius: var(--radius-sm);
                    border: 1px solid var(--border);
                    margin-right: auto;
                }
                
                .select-all-label {
                    font-weight: 500;
                    color: var(--dark);
                    font-size: 0.9rem;
                    cursor: pointer;
                    white-space: nowrap;
                }
                
                /* 文件复选框 */
                .file-checkbox {
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    z-index: 10;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                }
                
                .file-item:hover .file-checkbox,
                .file-item.selected .file-checkbox,
                .file-checkbox:hover {
                    opacity: 1;
                }
                
                .file-checkbox .form-check-input {
                    width: 20px;
                    height: 20px;
                    cursor: pointer;
                    background-color: var(--surface);
                    border: 2px solid var(--primary);
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                }
                
                .file-checkbox .form-check-input:checked {
                    background-color: var(--primary);
                    border-color: var(--primary);
                }
                
                .file-checkbox .form-check-input:focus {
                    box-shadow: 0 0 0 0.25rem rgba(164, 226, 198, 0.25);
                }
                
                .file-item.selected {
                    border-color: var(--primary);
                    background: rgba(164, 226, 198, 0.1);
                    box-shadow: 0 4px 12px rgba(164, 226, 198, 0.2);
                }
                
                /* 文件操作按钮行 */
                .file-actions-row {
                    display: flex;
                    gap: 0.5rem;
                    margin-bottom: 0.5rem;
                    justify-content: center;
                    flex-wrap: wrap;
                }
                
                .file-actions-row:last-child {
                    margin-bottom: 0;
                }
                
                .file-actions {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                }
            `;
            document.head.appendChild(style);
        }
    }
}

// 初始化文件管理器
window.fileManager = new FileManager();

// 添加批量操作工具栏到DOM
document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('batchToolbar')) {
        const batchToolbar = document.createElement('div');
        batchToolbar.id = 'batchToolbar';
        batchToolbar.className = 'batch-toolbar';
        batchToolbar.innerHTML = `
            <div class="select-all-container">
                <input type="checkbox" class="form-check-input" id="selectAllCheckbox">
                <label class="select-all-label" for="selectAllCheckbox">全选</label>
            </div>
            <div class="batch-toolbar-info" id="selectedCount"></div>
            <div class="batch-toolbar-actions">
                <button class="btn btn-outline-primary btn-sm" id="batchDownloadBtn">
                    <i class="fas fa-download me-1"></i><span class="batch-btn-text">下载选中</span>
                </button>
                <button class="btn btn-outline-danger btn-sm" id="batchDeleteBtn">
                    <i class="fas fa-trash me-1"></i><span class="batch-btn-text">删除选中</span>
                </button>
                <button class="btn btn-outline-secondary btn-sm" id="cancelSelectionBtn">
                    <i class="fas fa-times me-1"></i><span class="batch-btn-text">取消选择</span>
                </button>
            </div>
        `;
        document.body.appendChild(batchToolbar);

        // 绑定批量操作事件
        setTimeout(() => {
            if (window.fileManager && window.fileManager.bindBatchOperationEvents) {
                window.fileManager.bindBatchOperationEvents();
            }
        }, 100);
    }
});