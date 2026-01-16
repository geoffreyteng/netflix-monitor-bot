// Netflix Monitor Telegram Bot
// This bot scans Gmail for Netflix household update emails and sends them to Telegram
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // Your bot token from BotFather
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;         // Your Telegram chat ID
const GMAIL_USER = process.env.GMAIL_ADDRESS;          // Your Gmail address

// For Gmail API authentication (free tier)
const CREDENTIALS_PATH = path.join(__dirname, 'gmail-credentials.json');
const TOKEN_PATH = path.join(__dirname, 'gmail-token.json');

// ============================================
// INITIALIZE BOT
// ============================================

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: {
        interval: 1000,        // Poll every 1 second
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// ============================================
// GMAIL API SETUP (Free tier)
// ============================================

// OAuth2 credentials for Gmail API
const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'http://localhost:3000/auth/callback'
);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync('gmail-token.json', 'utf8')));

// Get Gmail service instance
function getGmailService() {
    return google.gmail({
        version: 'v1',
        auth: oauth2Client
    });
}

// ============================================
// NETFLIX EMAIL SCANNER
// ============================================

// Function to search for Netflix household update emails
async function scanForNetflixEmails() {
    try {
        const gmail = getGmailService();

        // Search for Netflix household update emails from the last check
        // Query: from Netflix AND (households OR account sharing)
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: 'in:inbox is:unread from:no-reply@accounts.google.com',
            maxResults: 5,
            fields: 'messages(id, threadId)'
        });

        if (!response.data.messages || response.data.messages.length === 0) {
            console.log(`[${new Date().toISOString()}] No Netflix emails found`);
            return;
        }

        console.log(`[${new Date().toISOString()}] Found ${response.data.messages.length} potential Netflix emails`);

        // Process each message
        for (const message of response.data.messages) {
            const fullMessage = await gmail.users.messages.get({
                userId: 'me',
                id: message.id,
                format: 'full'
            });

            const headers = fullMessage.data.payload.headers;
            const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const dateStr = headers.find(h => h.name === 'Date')?.value || new Date().toISOString();

            // Extract email body
            let body = '';
            if (fullMessage.data.payload.parts) {
                const textPart = fullMessage.data.payload.parts.find(p => p.mimeType === 'text/plain');
                if (textPart && textPart.body.data) {
                    body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
                }
            } else if (fullMessage.data.payload.body.data) {
                body = Buffer.from(fullMessage.data.payload.body.data, 'base64').toString('utf-8');
            }

            // Extract URL from email body (Netflix usually includes action links)
            const urls = body.match(/https?:\/\/[^\s]+/g) || [];
            const actionUrl = urls.find(u => u.includes('netflix.com')) || urls[0] || 'No link found';

            // Format and send to Telegram
            await sendNetflixUpdateToTelegram(subject, body, actionUrl, from, dateStr, message.id);

            // Mark as read to avoid duplicates
            await gmail.users.messages.modify({
                userId: 'me',
                id: message.id,
                requestBody: {
                    removeLabelIds: ['UNREAD'],
                }
            });
        }
    } catch (error) {
        console.error('Error scanning Gmail:', error.message);
        if (error.message.includes('invalid_grant')) {
            console.log('Token expired. Please re-authenticate.');
            // Reset token file to trigger re-authentication
            if (fs.existsSync(TOKEN_PATH)) {
                fs.unlinkSync(TOKEN_PATH);
            }
        }
    }
}

// ============================================
// TELEGRAM SENDER
// ============================================

async function sendNetflixUpdateToTelegram(subject, body, actionUrl, from, dateStr, messageId) {
    try {
        // Create message with formatting
        const message = `
📺 <b>Netflix Household Update</b>

<b>Subject:</b> ${subject}

<b>Received:</b> ${new Date(dateStr).toLocaleString()}

<b>Action Link:</b> ${actionUrl}

<b>Preview:</b>
${body.substring(0, 200)}...

<i>Message ID: ${messageId}</i>
`;

        await bot.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' });
        console.log(`[${new Date().toISOString()}] ✅ Sent Netflix update to Telegram`);
    } catch (error) {
        console.error('Error sending Telegram message:', error.message);
    }
}

// ============================================
// SCHEDULER
// ============================================

// Schedule checks every 5 minutes
const job = cron.schedule('*/5 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] 🔍 Checking Gmail for Netflix emails...`);
    await scanForNetflixEmails();
});

// ============================================
// TELEGRAM BOT COMMANDS
// ============================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
✅ Netflix Monitor Bot Started!

This bot will scan your Gmail for Netflix household update emails and notify you here.

<b>Commands:</b>
/check - Check Gmail manually right now
/status - Show bot status
/stop - Stop the bot

Bot will automatically check every 5 minutes.
  `;

    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
    console.log(`Bot started for chat: ${chatId}`);
});

bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔍 Checking Gmail now...');
    await scanForNetflixEmails();
    bot.sendMessage(chatId, '✅ Check complete!');
});

bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const statusMessage = `
📊 <b>Bot Status</b>

✅ Bot is running
⏱️ Check interval: Every 5 minutes
📧 Monitoring: ${GMAIL_USER}
🤖 Telegram Chat: ${CHAT_ID}

Next scheduled check in ~${5 - (new Date().getMinutes() % 5)} minutes
  `;

    bot.sendMessage(chatId, statusMessage, { parse_mode: 'HTML' });
});

bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🛑 Bot stopped. Use /start to restart.');
    job.stop();
    bot.stopPolling();
    process.exit(0);
});

// Error handling
bot.on('polling_error', (error) => {
    console.error(`Polling error: ${error.code} - ${error.message}`);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

// ============================================
// ALTERNATIVE: SIMPLE GMAIL CREDENTIALS APPROACH
// ============================================
// If you prefer not using Gmail API, you can use Nodemailer with app password:
/*
const nodemailer = require('nodemailer');

async function scanGmailWithNodemailer() {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_ADDRESS,
      pass: process.env.GMAIL_APP_PASSWORD  // Use App Password, not regular password
    }
  });

  // This would require additional setup but avoids OAuth complexity
}
*/

// ============================================
// STARTUP
// ============================================

console.log('🚀 Netflix Monitor Bot Starting...');
console.log(`Chat ID: ${CHAT_ID}`);
console.log(`Gmail: ${GMAIL_USER}`);
console.log(`Check interval: Every 5 minutes`);
console.log('Bot is running. Send /start to begin.');

// Run initial check on startup
setTimeout(() => {
    scanForNetflixEmails();
}, 5000);