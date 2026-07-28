import express from 'express';

const app = express();
app.use(express.json());

// 内存队列，存待执行的命令
let commandQueue = [];
let lastHeartbeat = null;

// 验证 secret
function checkAuth(req) {
  const secret = process.env.BRIDGE_SECRET;
  if (!secret) return true;
  return req.query.secret === secret;
}

function authMiddleware(req, res, next) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ========== MCP 协议端点 ==========
app.post('/mcp', authMiddleware, (req, res) => {
  const msg = req.body;
  if (!msg || !msg.method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request' },
      id: msg?.id || null
    });
  }

  const { method, params, id } = msg;

  switch (method) {
    // MCP 初始化
    case 'initialize':
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'svakom-ble-bridge', version: '1.0.0' }
        }
      });

    case 'notifications/initialized':
      return res.json({ jsonrpc: '2.0', id: null, result: null });

    // 列出可用工具
    case 'tools/list':
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          tools: [
            {
              name: 'toy_set_speed',
              description: '设置玩具强度。speed 0=停止, 0.5=一半, 1=最大',
              inputSchema: {
                type: 'object',
                properties: {
                  speed: { type: 'number', description: '强度 0~1', minimum: 0, maximum: 1 },
                  sec: { type: 'number', description: '持续秒数，不填则一直持续', minimum: 1 }
                },
                required: ['speed']
              }
            },
            {
              name: 'toy_set_pattern',
              description: '设置振动花样（仅震动棒响应）',
              inputSchema: {
                type: 'object',
                properties: {
                  pattern: { type: 'number', description: '花样 1-8', minimum: 1, maximum: 8 },
                  level: { type: 'number', description: '强度 0-1', minimum: 0, maximum: 1 }
                },
                required: ['pattern', 'level']
              }
            },
            {
              name: 'toy_stop',
              description: '立即停止玩具',
              inputSchema: { type: 'object', properties: {} }
            },
            {
              name: 'toy_status',
              description: '查询蓝牙中继是否在线',
              inputSchema: { type: 'object', properties: {} }
            }
          ]
        }
      });

    // 调用工具
    case 'tools/call': {
      const { name, arguments: args } = params;
      const cmd = {
        name, args: args || {},
        timestamp: Date.now(),
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      };
      commandQueue.push(cmd);
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: `✅ 命令 ${name} 已发送到玩具` }]
        }
      });
    }

    default:
      return res.json({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
  }
});

// ========== 蓝牙中继轮询端点 ==========
// bridge.py / toy.html 每 300ms 来问：有命令吗？
app.get('/toy-next', authMiddleware, (req, res) => {
  if (commandQueue.length > 0) {
    return res.json(commandQueue.shift());
  }
  return res.json(null); // 没命令就返回 null
});

// ========== 中继心跳 ==========
app.post('/toy-heartbeat', authMiddleware, (req, res) => {
  lastHeartbeat = Date.now();
  res.json({ ok: true });
});

// 查询中继是否在线
app.get('/toy-status', authMiddleware, (req, res) => {
  const online = lastHeartbeat && (Date.now() - lastHeartbeat < 15000);
  res.json({ online: !!online, lastHeartbeat });
});

// ========== 启动 ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SVAKOM Bridge 运行中，端口 ${PORT}`);
  console.log(`🔑 BRIDGE_SECRET: ${process.env.BRIDGE_SECRET ? '已设置 ✅' : '未设置 ⚠️'}`);
});
