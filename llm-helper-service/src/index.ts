import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;
const CORE_CHAT_SERVICE_URL = process.env.CORE_CHAT_SERVICE_URL || 'http://localhost:3001';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'llm-helper-service' });
});

// Generate summary for a channel
app.post('/api/llm/summary', async (req, res) => {
  try {
    const { channelId, sinceTimestamp } = req.body;

    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }

    console.log(`📝 Generating summary for channel ${channelId} since ${sinceTimestamp || 0}`);

    // Fetch messages from Core Chat Service
    const response = await axios.post(`${CORE_CHAT_SERVICE_URL}/api/messages/replay`, {
      channelId,
      lastTimestamp: sinceTimestamp || 0,
    });

    const messages = response.data.messages;

    if (messages.length === 0) {
      return res.json({
        summary: 'No messages to summarize.',
        messageCount: 0,
      });
    }

    // Format messages for OpenAI
    const messageText = messages
      .map((msg: any) => `[${msg.userId}]: ${msg.text}`)
      .join('\n');

    // Call OpenAI to generate summary
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that summarizes chat conversations concisely. Focus on key topics, decisions, and action items.',
        },
        {
          role: 'user',
          content: `Summarize these chat messages in less than 100 words:\n\n${messageText}`,
        },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const summary = completion.choices[0].message.content;

    console.log(`✅ Summary generated: ${summary?.substring(0, 50)}...`);

    res.json({
      summary,
      messageCount: messages.length,
      channelId,
    });
  } catch (error: any) {
    console.error('❌ Error generating summary:', error.message);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Contextual search (Q&A over messages)
app.post('/api/llm/search', async (req, res) => {
  try {
    const { channelId, query, sinceTimestamp } = req.body;

    if (!channelId || !query) {
      return res.status(400).json({ error: 'channelId and query are required' });
    }

    console.log(`🔍 Searching channel ${channelId} for: "${query}"`);

    // Fetch messages from Core Chat Service
    const response = await axios.post(`${CORE_CHAT_SERVICE_URL}/api/messages/replay`, {
      channelId,
      lastTimestamp: sinceTimestamp || 0,
    });

    const messages = response.data.messages;

    if (messages.length === 0) {
      return res.json({
        answer: 'No messages found in this channel.',
        messageCount: 0,
      });
    }

    // Format messages for OpenAI
    const messageText = messages
      .map((msg: any) => `[${msg.userId}]: ${msg.text}`)
      .join('\n');

    // Call OpenAI to answer the query
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that answers questions based on chat history. Be concise and cite relevant messages if possible.',
        },
        {
          role: 'user',
          content: `Based on these chat messages:\n\n${messageText}\n\nQuestion: ${query}`,
        },
      ],
      max_tokens: 200,
      temperature: 0.5,
    });

    const answer = completion.choices[0].message.content;

    console.log(`✅ Answer generated: ${answer?.substring(0, 50)}...`);

    res.json({
      answer,
      query,
      messageCount: messages.length,
      channelId,
    });
  } catch (error: any) {
    console.error('❌ Error in contextual search:', error.message);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 LLM Helper Service running on port ${PORT}`);
});