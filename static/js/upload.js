// 文件上传功能 - 支持文件夹上传
class FileUploader {
    constructor() {
        this.apiBase = '/api';
        this.uploadQueue = [];
        this.activeUploads = new Map();
        this.isUploading = false;
        this.isPaused = false;
        this.chunkSize = 20 * 1024 * 1024; // 20MB

        // 添加文件夹上传支持
        this.folderMode = false;
        this.folderInput = null;

        // 当前上传路径
        this.currentPath = window.fileManager?.currentPath || '';

        // 弹窗实例
        this.modal = null;

        this.init();
    }

    init() {
        this.bindEvents();
        this.initModal();
        console.log('文件上传器已初始化');
    }

    initModal() {
        const modalElement = document.getElementById('uploadModal');
        if (modalElement) {
            this.modal = new bootstrap.Modal(modalElement);
        }
    }

    bindEvents() {
        // 上传按钮
        document.getElementById('uploadBtn')?.addEventListener('click', () => {
            this.openUploadModal();
        });

        document.getElementById('emptyUploadBtn')?.addEventListener('click', () => {
            this.openUploadModal();
        });

        // 文件选择按钮
        document.getElementById('selectFilesBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('fileInput').click();
        });

        // 文件夹选择按钮
        document.getElementById('selectFolderBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectFolder();
        });

        // 文件输入变化
        document.getElementById('fileInput')?.addEventListener('change', (e) => {
            this.folderMode = false;
            this.handleFileSelect(e.target.files);
            e.target.value = ''; // 重置input
        });

        // 拖拽上传
        this.setupDragAndDrop();

        // 上传控制按钮
        document.getElementById('pauseUploadBtn')?.addEventListener('click', () => this.togglePause());
        document.getElementById('cancelUploadBtn')?.addEventListener('click', () => this.cancelUpload());

        // 监听弹窗关闭事件
        const uploadModal = document.getElementById('uploadModal');
        if (uploadModal) {
            uploadModal.addEventListener('hidden.bs.modal', () => {
                this.resetUploadUI();
                this.clearQueue();
            });
        }
    }

    openUploadModal() {
        if (this.modal) {
            this.modal.show();
        }
    }

    closeUploadModal() {
        if (this.modal) {
            this.modal.hide();
        }
    }

    selectFolder() {
        this.folderMode = true;
        // 创建一个临时的文件夹选择input
        if (this.folderInput) {
            this.folderInput.remove();
        }

        this.folderInput = document.createElement('input');
        this.folderInput.type = 'file';
        this.folderInput.style.display = 'none';
        this.folderInput.webkitdirectory = true;
        this.folderInput.multiple = true;

        this.folderInput.addEventListener('change', (e) => {
            this.handleFolderSelect(e.target.files);
            e.target.remove(); // 使用后移除
            this.folderInput = null;
        });

        document.body.appendChild(this.folderInput);
        this.folderInput.click();
    }

    setupDragAndDrop() {
        const dropArea = document.getElementById('uploadArea');
        if (!dropArea) return;

        dropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropArea.style.borderColor = 'var(--primary)';
            dropArea.style.background = 'rgba(164, 226, 198, 0.1)';
        });

        dropArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropArea.style.borderColor = 'var(--border)';
            dropArea.style.background = '';
        });

        dropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropArea.style.borderColor = 'var(--border)';
            dropArea.style.background = '';

            if (e.dataTransfer.files.length) {
                // 检查是否包含文件夹
                const items = e.dataTransfer.items;
                let hasFolder = false;

                for (let i = 0; i < items.length; i++) {
                    if (items[i].webkitGetAsEntry && items[i].webkitGetAsEntry().isDirectory) {
                        hasFolder = true;
                        break;
                    }
                }

                if (hasFolder) {
                    this.handleFolderDrop(e.dataTransfer.items);
                } else {
                    this.handleFileSelect(e.dataTransfer.files);
                }
            }
        });
    }

    async handleFolderDrop(items) {
        try {
            const files = [];
            const folderStructure = new Set();

            // 递归获取所有文件和文件夹结构
            const processEntries = async (entries, path = '') => {
                for (const entry of entries) {
                    if (entry.isFile) {
                        const file = await new Promise((resolve) => entry.file(resolve));
                        // 保持相对路径
                        file.relativePath = path + file.name;
                        files.push(file);
                    } else if (entry.isDirectory) {
                        // 记录文件夹结构
                        const folderPath = path + entry.name + '/';
                        folderStructure.add(folderPath);

                        const dirReader = entry.createReader();
                        const dirEntries = await new Promise((resolve) => dirReader.readEntries(resolve));
                        await processEntries(dirEntries, folderPath);
                    }
                }
            };

            // 转换DataTransferItemList为数组
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].webkitGetAsEntry) {
                    entries.push(items[i].webkitGetAsEntry());
                }
            }

            await processEntries(entries);

            // 先创建文件夹结构
            for (const folderPath of folderStructure) {
                await this.createFolderIfNotExists(folderPath);
            }

            if (files.length > 0) {
                this.processFilesWithPaths(files);
            }
        } catch (error) {
            this.showToast('处理文件夹失败: ' + error.message, 'danger');
        }
    }

    async createFolderIfNotExists(folderPath) {
        try {
            // 移除末尾的斜杠
            let cleanPath = folderPath;
            if (cleanPath.endsWith('/')) {
                cleanPath = cleanPath.slice(0, -1);
            }

            // 分割路径
            const parts = cleanPath.split('/');
            let currentPath = this.currentPath || '';

            for (let i = 0; i < parts.length; i++) {
                const folderName = parts[i];
                if (!folderName) continue;

                const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;

                try {
                    // 修复API调用参数
                    const requestData = {
                        path: currentPath || '',
                        name: folderName
                    };

                    const response = await fetch(`${this.apiBase}/files/create-folder`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify(requestData)
                    });

                    if (response.ok) {
                        const result = await response.json();
                        console.log(`文件夹已创建: ${newPath}`);
                    } else if (response.status === 400) {
                        // 文件夹可能已存在，忽略这个错误
                        const errorData = await response.json();
                        if (!errorData.error || !errorData.error.includes('已存在')) {
                            console.warn(`创建文件夹失败: ${errorData.error || '未知错误'}`);
                        }
                    } else {
                        const errorData = await response.json();
                        console.error(`创建文件夹失败: ${errorData.error || '未知错误'}`);
                    }
                } catch (error) {
                    console.error(`创建文件夹错误: ${error.message}`);
                }

                currentPath = newPath;
            }
        } catch (error) {
            console.error(`创建文件夹结构失败: ${error.message}`);
        }
    }

    async handleFolderSelect(fileList) {
        try {
            const files = Array.from(fileList);
            const folderStructure = new Set();

            // 收集文件夹结构
            files.forEach(file => {
                let relativePath = file.webkitRelativePath;
                if (!relativePath) {
                    relativePath = file.name;
                }

                // 提取文件夹路径
                if (relativePath.includes('/')) {
                    const parts = relativePath.split('/');
                    let folderPath = '';

                    // 跳过文件名部分（最后一部分）
                    for (let i = 0; i < parts.length - 1; i++) {
                        folderPath += parts[i] + '/';
                        folderStructure.add(folderPath);
                    }
                }
            });

            // 先创建文件夹结构
            for (const folderPath of folderStructure) {
                await this.createFolderIfNotExists(folderPath);
            }

            // 处理文件
            const filesWithPaths = files.map(file => {
                let relativePath = file.webkitRelativePath;
                if (!relativePath) {
                    relativePath = file.name;
                }

                // 移除开头的目录部分（只保留相对于上传根目录的部分）
                if (relativePath.includes('/')) {
                    const parts = relativePath.split('/');
                    relativePath = parts.slice(1).join('/'); // 移除第一个目录
                }

                return {
                    file: file,
                    relativePath: relativePath
                };
            });

            this.processFilesWithPaths(filesWithPaths);
        } catch (error) {
            this.showToast('处理文件夹失败: ' + error.message, 'danger');
        }
    }

    async handleFileSelect(fileList) {
        try {
            const files = Array.from(fileList);

            for (let file of files) {
                await this.addToQueue(file, file.name);
            }

            // 显示上传队列
            document.getElementById('uploadQueue').style.display = 'block';

            // 自动开始上传
            setTimeout(() => this.startUpload(), 100);
        } catch (error) {
            this.showToast('处理文件失败: ' + error.message, 'danger');
        }
    }

    processFilesWithPaths(filesWithPaths) {
        // 按目录分组，显示上传统计
        const folderStats = {};
        let fileCount = 0;

        filesWithPaths.forEach(item => {
            const file = item.file || item;
            const relativePath = item.relativePath || file.name;
            const dir = relativePath.includes('/') ? relativePath.split('/')[0] : '根目录';

            if (!folderStats[dir]) {
                folderStats[dir] = { count: 0, size: 0 };
            }
            folderStats[dir].count++;
            folderStats[dir].size += file.size;
            fileCount++;
        });

        if (fileCount > 0) {
            filesWithPaths.forEach(async item => {
                const file = item.file || item;
                const relativePath = item.relativePath || file.name;
                await this.addToQueue(file, relativePath);
            });

            document.getElementById('uploadQueue').style.display = 'block';
            setTimeout(() => this.startUpload(), 100);
        }
    }

    async addToQueue(file, relativePath) {
        try {
            // 生成文件标识（包含路径信息）
            const fileId = this.generateFileId(file, relativePath);

            // 检查文件是否已存在
            const checkResult = await this.checkFileExists(fileId, relativePath);

            if (checkResult.exists && !checkResult.is_folder) {
                this.showToast('文件已存在: ' + relativePath, 'warning');
                return;
            }

            // 计算分片
            const chunkSize = file.size > 500 * 1024 * 1024 ? 50 * 1024 * 1024 : this.chunkSize;
            const totalChunks = Math.ceil(file.size / chunkSize);

            const fileInfo = {
                id: fileId,
                file: file,
                name: file.name,
                path: relativePath,
                fullPath: this.currentPath ? `${this.currentPath}/${relativePath}` : relativePath,
                size: file.size,
                chunkSize: chunkSize,
                totalChunks: totalChunks,
                uploadedChunks: checkResult.uploaded_chunks || [],
                status: 'pending',
                progress: 0,
                startTime: null,
                element: null
            };

            // 如果是可续传的文件
            if (checkResult.uploaded_chunks && checkResult.uploaded_chunks.length > 0) {
                const uploadedCount = checkResult.uploaded_chunks.length;
                fileInfo.progress = (uploadedCount / totalChunks) * 100;
            }

            this.uploadQueue.push(fileInfo);
            this.updateQueueUI();
            this.showToast(`已添加: ${relativePath}`, 'success');

        } catch (error) {
            this.showToast('添加文件失败: ' + error.message, 'danger');
        }
    }

    async checkFileExists(fileId, filepath) {
        try {
            const response = await fetch(`${this.apiBase}/check`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    hash: fileId,
                    filepath: filepath,
                    filename: filepath.split('/').pop(),
                    target_path: this.currentPath
                })
            });

            if (!response.ok) {
                throw new Error(`检查失败: ${response.status} ${response.statusText}`);
            }

            return await response.json();

        } catch (error) {
            this.showToast('检查文件失败: ' + error.message, 'warning');
            return { exists: false, uploaded_chunks: [] };
        }
    }

    generateFileId(file, relativePath) {
        // 使用文件路径+大小+最后修改时间生成标识
        const identifier = `${this.currentPath}/${relativePath}_${file.size}_${file.lastModified}_${Date.now()}`;
        let hash = 0;
        for (let i = 0; i < identifier.length; i++) {
            hash = ((hash << 5) - hash) + identifier.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    updateQueueUI() {
        const container = document.getElementById('queueList');
        if (!container) return;

        if (this.uploadQueue.length === 0) {
            container.innerHTML = '';
            return;
        }

        let html = '';
        this.uploadQueue.forEach((fileInfo) => {
            const progressPercent = fileInfo.progress.toFixed(1);
            const fileSize = this.formatSize(fileInfo.size);
            const displayPath = fileInfo.path || fileInfo.name;

            html += `
                <div class="queue-item" data-file-id="${fileInfo.id}">
                    <div class="queue-info">
                        <div class="queue-filename" title="${this.escapeHtml(displayPath)}">
                            <i class="fas ${displayPath.includes('/') ? 'fa-folder' : 'fa-file'} me-1"></i> ${this.escapeHtml(displayPath)}
                        </div>
                        <div class="queue-details">
                            ${fileSize} • ${fileInfo.uploadedChunks.length}/${fileInfo.totalChunks}分片
                        </div>
                        <div class="queue-progress">
                            <div class="progress">
                                <div class="progress-bar" style="width: ${progressPercent}%"></div>
                            </div>
                        </div>
                    </div>
                    <div class="queue-actions">
                        <button class="btn btn-sm btn-outline-danger" 
                                onclick="window.uploader.removeFromQueue('${fileInfo.id}')">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    removeFromQueue(fileId) {
        const index = this.uploadQueue.findIndex(f => f.id === fileId);
        if (index !== -1) {
            // 如果正在上传，取消上传
            if (this.activeUploads.has(fileId)) {
                this.cancelFileUpload(fileId);
            }

            this.uploadQueue.splice(index, 1);
            this.updateQueueUI();

            if (this.uploadQueue.length === 0) {
                const uploadQueue = document.getElementById('uploadQueue');
                if (uploadQueue) uploadQueue.style.display = 'none';
            }
        }
    }

    clearQueue() {
        // 取消所有上传
        this.uploadQueue.forEach(fileInfo => {
            if (this.activeUploads.has(fileInfo.id)) {
                this.cancelFileUpload(fileInfo.id);
            }
        });

        // 清空队列
        this.uploadQueue = [];
        this.updateQueueUI();

        // 隐藏上传队列
        const uploadQueue = document.getElementById('uploadQueue');
        if (uploadQueue) uploadQueue.style.display = 'none';

        // 重置上传状态
        this.isUploading = false;
        this.isPaused = false;
        this.resetUploadUI();
    }

    async startUpload() {
        if (this.isUploading || this.uploadQueue.length === 0) return;

        this.isUploading = true;
        this.isPaused = false;

        const pauseBtn = document.getElementById('pauseUploadBtn');
        const cancelBtn = document.getElementById('cancelUploadBtn');
        if (pauseBtn) pauseBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;

        // 上传每个文件
        for (let fileInfo of this.uploadQueue.filter(f => f.status === 'pending')) {
            if (this.isPaused) break;

            try {
                await this.uploadFile(fileInfo);
            } catch (error) {
                fileInfo.status = 'error';
                this.showToast(`上传失败: ${fileInfo.name}`, 'danger');
            }
        }

        this.finishUpload();
    }

    async uploadFile(fileInfo) {
        fileInfo.status = 'uploading';
        fileInfo.startTime = Date.now();
        this.activeUploads.set(fileInfo.id, fileInfo);

        const uploadedChunks = new Set(fileInfo.uploadedChunks.map(c => parseInt(c.split('_')[1])));

        // 上传分片
        for (let i = 0; i < fileInfo.totalChunks; i++) {
            if (this.isPaused) {
                fileInfo.status = 'paused';
                throw new Error('上传已暂停');
            }

            if (uploadedChunks.has(i)) {
                continue;
            }

            await this.uploadChunk(fileInfo, i);

            // 更新进度
            fileInfo.progress = ((i + 1) / fileInfo.totalChunks) * 100;
            this.updateFileProgress(fileInfo);
        }

        // 合并分片
        await this.mergeChunks(fileInfo);

        fileInfo.status = 'completed';
        this.showToast(`上传完成: ${fileInfo.path}`, 'success');

        // 从队列移除
        this.removeFromQueue(fileInfo.id);

        // 刷新文件列表
        if (window.fileManager) {
            window.fileManager.loadFiles(this.currentPath);
        }
    }

    async uploadChunk(fileInfo, chunkIndex) {
        const chunkStart = chunkIndex * fileInfo.chunkSize;
        const chunkEnd = Math.min(chunkStart + fileInfo.chunkSize, fileInfo.size);
        const chunk = fileInfo.file.slice(chunkStart, chunkEnd);

        const formData = new FormData();
        formData.append('hash', fileInfo.id);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', fileInfo.totalChunks);
        formData.append('filename', fileInfo.name);
        formData.append('filepath', fileInfo.path);
        formData.append('target_path', this.currentPath);
        formData.append('chunk', chunk);

        try {
            const response = await fetch(`${this.apiBase}/upload/chunk`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `上传分片失败: ${response.status}`);
            }

            return await response.json();

        } catch (error) {
            throw error;
        }
    }

    async mergeChunks(fileInfo) {
        try {
            const response = await fetch(`${this.apiBase}/upload/merge`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    hash: fileInfo.id,
                    filename: fileInfo.name,
                    filepath: fileInfo.path,
                    target_path: this.currentPath,
                    totalChunks: fileInfo.totalChunks
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error('合并失败: ' + errorText);
            }

            return await response.json();

        } catch (error) {
            throw error;
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById('pauseUploadBtn');

        if (!pauseBtn) return;

        if (this.isPaused) {
            pauseBtn.innerHTML = '<i class="fas fa-play me-1"></i>继续';
            pauseBtn.classList.remove('btn-outline-warning');
            pauseBtn.classList.add('btn-outline-success');
            this.showToast('上传已暂停', 'warning');
        } else {
            pauseBtn.innerHTML = '<i class="fas fa-pause me-1"></i>暂停';
            pauseBtn.classList.remove('btn-outline-success');
            pauseBtn.classList.add('btn-outline-warning');
            this.showToast('上传继续', 'info');
            this.startUpload();
        }
    }

    async cancelUpload() {
        if (!confirm('确定要取消所有上传吗？')) return;

        this.isUploading = false;
        this.isPaused = false;

        // 取消所有活跃的上传
        for (const fileInfo of this.uploadQueue.filter(f => f.status === 'uploading')) {
            await this.cancelFileUpload(fileInfo.id);
        }

        this.uploadQueue = this.uploadQueue.filter(f => f.status === 'pending');

        this.resetUploadUI();
        this.showToast('上传已取消', 'info');
    }

    async cancelFileUpload(fileId) {
        try {
            const response = await fetch(`${this.apiBase}/upload/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ hash: fileId })
            });

            if (!response.ok) {
                throw new Error('取消上传失败');
            }
        } catch (error) {
            // 忽略取消失败的错误
        }
    }

    finishUpload() {
        this.isUploading = false;
        this.resetUploadUI();

        if (this.uploadQueue.length === 0) {
            const uploadQueue = document.getElementById('uploadQueue');
            if (uploadQueue) uploadQueue.style.display = 'none';
            this.showToast('所有文件上传完成', 'success');

            // 所有上传完成后自动关闭弹窗（延迟2秒）
            setTimeout(() => {
                if (this.uploadQueue.length === 0) {
                    this.closeUploadModal();
                }
            }, 2000);
        }
    }

    resetUploadUI() {
        const pauseBtn = document.getElementById('pauseUploadBtn');
        const cancelBtn = document.getElementById('cancelUploadBtn');

        if (pauseBtn) pauseBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;

        if (pauseBtn) {
            pauseBtn.innerHTML = '<i class="fas fa-pause me-1"></i>暂停';
            pauseBtn.classList.remove('btn-outline-success');
            pauseBtn.classList.add('btn-outline-warning');
        }
    }

    updateFileProgress(fileInfo) {
        const item = document.querySelector(`.queue-item[data-file-id="${fileInfo.id}"]`);
        if (!item) return;

        const progressBar = item.querySelector('.progress-bar');
        if (progressBar) {
            progressBar.style.width = `${fileInfo.progress}%`;
        }
    }

    // 更新当前路径
    updateCurrentPath(path) {
        this.currentPath = path || '';
    }

    // 工具方法
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'info') {
        // 使用fileManager的toast系统
        if (window.fileManager && typeof window.fileManager.showToast === 'function') {
            window.fileManager.showToast(message, type);
        } else {
            // 简单toast实现
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

            // 3秒后移除
            setTimeout(() => {
                toast.style.animation = 'slideOut 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }
}

// 初始化上传器
window.uploader = new FileUploader();