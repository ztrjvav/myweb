const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const crypto = require('crypto');
const PORT = 3000;
const HOST = 'localhost';
const SEARCH_LOG_FILE = 'search.log';
const USERS_FILE = 'users.json';
const MESSAGES_FILE = 'messages.json';

// 确保必要文件和目录存在
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');

// 用户数据存储
let users = {};

// 加载用户数据
try {
    if (fs.existsSync(USERS_FILE)) {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        users = data.trim() ? JSON.parse(data) : {};
    }
} catch (err) {
    console.error('加载用户数据时出错:', err);
    users = {};
}

// 保存用户数据到文件
function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (err) {
        console.error('保存用户数据时出错:', err);
    }
}

function loadMessages() {
    try {
        if (fs.existsSync(MESSAGES_FILE)) {
            const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
            return data.trim() ? JSON.parse(data) : [];
        }
        return [];
    } catch (err) {
        console.error('加载消息数据时出错:', err);
        return [];
    }
}

// 保存消息到文件
function saveMessages(messages) {
    try {
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf8');
    } catch (err) {
        console.error('保存消息数据时出错:', err);
    }
}

// 会话验证中间件
function sessionMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionId = cookies.sessionId;
    
    if (sessionId) {
        // 查找匹配的用户
        for (const username in users) {
            if (users[username].sessionId === sessionId) {
                req.user = { 
                    username: username,
                    sessionId: sessionId
                };
                break;
            }
        }
    }
    next();
}

// 解析Cookie
function parseCookies(cookieString) {
    return cookieString.split(';').reduce((cookies, cookie) => {
        const [name, value] = cookie.split('=').map(c => c.trim());
        cookies[name] = decodeURIComponent(value);
        return cookies;
    }, {});
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
    sessionMiddleware(req, res, () => {
        console.log(`Received ${req.method} request for ${req.url}`);
        
        const parsedUrl = url.parse(req.url);
        const method = req.method;
        let pathname = path.join(__dirname, parsedUrl.pathname);
        
        // 处理根路径请求
        if (pathname === path.join(__dirname, '/') || pathname === path.join(__dirname, '/index.html')) {
            pathname = path.join(__dirname, 'index.html');
        }
        
        // API路由处理
        if (method === 'POST') {
            let body = '';
            
            req.on('data', (chunk) => {
                body += chunk.toString();
            });
            
            req.on('end', () => {
                try {
                    const data = querystring.parse(body);
                    
                    // 用户注册
                    if (parsedUrl.pathname === '/register') {
                        const username = data.username;
                        const password = data.password;
                        
                        if (!username || !password) {
                            sendResponse(res, 400, {success: false, message: '用户名和密码不能为空'});
                            return;
                        }
                        
                        if (users[username]) {
                            sendResponse(res, 400, {success: false, message: '用户名已存在'});
                            return;
                        }
                        
                        users[username] = { password };
                        saveUsers();
                        
                        sendResponse(res, 200, {
                            success: true, 
                            message: '注册成功',
                            username: username
                        });
                        return;
                    }
                    
                    // 用户登录
                    if (parsedUrl.pathname === '/login') {
                        const username = data.username;
                        const password = data.password;
                        
                        if (!users[username] || users[username].password !== password) {
                            sendResponse(res, 401, {success: false, message: '用户名或密码错误'});
                            return;
                        }
                        
                        const sessionId = crypto.randomBytes(16).toString('hex');
                        users[username].sessionId = sessionId;
                        saveUsers();
                        
                        // 设置Cookie
                        res.setHeader('Set-Cookie', `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
                        
                        sendResponse(res, 200, {
                            success: true, 
                            message: '登录成功',
                            username: username,
                            sessionId: sessionId
                        });
                        return;
                    }
                    
                    // 退出登录
                    if (parsedUrl.pathname === '/logout') {
                        if (!req.user) {
                            sendResponse(res, 401, {success: false, message: '未登录'});
                            return;
                        }

                        const username = req.user.username;
                        if (users[username]) {
                            delete users[username].sessionId; // 清除sessionId
                            saveUsers();
                        }

                        // 设置cookie过期
                        res.setHeader('Set-Cookie', 'sessionId=; HttpOnly; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
                        sendResponse(res, 200, {success: true, message: '退出成功'});
                        return;
                    }
                    
                    // 记录搜索
                    if (parsedUrl.pathname === '/search') {
                        const query = data.query;
                        const username = data.username || '匿名';
                        
                        if (!query) {
                            sendResponse(res, 400, {success: false, message: '搜索内容不能为空'});
                            return;
                        }
                        
                        // 记录搜索日志
                        const timestamp = new Date().toISOString();
                        const logEntry = `${timestamp}: [${username}] "${query}"\n`;
                        
                        fs.appendFile(SEARCH_LOG_FILE, logEntry, (err) => {
                            if (err) {
                                console.error('写入搜索日志时出错:', err);
                                sendResponse(res, 500, {success: false, message: '服务器错误'});
                                return;
                            }
                            
                            console.log(logEntry.trim()); // 在控制台输出日志
                            sendResponse(res, 200, {success: true, message: '搜索记录成功'});
                        });
                        return;
                    }
                    
                    // 发送消息处理
                    if (parsedUrl.pathname === '/send-message') {
                        if (!req.user) {
                            sendResponse(res, 401, {success: false, message: '请先登录再发送消息'});
                            return;
                        }

                        const username = req.user.username;
                        const content = data.content;
                        
                        if (!content) {
                            sendResponse(res, 400, {success: false, message: '消息内容不能为空'});
                            return;
                        }
                        
                        // 加载现有消息
                        const messages = loadMessages();
                        
                        // 添加新消息
                        const newMessage = {
                            username,
                            content,
                            timestamp: new Date().toISOString()
                        };
                        messages.push(newMessage);
                        
                        // 保存消息
                        saveMessages(messages);
                        
                        sendResponse(res, 200, {success: true, message: '消息发送成功'});
                        return;
                    }
                    
                } catch (err) {
                    console.error('处理POST请求时出错:', err);
                    sendResponse(res, 500, {success: false, message: '服务器内部错误'});
                }
            });
        } 
        // GET请求处理
        else if (method === 'GET') {
            // 添加认证检查端点
            if (parsedUrl.pathname === '/api/check-auth') {
                if (req.user) {
                    sendResponse(res, 200, {
                        authenticated: true,
                        username: req.user.username
                    });
                } else {
                    sendResponse(res, 200, {
                        authenticated: false
                    });
                }
                return;
            }
            
            // 获取消息
            if (parsedUrl.pathname === '/get-messages') {
                const messages = loadMessages();
                sendResponse(res, 200, {success: true, messages});
                return;
            }
            
            // 如果没有匹配的API，继续静态文件服务
            serveStaticFile(req, res, pathname, parsedUrl);
        }
        // 其他请求处理静态文件
        else {
            serveStaticFile(req, res, pathname, parsedUrl);
        }
    });
});

// 发送JSON响应
function sendResponse(res, statusCode, data) {
    res.writeHead(statusCode, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(data));
}

// 静态文件服务
function serveStaticFile(req, res, pathname, parsedUrl) {
    // 获取文件扩展名并设置 Content-Type
    const ext = path.extname(pathname);
    const contentType = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    }[ext] || 'text/plain';
    
    // 检查文件是否存在
    fs.access(pathname, fs.constants.F_OK, (err) => {
        if (err) {
            // 文件不存在 - 返回 404
            res.writeHead(404, {'Content-Type': 'text/html'});
            res.end(`
                <html>
                    <head><title>404 Not Found</title></head>
                    <body>
                        <h1>404 Not Found</h1>
                        <p>请求的文件 ${parsedUrl.pathname} 未找到</p>
                        <p>请检查文件是否存在于 ${pathname}</p>
                        <p>当前工作目录: ${__dirname}</p>
                        <a href="/">返回首页</a>
                    </body>
                </html>
            `);
            return;
        }
        
        // 如果是目录，则查找index.html
        fs.stat(pathname, (err, stats) => {
            if (err) {
                res.writeHead(500, {'Content-Type': 'text/html'});
                res.end(`<h1>服务器错误</h1><p>读取文件信息时出错: ${err.message}</p>`);
                return;
            }
            
            if (stats.isDirectory()) {
                // 尝试查找目录中的index.html
                const indexPath = path.join(pathname, 'index.html');
                fs.access(indexPath, fs.constants.F_OK, (err) => {
                    if (err) {
                        // 没有index.html - 返回目录列表或404
                        res.writeHead(404, {'Content-Type': 'text/html'});
                        res.end(`<h1>404 Not Found</h1><p>目录中没有默认文件: ${parsedUrl.pathname}</p>`);
                    } else {
                        // 读取并返回index.html
                        fs.readFile(indexPath, (err, data) => {
                            if (err) {
                                res.writeHead(500, {'Content-Type': 'text/html'});
                                res.end(`<h1>服务器错误</h1><p>读取文件时出错: ${err.message}</p>`);
                            } else {
                                res.writeHead(200, {'Content-Type': 'text/html'});
                                res.end(data);
                            }
                        });
                    }
                });
            } else {
                // 读取并返回文件
                fs.readFile(pathname, (err, data) => {
                    if (err) {
                        res.writeHead(500, {'Content-Type': 'text/html'});
                        res.end(`<h1>服务器错误</h1><p>读取文件时出错: ${err.message}</p>`);
                    } else {
                        res.writeHead(200, {'Content-Type': contentType});
                        res.end(data);
                    }
                });
            }
        });
    });
}

// 启动服务器
server.listen(PORT, HOST, () => {
    console.log(`服务器运行在 http://${HOST}:${PORT}/`);
    console.log('按 Ctrl+C 停止服务器');
    console.log(`搜索日志将保存到: ${SEARCH_LOG_FILE}`);
    console.log(`用户数据保存到: ${USERS_FILE}`);

    // 处理 Ctrl+C 信号
    process.on('SIGINT', () => {
        console.log('\n服务器正在关闭...');
        saveUsers();
        server.close(() => {
            console.log('服务器已关闭');
            process.exit(0);
        });
    });
});