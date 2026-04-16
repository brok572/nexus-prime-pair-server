// server.js
// ADEVOS-X TECH · Nexus Prime WhatsApp Bot

const express = require('express');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const logger = pino({ level: 'info' });
const app = express();
const PORT = process.env.PORT || 3000;

// ====== WEB SETUP ======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ====== BOT STATE ======
let sock = null;
let isConnecting = false;
let antiLinkEnabled = true;
let antiBotEnabled = true;
const ownerNumber = process.env.OWNER_NUMBER || '255663402315'; // badilisha

// ====== START BOT FUNCTION ======
async function startBot() {
  if (isConnecting) return;
  isConnecting = true;

  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      logger.info('✅ WhatsApp bot connected');
    } else if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.warn('❌ Connection closed, reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    }
  });

  // ====== MESSAGE HANDLER ======
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      const sender = msg.key.participant || msg.key.remoteJid;
      const body =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        '';

      // Simple prefix
      const prefix = '!';
      const isCmd = body.startsWith(prefix);
      const command = isCmd ? body.slice(1).trim().split(' ')[0].toLowerCase() : '';
      const args = isCmd ? body.trim().split(' ').slice(1) : [];

      // ====== GROUP PROTECTION: ANTILINK ======
      if (isGroup && antiLinkEnabled) {
        const linkRegex = /(https?:\/\/[^\s]+|chat\.whatsapp\.com\/[A-Za-z0-9]+)/i;
        if (linkRegex.test(body)) {
          await sock.sendMessage(from, {
            text: `⚠️ *Anti-Link Active*\n\n@${sender.split('@')[0]} links are not allowed in this group.`,
            mentions: [sender]
          });
          try {
            await sock.sendMessage(from, {
              delete: {
                remoteJid: from,
                fromMe: false,
                id: msg.key.id,
                participant: sender
              }
            });
          } catch (e) {
            logger.error('Failed to delete message:', e);
          }
        }
      }

      // ====== GROUP PROTECTION: ANTIBOT (simple) ======
      if (isGroup && antiBotEnabled) {
        const botPattern = /(bot|auto-reply|powered by)/i;
        if (botPattern.test(body) && !sender.includes(ownerNumber)) {
          await sock.sendMessage(from, {
            text: `🤖 *Anti-Bot Active*\n\n@${sender.split('@')[0]} suspected bot message blocked.`,
            mentions: [sender]
          });
        }
      }

      // ====== COMMANDS ======
      if (isCmd) {
        switch (command) {
          case 'menu':
          case 'help':
            await sock.sendMessage(from, {
              text:
                `🛡 *ADEVOS-X TECH · Nexus Prime Bot*\n\n` +
                `*Group Protection*\n` +
                `• !antilink on/off\n` +
                `• !antibot on/off\n\n` +
                `*Admin Tools*\n` +
                `• !kick @user\n` +
                `• !promote @user\n` +
                `• !demote @user\n\n` +
                `*Info*\n` +
                `• !ping`
            });
            break;

          case 'ping':
            await sock.sendMessage(from, { text: '🏓 Pong! Bot is online.' });
            break;

          case 'antilink':
            if (!isGroup) return;
            if (!args[0]) {
              await sock.sendMessage(from, {
                text: `Usage: !antilink on / off\nCurrent: ${antiLinkEnabled ? 'ON' : 'OFF'}`
              });
            } else {
              antiLinkEnabled = args[0].toLowerCase() === 'on';
              await sock.sendMessage(from, {
                text: `✅ Anti-Link is now *${antiLinkEnabled ? 'ON' : 'OFF'}*`
              });
            }
            break;

          case 'antibot':
            if (!isGroup) return;
            if (!args[0]) {
              await sock.sendMessage(from, {
                text: `Usage: !antibot on / off\nCurrent: ${antiBotEnabled ? 'ON' : 'OFF'}`
              });
            } else {
              antiBotEnabled = args[0].toLowerCase() === 'on';
              await sock.sendMessage(from, {
                text: `✅ Anti-Bot is now *${antiBotEnabled ? 'ON' : 'OFF'}*`
              });
            }
            break;

          case 'kick':
            if (!isGroup) return;
            if (!msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
              await sock.sendMessage(from, { text: 'Tag mtu: !kick @user' });
              return;
            }
            {
              const target =
                msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
              await sock.groupParticipantsUpdate(from, [target], 'remove');
              await sock.sendMessage(from, {
                text: `🚫 @${target.split('@')[0]} removed.`,
                mentions: [target]
              });
            }
            break;

          case 'promote':
            if (!isGroup) return;
            if (!msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
              await sock.sendMessage(from, { text: 'Tag mtu: !promote @user' });
              return;
            }
            {
              const target =
                msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
              await sock.groupParticipantsUpdate(from, [target], 'promote');
              await sock.sendMessage(from, {
                text: `🛡 @${target.split('@')[0]} promoted to admin.`,
                mentions: [target]
              });
            }
            break;

          case 'demote':
            if (!isGroup) return;
            if (!msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
              await sock.sendMessage(from, { text: 'Tag mtu: !demote @user' });
              return;
            }
            {
              const target =
                msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
              await sock.groupParticipantsUpdate(from, [target], 'demote');
              await sock.sendMessage(from, {
                text: `⬇️ @${target.split('@')[0]} demoted from admin.`,
                mentions: [target]
              });
            }
            break;

          default:
            await sock.sendMessage(from, { text: 'Unknown command. Type !menu' });
        }
      }
    } catch (err) {
      logger.error('Error in messages.upsert:', err);
    }
  });

  isConnecting = false;
}

// ====== WEB ROUTE: PAIRING CODE BY PHONE ======
// User anaingiza namba → tunamletea 8-digit pairing code
app.post('/pair', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number required' });
    }

    if (!sock) {
      await startBot();
    }

    // Baileys pairing code (phone number without +, e.g. 2556634...)
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const code = await sock.requestPairingCode(cleanPhone);

    // Optional: tuma “session info” kwa hiyo namba baada ya connect
    // (Hapa tunarudisha tu code kwa web)
    return res.json({
      success: true,
      pairingCode: code
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to generate pairing code' });
  }
});

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
  // Start bot on boot
  startBot();
});
