import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3002;
const CORE_CHAT_SERVICE_URL = process.env.CORE_CHAT_SERVICE_URL || 'http://localhost:3001';

// Store active connections: userId -> WebSocket
const connections = new Map<string, WebSocket>();

// Store user's channel subscriptions: userId -> Set<channelId>
const userChannels = new Map<string, Set<string>>();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'websocket-gateway',
    activeConnections: connections.size 
  });
});

// WebSocket connection handler
wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const userId = req.headers['x-user-id'] as string;
  
  if (!userId) {
    ws.close(1008, 'Missing x-user-id header');
    return;
  }

  console.log(`✅ User connected: ${userId}`);
  connections.set(userId, ws);
  
  if (!userChannels.has(userId)) {
    userChannels.set(userId, new Set());
  }

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    userId,
    timestamp: Date.now()
  }));

  // Handle incoming messages
  ws.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(userId, message, ws);
    } catch (error) {
      console.error('❌ Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message'
      }));
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log(`👋 User disconnected: ${userId}`);
    connections.delete(userId);
    userChannels.delete(userId);
  });

  // Heartbeat
  ws.on('pong', () => {
    console.log(`💓 Heartbeat from ${userId}`);
  });
});

// Send heartbeat pings every 15 seconds
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 15000);

// Handle different message types
async function handleMessage(userId: string, message: any, ws: WebSocket) {
  switch (message.type) {
    case 'join_channel':
      await handleJoinChannel(userId, message.channelId, ws);
      break;
    
    case 'leave_channel':
      handleLeaveChannel(userId, message.channelId);
      break;
    
    case 'send_message':
      await handleSendMessage(userId, message, ws);
      break;
    
    case 'replay_messages':
      await handleReplayMessages(userId, message, ws);
      break;
    
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${message.type}`
      }));
  }
}

// Join a channel
async function handleJoinChannel(userId: string, channelId: string, ws: WebSocket) {
  const channels = userChannels.get(userId);
  if (channels) {
    channels.add(channelId);
    console.log(`📢 User ${userId} joined channel ${channelId}`);
    
    ws.send(JSON.stringify({
      type: 'joined_channel',
      channelId,
      timestamp: Date.now()
    }));
  }
}

// Leave a channel
function handleLeaveChannel(userId: string, channelId: string) {
  const channels = userChannels.get(userId);
  if (channels) {
    channels.delete(channelId);
    console.log(`👋 User ${userId} left channel ${channelId}`);
  }
}

// Send a message
async function handleSendMessage(userId: string, message: any, ws: WebSocket) {
  try {
    // Forward to Core Chat Service
    const response = await axios.post(`${CORE_CHAT_SERVICE_URL}/api/messages`, {
      channelId: message.channelId,
      userId: userId,
      text: message.text
    });

    const savedMessage = response.data;

    // Broadcast to all users in the channel
    broadcastToChannel(message.channelId, {
      type: 'new_message',
      message: savedMessage
    });

    console.log(`📨 Message sent to channel ${message.channelId}`);
  } catch (error) {
    console.error('❌ Error sending message:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to send message'
    }));
  }
}

// Replay messages (reconnection)
async function handleReplayMessages(userId: string, message: any, ws: WebSocket) {
  try {
    const response = await axios.post(`${CORE_CHAT_SERVICE_URL}/api/messages/replay`, {
      channelId: message.channelId,
      lastTimestamp: message.lastTimestamp || 0
    });

    ws.send(JSON.stringify({
      type: 'replay_response',
      channelId: message.channelId,
      messages: response.data.messages,
      count: response.data.count
    }));

    console.log(`🔄 Replayed ${response.data.count} messages for user ${userId}`);
  } catch (error) {
    console.error('❌ Error replaying messages:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to replay messages'
    }));
  }
}

// Broadcast message to all users in a channel
function broadcastToChannel(channelId: string, data: any) {
  userChannels.forEach((channels, userId) => {
    if (channels.has(channelId)) {
      const ws = connections.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    }
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`🚀 WebSocket Gateway running on port ${PORT}`);
  console.log(`🔌 WebSocket server ready on ws://localhost:${PORT}`);
});