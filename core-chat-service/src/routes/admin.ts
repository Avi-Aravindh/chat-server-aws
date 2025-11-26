import express from 'express';
import { prisma } from '../services/chat';
import redis from '../services/redis';

const router = express.Router();

// Reset database - delete all messages
router.post('/reset', async (req, res) => {
  try {
    console.log('🗑️  Resetting database...');
    
    // Delete all messages from PostgreSQL
    await prisma.message.deleteMany({});
    
    // Clear all Redis keys
    const keys = await redis.keys('channel:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    console.log('✅ Database reset complete');
    res.json({ success: true, message: 'Database reset successfully' });
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

// Generate synthetic messages
router.post('/generate', async (req, res) => {
  try {
    const {
      messageCount = 100,
      channelCount = 5,
      userCount = 10,
      pattern = 'steady' // 'steady', 'bursty', 'high-traffic'
    } = req.body;

    console.log(`📊 Generating ${messageCount} synthetic messages...`);

    const messages = [];
    const startTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago

    const sampleTexts = [
      'We need to finalize the contract pricing by Friday.',
      'Agreed. The delivery date is set for March 15th.',
      'I will send the updated proposal tomorrow morning.',
      'Can someone review the latest design mockups?',
      'The client approved the budget increase.',
      'Meeting scheduled for 2 PM tomorrow.',
      'Please update the project timeline.',
      'The API integration is complete.',
      'QA testing will begin next week.',
      'All stakeholders have been notified.',
    ];

    for (let i = 0; i < messageCount; i++) {
      const channelId = `channel-${Math.floor(Math.random() * channelCount) + 1}`;
      const userId = `user-${Math.floor(Math.random() * userCount) + 1}`;
      const text = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
      
      // Calculate timestamp based on pattern
      let timestamp;
      if (pattern === 'bursty') {
        // Cluster messages in bursts
        const burstStart = startTime + Math.floor(i / 20) * 3600000; // Every 20 messages, new hour
        timestamp = burstStart + Math.random() * 60000; // Within 1 minute
      } else if (pattern === 'high-traffic') {
        // Evenly distributed, high frequency
        timestamp = startTime + (i * 100); // 100ms apart
      } else {
        // Steady pattern
        timestamp = startTime + (i * (24 * 60 * 60 * 1000) / messageCount);
      }

      messages.push({
        messageId: `${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`,
        channelId,
        userId,
        text,
        timestamp: Math.floor(timestamp),
      });
    }

    // Bulk insert to PostgreSQL
    await prisma.message.createMany({
      data: messages,
    });

    // Write to Redis cache (last 100 per channel)
    const channelGroups: { [key: string]: any[] } = {};
    messages.forEach((msg) => {
      if (!channelGroups[msg.channelId]) {
        channelGroups[msg.channelId] = [];
      }
      channelGroups[msg.channelId].push(msg);
    });

    for (const [channelId, msgs] of Object.entries(channelGroups)) {
      const last100 = msgs.slice(-100);
      for (const msg of last100) {
        await redis.zadd(
          `channel:${channelId}`,
          msg.timestamp,
          JSON.stringify(msg)
        );
      }
      await redis.expire(`channel:${channelId}`, 1800);
    }

    console.log(`✅ Generated ${messageCount} messages across ${channelCount} channels`);
    res.json({
      success: true,
      messageCount,
      channelCount,
      pattern,
    });
  } catch (error) {
    console.error('❌ Error generating messages:', error);
    res.status(500).json({ error: 'Failed to generate messages' });
  }
});

// Get all messages (for analysis)
router.get('/messages', async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      orderBy: { timestamp: 'asc' },
      take: 10000, // Limit to prevent overload
    });

    res.json({
      messages: messages.map((msg) => ({
        messageId: msg.messageId,
        channelId: msg.channelId,
        userId: msg.userId,
        text: msg.text,
        timestamp: Number(msg.timestamp),
      })),
      count: messages.length,
    });
  } catch (error) {
    console.error('❌ Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get metrics
router.get('/metrics', async (req, res) => {
  try {
    const totalMessages = await prisma.message.count();
    
    // Count messages per channel
    const channelCounts = await prisma.message.groupBy({
      by: ['channelId'],
      _count: true,
    });

    // Check Redis cache size
    const redisKeys = await redis.keys('channel:*');
    let cachedMessageCount = 0;
    for (const key of redisKeys) {
      const count = await redis.zcard(key);
      cachedMessageCount += count;
    }

    res.json({
      totalMessages,
      channelCount: channelCounts.length,
      channels: channelCounts.map((c) => ({
        channelId: c.channelId,
        count: c._count,
      })),
      cachedMessages: cachedMessageCount,
      cacheHitRatio: totalMessages > 0 ? (cachedMessageCount / totalMessages) * 100 : 0,
    });
  } catch (error) {
    console.error('❌ Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

export default router;