# FileFly - Lightweight LAN File Sharing Tool Based on Flask

> 🌐 Language / 语言选择: **English** | [简体中文](README_zh_cn.md)

FileFly is a simple and fast local area network (LAN) file-sharing solution built on Python's Flask framework. It enables easy file transfers between devices on the same network without complex configuration or external services.

## ✨ Features

· **Minimalist Operation**: Ready to use upon startup; access and manage files via a web browser.  
· **High-Speed LAN Transfer**: Files are transferred directly over the local network, offering fast speeds and no external bandwidth usage.  
· **Cross-Platform Support**: Accessible from any device with a browser (PC, smartphone, tablet) thanks to its web interface.  
· **Lightweight Dependencies**: Core dependency is only Flask, making deployment straightforward.  
· **Directory Browsing**: Browse all files within the designated shared directory.

## 🚀 Quick Start

1. **Clone the Repository**  
   ```bash
   git clone https://github.com/YunYuanWeiGui/FileFly.git
   cd FileFly
   ```
2. **Install Dependencies**  
   It's recommended to use a virtual environment.
   ```bash
   pip install flask
   ```
   Note: Typically, only Flask is required. Please check the requirements.txt file for specific versions.
3. **Run the Application**  
   ```bash
   python app.py
   ```
   After running, the console will display the access address (e.g., http://192.168.1.x:5000).
4. **Access and Use**  
   On any device within the same LAN, enter the address shown above in a browser to open the file-sharing interface for uploading, downloading, or browsing files.

## 📂 Basic Usage

· After starting the service, files in the running directory are shared by default.  
· Use the web interface to view the file list and download files.  
· (If supported) Some configurations may allow direct file uploads to the server directory via the interface.