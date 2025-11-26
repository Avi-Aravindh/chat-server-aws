import { PrismaClient } from '@prisma/client';
import redis from './redis';
import { ChatMessage } from '../types';

const prisma = new PrismaClient();

// Handle incoming messages - write to DB and Redis
export async function handleIncomingMessage(msg: ChatMessage): Promise<void> {
  try {
    // Write to PostgreSQL
    await prisma.message.create({
      data: {
        messageId: msg.messageId,
        channelId: msg.channelId,
        userId: msg.userId,
        text: msg.text,
        timestamp: msg.timestamp,
      },
    });

    // Write-through cache to Redis (sorted set by timestamp)
    await redis.zadd(
      `channel:${msg.channelId}`,
      msg.timestamp,
      JSON.stringify(msg)
    );

    // Set TTL on the Redis key (30 minutes)
    await redis.expire(`channel:${msg.channelId}`, 1800);

    console.log(`✅ Message saved: ${msg.messageId}`);
  } catch (error) {
    console.error('❌ Error saving message:', error);
    throw error;
  }
}

// Replay messages after reconnection
export async function replayMessages(
  channelId: string,
  lastTimestamp: number
): Promise<ChatMessage[]> {
  try {
    // Try Redis first (fast path)
    const cached = await redis.zrangebyscore(
      `channel:${channelId}`,
      lastTimestamp + 1,
      '+inf'
    );

    if (cached.length > 0) {
      console.log(`✅ Replaying ${cached.length} messages from Redis`);
      return cached.map((msg) => JSON.parse(msg));
    }

    // Fallback to PostgreSQL (cache miss or TTL expired)
    console.log(`⚠️ Cache miss, fetching from PostgreSQL`);
    const messages = await prisma.message.findMany({
      where: {
        channelId,
        timestamp: { gt: BigInt(lastTimestamp) },
      },
      orderBy: { timestamp: 'asc' },
    });

    return messages.map((msg) => ({
      messageId: msg.messageId,
      channelId: msg.channelId,
      userId: msg.userId,
      text: msg.text,
      timestamp: Number(msg.timestamp),
    }));
  } catch (error) {
    console.error('❌ Error replaying messages:', error);
    throw error;
  }
}

export { prisma };