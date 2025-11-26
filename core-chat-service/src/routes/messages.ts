import express from 'express';
import { handleIncomingMessage, replayMessages } from '../services/chat';
import { ChatMessage, ReplayRequest } from '../types';

const router = express.Router();

// POST /messages - Send a new message
router.post('/', async (req, res) => {
  try {
    const message: ChatMessage = {
      messageId: req.body.messageId || generateId(),
      channelId: req.body.channelId,
      userId: req.body.userId,
      text: req.body.text,
      timestamp: Date.now(),
    };

    await handleIncomingMessage(message);
    res.status(201).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// POST /messages/replay - Get messages after reconnection
router.post('/replay', async (req, res) => {
  try {
    const { channelId, lastTimestamp }: ReplayRequest = req.body;

    if (!channelId || lastTimestamp === undefined) {
      return res.status(400).json({ error: 'channelId and lastTimestamp required' });
    }

    const messages = await replayMessages(channelId, lastTimestamp);
    res.json({ messages, count: messages.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to replay messages' });
  }
});

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export default router;