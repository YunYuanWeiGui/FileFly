import os
import time
import shutil
import hashlib
import zipfile
import json
from pathlib import Path
from io import BytesIO
from flask import Flask, request, jsonify, send_from_directory, render_template, send_file
from werkzeug.utils import secure_filename
from datetime import datetime

app = Flask(__name__)

# 配置
CHUNK_SIZE = 20 * 1024 * 1024  # 20MB分片
MAX_FILE_SIZE = 50 * 1024 * 1024 * 1024  # 50GB
UPLOAD_FOLDER = 'uploads'
CHUNK_FOLDER = 'chunks'

# 确保目录存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CHUNK_FOLDER, exist_ok=True)

app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER


# 辅助函数：安全地处理相对路径
def safe_relative_path(rel_path):
    """将相对路径转换为安全的绝对路径，防止目录遍历攻击"""
    if not rel_path or rel_path == '.' or rel_path == '':
        return UPLOAD_FOLDER

    # 确保路径是字符串
    rel_path = str(rel_path)

    # 规范化路径，移除..等
    try:
        path = os.path.normpath(rel_path)
        # 确保路径在UPLOAD_FOLDER内
        full_path = os.path.join(UPLOAD_FOLDER, path)
        full_path = os.path.normpath(full_path)

        # 检查是否仍在UPLOAD_FOLDER内
        upload_folder_abs = os.path.abspath(UPLOAD_FOLDER)
        full_path_abs = os.path.abspath(full_path)

        if not full_path_abs.startswith(upload_folder_abs):
            return None

        return full_path
    except Exception:
        return None


# 辅助函数：获取指定路径的目录树
def get_directory_tree(base_path, target_path=None):
    """获取指定路径的目录树结构"""
    if target_path:
        full_path = safe_relative_path(target_path)
        if not full_path or not os.path.isdir(full_path):
            return []
        current_path = full_path
    else:
        current_path = base_path

    tree = []

    try:
        # 获取当前路径信息
        rel_current = os.path.relpath(current_path, base_path)
        if rel_current == '.':
            rel_current = ''

        for item in os.listdir(current_path):
            item_path = os.path.join(current_path, item)
            rel_path = os.path.relpath(item_path, base_path)

            if os.path.isfile(item_path):
                stat = os.stat(item_path)
                tree.append({
                    'name': item,
                    'path': rel_path.replace('\\', '/'),  # 统一使用正斜杠
                    'type': 'file',
                    'size': stat.st_size,
                    'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    'url': f'/download/{rel_path.replace("\\", "/")}'
                })
            elif os.path.isdir(item_path):
                # 统计子文件夹中的文件数量
                file_count = sum([len(files) for _, _, files in os.walk(item_path)])
                tree.append({
                    'name': item,
                    'path': rel_path.replace('\\', '/'),
                    'type': 'folder',
                    'size': 0,
                    'file_count': file_count,
                    'modified': datetime.fromtimestamp(os.path.getmtime(item_path)).isoformat(),
                    'url': f'/browse/{rel_path.replace("\\", "/")}'
                })
    except Exception as e:
        print(f"Error reading directory {current_path}: {e}")

    # 按类型排序：文件夹在前，文件在后
    tree.sort(key=lambda x: (0 if x['type'] == 'folder' else 1, x['name'].lower()))

    return tree


# 辅助函数：获取面包屑导航
def get_breadcrumbs(path):
    """获取面包屑导航路径"""
    if not path or path == '.' or path == '':
        return [{'name': '根目录', 'path': ''}]

    crumbs = [{'name': '根目录', 'path': ''}]
    parts = path.replace('\\', '/').split('/')

    current_path = ''
    for i, part in enumerate(parts):
        if part:
            current_path = current_path + '/' + part if current_path else part
            crumbs.append({
                'name': part,
                'path': current_path
            })

    return crumbs


# 主页面路由 - 文件浏览器
@app.route('/')
@app.route('/browse/')
@app.route('/browse/<path:folder_path>')
def browse(folder_path=''):
    # 获取安全的文件夹路径
    safe_path = safe_relative_path(folder_path)

    if folder_path and (not safe_path or not os.path.isdir(safe_path)):
        # 如果路径不存在，重定向到根目录
        return render_template('index.html',
                               current_path='',
                               breadcrumbs=get_breadcrumbs(''),
                               files=[])

    # 获取当前路径的文件列表
    files = get_directory_tree(UPLOAD_FOLDER, folder_path)

    return render_template('index.html',
                           current_path=folder_path,
                           breadcrumbs=get_breadcrumbs(folder_path),
                           files=files)


# 上传检查API
@app.route('/api/check', methods=['POST'])
def check_file():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的JSON数据'}), 400

        file_hash = data.get('hash')
        filepath = data.get('filepath')
        filename = data.get('filename')
        target_path = data.get('target_path', '')

        if not file_hash:
            return jsonify({'error': '缺少文件标识'}), 400

        # 构建完整路径
        if target_path and filepath:
            # 如果指定了目标路径，将文件上传到该路径下
            full_path = f"{target_path}/{filepath}" if target_path else filepath
        elif filepath:
            full_path = filepath
        elif filename:
            full_path = filename
        else:
            return jsonify({'error': '缺少文件路径或文件名'}), 400

        # 获取安全的绝对路径
        safe_path = safe_relative_path(full_path)

        if not safe_path:
            return jsonify({'error': '无效的文件路径'}), 400

        # 检查是否已完整上传
        if os.path.exists(safe_path):
            if os.path.isfile(safe_path):
                file_size = os.path.getsize(safe_path)
                return jsonify({'exists': True, 'size': file_size})
            else:
                return jsonify({'exists': True, 'is_folder': True})

        # 检查是否有分片存在
        chunk_dir = os.path.join(CHUNK_FOLDER, file_hash)
        if os.path.exists(chunk_dir):
            chunks = [f for f in os.listdir(chunk_dir) if f.startswith('chunk_')]
            uploaded_chunks = sorted(chunks, key=lambda x: int(x.split('_')[1]))
            return jsonify({
                'exists': False,
                'uploaded_chunks': uploaded_chunks,
                'chunk_count': len(chunks)
            })

        return jsonify({'exists': False, 'uploaded_chunks': []})

    except Exception as e:
        print(f"文件检查错误: {str(e)}")
        return jsonify({'error': str(e)}), 500


# 上传分片API
@app.route('/api/upload/chunk', methods=['POST'])
def upload_chunk():
    try:
        file_hash = request.form.get('hash')
        chunk_index = request.form.get('chunkIndex')
        total_chunks = request.form.get('totalChunks')
        filepath = request.form.get('filepath')
        target_path = request.form.get('target_path', '')

        if not file_hash:
            return jsonify({'error': '缺少文件标识'}), 400

        if not chunk_index or not total_chunks:
            return jsonify({'error': '缺少分片信息'}), 400

        chunk_index = int(chunk_index)
        total_chunks = int(total_chunks)

        file = request.files.get('chunk')
        if not file:
            return jsonify({'error': '未找到文件分片'}), 400

        # 构建完整文件路径
        if target_path and filepath:
            full_path = f"{target_path}/{filepath}" if target_path else filepath
        else:
            full_path = filepath or file.filename

        # 创建chunk目录
        chunk_dir = os.path.join(CHUNK_FOLDER, file_hash)

        # 如果提供了完整路径，在chunk目录中创建相应结构
        if full_path and '/' in full_path:
            # 从完整路径中提取目录部分
            dir_name = os.path.dirname(full_path)
            if dir_name:
                chunk_dir = os.path.join(chunk_dir, dir_name)

        os.makedirs(chunk_dir, exist_ok=True)

        chunk_filename = f'chunk_{chunk_index}'
        chunk_path = os.path.join(chunk_dir, chunk_filename)

        file.save(chunk_path)

        return jsonify({
            'success': True,
            'chunk': chunk_index,
            'message': f'分片 {chunk_index + 1}/{total_chunks} 上传成功'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# 合并分片API
@app.route('/api/upload/merge', methods=['POST'])
def merge_chunks():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的JSON数据'}), 400

        file_hash = data.get('hash')
        filepath = data.get('filepath')
        filename = data.get('filename')
        target_path = data.get('target_path', '')

        if not file_hash:
            return jsonify({'error': '缺少文件标识'}), 400

        # 构建完整路径
        if target_path and filepath:
            full_path = f"{target_path}/{filepath}" if target_path else filepath
        elif filepath:
            full_path = filepath
        elif filename:
            full_path = filename
        else:
            return jsonify({'error': '缺少文件路径或文件名'}), 400

        # 获取安全的输出路径
        safe_filepath = safe_relative_path(full_path)
        if not safe_filepath:
            return jsonify({'error': '无效的文件路径'}), 400

        # 确保目标目录存在 - 递归创建所有需要的目录
        target_dir = os.path.dirname(safe_filepath)
        if target_dir and not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)
            print(f"已创建目录: {target_dir}")

        # 确定chunk目录位置
        if full_path and '/' in full_path:
            # 从完整路径中提取目录部分
            dir_name = os.path.dirname(full_path)
            if dir_name:
                chunk_dir = os.path.join(CHUNK_FOLDER, file_hash, dir_name)
            else:
                chunk_dir = os.path.join(CHUNK_FOLDER, file_hash)
        else:
            chunk_dir = os.path.join(CHUNK_FOLDER, file_hash)

        # 统计分片数量
        if not os.path.exists(chunk_dir):
            return jsonify({'error': '分片目录不存在'}), 400

        # 查找所有分片文件
        chunk_files = []
        for root, dirs, files in os.walk(chunk_dir):
            for file in files:
                if file.startswith('chunk_'):
                    chunk_files.append(os.path.join(root, file))

        if not chunk_files:
            return jsonify({'error': '未找到分片文件'}), 400

        # 按分片索引排序
        chunk_files.sort(key=lambda x: int(os.path.basename(x).split('_')[1]))
        total_chunks = len(chunk_files)

        # 合并分片
        print(f"开始合并文件: {safe_filepath}, 分片数: {total_chunks}")
        with open(safe_filepath, 'wb') as output_file:
            for chunk_path in chunk_files:
                with open(chunk_path, 'rb') as chunk_file:
                    output_file.write(chunk_file.read())

        # 清理chunks目录
        shutil.rmtree(os.path.join(CHUNK_FOLDER, file_hash), ignore_errors=True)

        file_size = os.path.getsize(safe_filepath)
        print(f"文件合并成功: {full_path}, 大小: {file_size} bytes")

        return jsonify({
            'success': True,
            'filename': os.path.basename(full_path),
            'filepath': full_path,
            'size': file_size,
            'message': '文件合并成功'
        })

    except Exception as e:
        print(f"合并分片错误: {str(e)}")
        return jsonify({'error': str(e)}), 500


# 获取文件列表API（支持路径参数）
@app.route('/api/files', methods=['GET'])
def get_files():
    try:
        # 获取路径参数
        path = request.args.get('path', '')

        # 获取指定路径的文件列表
        files = get_directory_tree(UPLOAD_FOLDER, path)

        return jsonify({
            'success': True,
            'path': path,
            'files': files,
            'breadcrumbs': get_breadcrumbs(path)
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# 删除文件/文件夹API
@app.route('/api/files/delete', methods=['POST'])
def delete_file():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的JSON数据'}), 400

        filepath = data.get('filepath')

        if not filepath:
            return jsonify({'error': '缺少文件路径'}), 400

        # 获取安全的绝对路径
        safe_path = safe_relative_path(filepath)

        if not safe_path:
            return jsonify({'error': '无效的文件路径'}), 400

        if not os.path.exists(safe_path):
            return jsonify({'error': '文件或文件夹不存在'}), 404

        # 删除文件或文件夹
        if os.path.isfile(safe_path):
            os.remove(safe_path)
            message = '文件已删除'
        else:
            shutil.rmtree(safe_path)
            message = '文件夹已删除'

        return jsonify({'success': True, 'message': message})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# 取消上传API
@app.route('/api/upload/cancel', methods=['POST'])
def cancel_upload():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的JSON数据'}), 400

        file_hash = data.get('hash')

        if not file_hash:
            return jsonify({'error': '缺少文件标识'}), 400

        chunk_dir = os.path.join(CHUNK_FOLDER, file_hash)
        if os.path.exists(chunk_dir):
            shutil.rmtree(chunk_dir, ignore_errors=True)

        return jsonify({'success': True, 'message': '上传已取消'})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# 重命名文件/文件夹API
@app.route('/api/files/rename', methods=['POST'])
def rename_file():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的JSON数据'}), 400

        old_path = data.get('old_path')
        new_name = data.get('new_name')

        if not all([old_path, new_name]):
            return jsonify({'error': '参数不完整'}), 400

        # 安全检查新文件名
        safe_new_name = secure_filename(new_name)
        if not safe_new_name or safe_new_name != new_name:
            return jsonify({'error': '无效的新文件名'}), 400

        # 获取安全的旧路径
        old_safe_path = safe_relative_path(old_path)

        if not old_safe_path:
            return jsonify({'error': '无效的旧文件路径'}), 400

        if not os.path.exists(old_safe_path):
            return jsonify({'error': '文件或文件夹不存在'}), 404

        # 构建新路径
        dir_path = os.path.dirname(old_safe_path)
        new_safe_path = os.path.join(dir_path, safe_new_name)

        # 检查新路径是否已存在
        if os.path.exists(new_safe_path):
            return jsonify({'error': '目标名称已存在'}), 400

        # 重命名
        os.rename(old_safe_path, new_safe_path)

        # 返回新相对路径
        new_rel_path = os.path.relpath(new_safe_path, UPLOAD_FOLDER)

        return jsonify({
            'success': True,
            'message': '重命名成功',
            'new_path': new_rel_path.replace('\\', '/')
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# 移动文件/文件夹API
@app.route('/api/files/move', methods=['POST'])
def move_file():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的JSON数据'}), 400

        source_path = data.get('source_path')
        target_dir = data.get('target_dir')

        # 修复：确保target_dir总是字符串，即使是None也转为空字符串
        if target_dir is None:
            target_dir = ''

        if not source_path:
            return jsonify({'error': '参数不完整：缺少source_path'}), 400

        # 获取安全的源路径
        source_safe_path = safe_relative_path(source_path)

        if not source_safe_path:
            return jsonify({'error': '无效的源文件路径'}), 400

        # 获取安全的目标目录
        target_safe_dir = safe_relative_path(target_dir)

        if target_safe_dir is None:
            return jsonify({'error': '无效的目标目录'}), 400

        # 确保源路径存在
        if not os.path.exists(source_safe_path):
            return jsonify({'error': '源文件或文件夹不存在'}), 404

        # 确保目标目录存在，如果不存在则创建
        if target_safe_dir and not os.path.exists(target_safe_dir):
            os.makedirs(target_safe_dir, exist_ok=True)
        elif target_safe_dir and not os.path.isdir(target_safe_dir):
            return jsonify({'error': '目标路径不是目录'}), 400

        # 构建目标路径
        filename = os.path.basename(source_safe_path)
        target_safe_path = os.path.join(target_safe_dir, filename) if target_safe_dir else os.path.join(UPLOAD_FOLDER,
                                                                                                        filename)

        # 检查目标路径是否已存在
        if os.path.exists(target_safe_path):
            return jsonify({'error': '目标位置已存在同名文件或文件夹'}), 400

        # 修复：正确的路径检查逻辑
        # 1. 检查是否是移动到自身（源路径和目标路径相同）
        if source_safe_path == target_safe_path:
            return jsonify({'error': '不能移动到自身'}), 400

        # 2. 检查是否是文件夹移动到自己的子文件夹中
        # 只有当源路径是文件夹且目标路径是源路径的子目录时才不允许
        if os.path.isdir(source_safe_path):
            # 规范化路径进行比较
            source_norm = os.path.normpath(source_safe_path)
            target_norm = os.path.normpath(target_safe_dir) if target_safe_dir else os.path.normpath(UPLOAD_FOLDER)

            # 检查目标路径是否是源路径的子目录
            try:
                # 计算相对路径，如果是子目录，相对路径不会以..开头
                rel_path = os.path.relpath(target_norm, source_norm)
                # 如果相对路径不是以..开头，并且不等于.，则说明目标路径是源路径的子目录
                if not rel_path.startswith('..') and rel_path != '.':
                    return jsonify({'error': '不能将文件夹移动到自己的子文件夹中'}), 400
            except ValueError:
                # 如果无法计算相对路径（如在不同的驱动器上），则忽略此检查
                pass

        # 移动
        shutil.move(source_safe_path, target_safe_path)

        # 返回新相对路径
        new_rel_path = os.path.relpath(target_safe_path, UPLOAD_FOLDER)
        if new_rel_path == '.':
            new_rel_path = ''

        return jsonify({
            'success': True,
            'message': '移动成功',
            'new_path': new_rel_path.replace('\\', '/')
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# 创建文件夹API
@app.route('/api/files/create-folder', methods=['POST'])
def create_folder():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的JSON数据'}), 400

        folder_path = data.get('path', '')
        folder_name = data.get('name')

        # 调试日志
        print(f"创建文件夹请求 - path: {folder_path}, name: {folder_name}")

        if not folder_name:
            return jsonify({'error': '缺少文件夹名称'}), 400

        # 安全检查文件夹名
        safe_folder_name = secure_filename(folder_name)
        if not safe_folder_name or safe_folder_name != folder_name:
            return jsonify({'error': '无效的文件夹名'}), 400

        # 获取安全的父目录路径
        parent_safe_path = safe_relative_path(folder_path)

        if not parent_safe_path:
            parent_safe_path = UPLOAD_FOLDER

        # 构建完整路径
        full_path = os.path.join(parent_safe_path, safe_folder_name)

        # 检查是否已存在
        if os.path.exists(full_path):
            return jsonify({'error': '文件夹已存在'}), 400

        # 创建文件夹
        os.makedirs(full_path, exist_ok=True)

        # 返回相对路径
        rel_path = os.path.relpath(full_path, UPLOAD_FOLDER)

        return jsonify({
            'success': True,
            'message': '文件夹创建成功',
            'path': rel_path.replace('\\', '/')
        })

    except Exception as e:
        print(f"创建文件夹错误: {str(e)}")
        return jsonify({'error': str(e)}), 500


# 批量下载API
@app.route('/api/files/batch-download', methods=['POST'])
def batch_download():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的JSON数据'}), 400

        files = data.get('files', [])
        folders = data.get('folders', [])
        current_path = data.get('current_path', '')

        if len(files) == 0 and len(folders) == 0:
            return jsonify({'error': '没有选择文件或文件夹'}), 400

        # 创建一个临时目录来存放所有文件
        import tempfile
        import uuid

        temp_dir = tempfile.mkdtemp()
        zip_filename = f"batch_download_{uuid.uuid4().hex[:8]}.zip"
        zip_path = os.path.join(temp_dir, zip_filename)

        # 创建zip文件
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # 添加文件
            for file_info in files:
                file_path = safe_relative_path(file_info['path'])
                if file_path and os.path.exists(file_path):
                    # 在zip中的相对路径
                    arcname = file_info['name']
                    zipf.write(file_path, arcname)

            # 添加文件夹
            for folder_info in folders:
                folder_path = safe_relative_path(folder_info['path'])
                if folder_path and os.path.exists(folder_path):
                    for root, dirs, files_in_folder in os.walk(folder_path):
                        for file in files_in_folder:
                            file_path = os.path.join(root, file)
                            # 在zip中的相对路径
                            rel_path = os.path.relpath(file_path, folder_path)
                            arcname = os.path.join(folder_info['name'], rel_path)
                            zipf.write(file_path, arcname)

        # 将zip文件移动到uploads目录以供下载
        final_zip_path = os.path.join(UPLOAD_FOLDER, zip_filename)
        shutil.move(zip_path, final_zip_path)

        return jsonify({
            'success': True,
            'download_url': f'/download/{zip_filename}',
            'file_count': len(files) + len(folders),
            'message': '批量下载文件已准备就绪'
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# 下载文件夹API - 确保正确压缩为ZIP
@app.route('/download-folder/<path:folder_path>')
def download_folder(folder_path):
    try:
        # 获取安全的文件夹路径
        safe_folder_path = safe_relative_path(folder_path)

        if not safe_folder_path:
            return jsonify({'error': '无效的文件夹路径'}), 400

        if not os.path.exists(safe_folder_path) or not os.path.isdir(safe_folder_path):
            return jsonify({'error': '文件夹不存在'}), 404

        # 创建内存中的zip文件
        memory_file = BytesIO()
        folder_name = os.path.basename(folder_path) or f'folder_{int(time.time())}'

        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(safe_folder_path):
                # 计算在zip中的相对路径
                relative_root = os.path.relpath(root, safe_folder_path)

                for file in files:
                    file_path = os.path.join(root, file)
                    # 在zip中的相对路径
                    if relative_root == '.':
                        arcname = file
                    else:
                        arcname = os.path.join(relative_root, file)

                    # 确保路径使用正斜杠
                    arcname = arcname.replace('\\', '/')

                    try:
                        zf.write(file_path, arcname)
                    except Exception as e:
                        print(f"无法添加文件到ZIP: {file_path}, 错误: {e}")
                        continue

        memory_file.seek(0)

        # 返回ZIP文件
        return send_file(
            memory_file,
            as_attachment=True,
            download_name=f'{folder_name}.zip',
            mimetype='application/zip'
        )

    except Exception as e:
        print(f"下载文件夹错误: {str(e)}")
        return jsonify({'error': str(e)}), 500


# 下载文件API
@app.route('/download/<path:filepath>')
def download_file(filepath):
    try:
        # 获取安全的文件路径
        safe_path = safe_relative_path(filepath)

        if not safe_path:
            return jsonify({'error': '无效的文件路径'}), 400

        if not os.path.exists(safe_path):
            return jsonify({'error': '文件不存在'}), 404

        # 如果是文件夹，重定向到文件夹下载（ZIP格式）
        if os.path.isdir(safe_path):
            return download_folder(filepath)

        # 如果是文件，直接下载
        filename = os.path.basename(safe_path)
        dir_path = os.path.dirname(safe_path)

        return send_from_directory(
            dir_path,
            filename,
            as_attachment=True,
            mimetype='application/octet-stream'
        )
    except Exception as e:
        print(f"下载文件错误: {str(e)}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    import socket

    hostname = socket.gethostname()
    ip_address = socket.gethostbyname(hostname)

    print(f"服务器启动中...")
    print(f"本机IP地址: {ip_address}")
    print(f"访问地址: http://{ip_address}:5000")
    print(f"或: http://localhost:5000")
    print("按 Ctrl+C 停止服务器")

    # 添加详细的错误信息
    app.config['PROPAGATE_EXCEPTIONS'] = True

    app.run(host='0.0.0.0', port=5000, debug=True)
