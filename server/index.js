const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const WebSocket = require('ws');

dotenv.config();

// ── Optional MongoDB connection ──────────────────────────────
let usingMongoFlag = false;
let User = null, Meeting = null, Poll = null, Notification = null, RSVP = null;
let Transcript = null, Agenda = null, ActionItem = null, Attendance = null;

try {
    const mongoose = require('mongoose');
    mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mcms_db')
        .then(() => { console.log('MongoDB Connected'); usingMongoFlag = true; })
        .catch(err => console.log('MongoDB not available — using in-memory store:', err.message));
    User = require('./models/User');
    Meeting = require('./models/Meeting');
    Poll = require('./models/Poll');
    Notification = require('./models/Notification');
    RSVP = require('./models/RSVP');
    Transcript = require('./models/Transcript');
    Agenda = require('./models/Agenda');
    ActionItem = require('./models/ActionItem');
    Attendance = require('./models/Attendance');
} catch (e) {
    console.log('Mongoose not found — using in-memory store');
}

const usingMongo = () => usingMongoFlag;

// ── In-memory fallback store ─────────────────────────────────
const inMemoryUsers = [];

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'mcms_super_secret_key';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Socket.io Setup ──────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const connectedUsers = new Map();

io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.id;
        next();
    } catch { next(new Error('Invalid token')); }
});

// ── Live state maps ──────────────────────────────────────────
const meetingRooms = new Map();
const transcriptionSessions = new Map();
const activeAgendaItems = new Map();

// ── Auth & helpers ───────────────────────────────────────────
const generateToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
const { protect } = require('./middleware/auth');

function emitToUser(userId, event, data) {
    io.to(`user:${userId.toString()}`).emit(event, data);
}

// ── Email Setup ──────────────────────────────────────────────
let transporter = null;
async function getMailTransporter() {
    if (transporter) return transporter;
    if (process.env.SENDGRID_API_KEY) {
        transporter = nodemailer.createTransport({
            host: 'smtp.sendgrid.net', port: 587, secure: false,
            auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
        });
    } else if (process.env.SMTP_HOST) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
    } else {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email', port: 587, secure: false,
            auth: { user: testAccount.user, pass: testAccount.pass },
        });
        console.log('Using Ethereal test email — preview URLs in console');
    }
    return transporter;
}

function generateRsvpToken(meetingId, userId) {
    return jwt.sign({ meetingId: meetingId.toString(), userId: userId.toString(), purpose: 'rsvp' }, JWT_SECRET, { expiresIn: '30d' });
}

const { generateICS } = require('./services/icsGenerator');
const { callAISummarize, callAIExtractActions } = require('./services/aiService');

async function sendRsvpEmail(meeting, user, slot, icsBuffer) {
    try {
        const transport = await getMailTransporter();
        const token = generateRsvpToken(meeting._id, user._id);
        const baseUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

        const makeLink = (response) =>
            `${baseUrl}/api/rsvp/${meeting._id}/respond?token=${token}&response=${response}`;

        const dateStr = slot ? `${slot.date} at ${slot.time}` : `${meeting.date} at ${meeting.time}`;
        const meetingUrl = meeting.modality !== 'Offline' ? `${CLIENT_URL.replace(/\/$/, '')}?meeting=${meeting._id}` : null;
        const meetingLinkSection = meetingUrl
            ? `<p style="margin:16px 0"><strong>Meeting Link:</strong> <a href="${meetingUrl}" style="color:#6366f1">${meetingUrl}</a></p>`
            : '';
        const locationSection = meeting.location
            ? `<p><strong>Location:</strong> ${meeting.location}</p>`
            : '';

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a2e">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:20px">Meeting Invitation</h1>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 16px;color:#1a1a2e">${meeting.title}</h2>
    <p><strong>Date/Time:</strong> ${dateStr}</p>
    <p><strong>Type:</strong> ${meeting.modality}</p>
    ${locationSection}${meetingLinkSection}
    <p style="margin:24px 0 12px;font-weight:600">Will you attend?</p>
    <div style="display:flex;gap:12px">
      <a href="${makeLink('yes')}" style="display:inline-block;padding:10px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Yes</a>
      <a href="${makeLink('no')}" style="display:inline-block;padding:10px 28px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">No</a>
      <a href="${makeLink('maybe')}" style="display:inline-block;padding:10px 28px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Maybe</a>
    </div>
  </div>
</body></html>`;

        const attachments = [];
        if (icsBuffer) {
            attachments.push({
                filename: 'meeting.ics',
                content: icsBuffer,
                contentType: 'text/calendar',
            });
        }

        const info = await transport.sendMail({
            from: process.env.SMTP_FROM || '"MCMS Platform" <noreply@mcms.app>',
            to: user.email,
            subject: `Meeting Invitation: ${meeting.title}`,
            html,
            attachments,
        });

        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) console.log(`Preview RSVP email for ${user.email}: ${previewUrl}`);
    } catch (err) {
        console.error('Failed to send RSVP email:', err.message);
    }
}

// ── In-memory fallback stores (empty for new users; populated as they create data) ──
const inMemoryMeetings = [];
const inMemoryAgendas = {};
const inMemoryTranscripts = {};
const inMemoryActionItems = {};

// ── Shared deps object for routes ────────────────────────────
const deps = {
    User, Meeting, Poll, Notification, RSVP, protect, usingMongo,
    generateToken, emitToUser, sendRsvpEmail, generateICS,
    inMemoryUsers, JWT_SECRET, PORT, CLIENT_URL,
    inMemoryMeetings, inMemoryAgendas, inMemoryTranscripts, inMemoryActionItems,
    callAISummarize,
};

// ── Mount Routes ─────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth')(deps));
app.use('/api/users', require('./routes/auth')(deps));
app.use('/api/meetings', require('./routes/meetings')(deps));
app.use('/api/polls', require('./routes/polls')(deps));
app.use('/api/agenda', require('./routes/agenda')(deps));
app.use('/api/action-items', require('./routes/actionItems')(deps));
app.use('/api/attendance', require('./routes/attendance')(deps));
app.use('/api/archive', require('./routes/archive')(deps));
app.use('/api/search', require('./routes/search')(deps));
app.use('/api/rubric', require('./routes/rubric')(deps));
app.use('/api/pins', require('./routes/pins')(deps));
app.use('/api/dashboard', require('./routes/dashboard')(deps));
app.use('/api/notifications', require('./routes/notifications')(deps));
app.use('/api/rsvp', require('./routes/rsvp')(deps));
app.use('/api/profile', require('./routes/profile')(deps));
app.use('/api/transcript', require('./routes/transcript')(deps));

// ── Sarvam Transcription with agenda tagging ─────────────────
function createSarvamWS(meetingId, socketId, speakerName, speakerImage, broadcastSegment) {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
        console.log('SARVAM_API_KEY not set — transcription disabled');
        return null;
    }

    const url = 'wss://api.sarvam.ai/speech-to-text-translate/ws?model=saaras:v3&mode=transcribe&sample_rate=16000&input_audio_codec=pcm_s16le';
    let ws;
    try {
        ws = new WebSocket(url, { headers: { 'Api-Subscription-Key': apiKey } });
    } catch (err) {
        console.error('Sarvam WS creation failed:', err.message);
        return null;
    }

    ws.on('open', () => console.log(`Sarvam WS open for [${speakerName}] in meeting ${meetingId}`));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'data' && msg.data?.transcript) {
                const text = msg.data.transcript.trim();
                if (!text) return;

                const now = new Date();
                const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

                const agendaItemId = activeAgendaItems.get(meetingId) || null;

                const segment = {
                    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    meetingId, speaker: speakerName, speakerImage,
                    text, timestamp,
                    languageCode: msg.data.language_code || null,
                    sentiment: null, agendaItemId,
                };

                broadcastSegment(segment);

                if (usingMongoFlag && Transcript) {
                    Transcript.create({
                        meetingId, speaker: speakerName, speakerImage,
                        text, timestamp,
                        languageCode: msg.data.language_code || null,
                        agendaItemId,
                    }).catch(() => {});
                }
            } else if (msg.type === 'error') {
                console.error(`Sarvam error [${speakerName}]:`, msg.data?.error || msg);
            }
        } catch {}
    });

    ws.on('error', (err) => console.error(`Sarvam WS error [${speakerName}]:`, err.message));
    ws.on('close', (code, reason) => console.log(`Sarvam WS closed for [${speakerName}] code=${code} reason=${reason}`));

    return ws;
}

// ── Socket.io event handlers ─────────────────────────────────
io.on('connection', (socket) => {
    connectedUsers.set(socket.userId, socket.id);
    socket.join(`user:${socket.userId}`);

    // WebRTC Signaling
    socket.on('join_room', async ({ meetingId, name, profileImage }) => {
        if (!meetingId) return;
        socket.join(`meeting:${meetingId}`);

        if (!meetingRooms.has(meetingId)) meetingRooms.set(meetingId, new Map());
        const room = meetingRooms.get(meetingId);

        const existingPeers = [];
        for (const [sid, info] of room.entries()) {
            existingPeers.push({ socketId: sid, userId: info.userId, name: info.name, profileImage: info.profileImage });
        }

        room.set(socket.id, { userId: socket.userId, name: name || 'User', profileImage: profileImage || null });
        socket.emit('room_peers', { peers: existingPeers });
        socket.to(`meeting:${meetingId}`).emit('peer_joined', {
            socketId: socket.id, userId: socket.userId,
            name: name || 'User', profileImage: profileImage || null,
        });

        const session = transcriptionSessions.get(meetingId);
        if (session && session.active) {
            const broadcastSegment = (segment) => io.to(`meeting:${meetingId}`).emit('transcript_update', segment);
            const ws = createSarvamWS(meetingId, socket.id, name || 'User', profileImage || null, broadcastSegment);
            session.speakers.set(socket.id, { ws, name: name || 'User', image: profileImage || null });
            socket.emit('transcription_started', { meetingId });
        }
    });

    socket.on('signal', ({ to, signal }) => io.to(to).emit('signal', { from: socket.id, signal }));

    socket.on('leave_room', ({ meetingId }) => {
        if (!meetingId) return;
        socket.leave(`meeting:${meetingId}`);
        const room = meetingRooms.get(meetingId);
        if (room) { room.delete(socket.id); if (room.size === 0) meetingRooms.delete(meetingId); }
        socket.to(`meeting:${meetingId}`).emit('peer_left', { socketId: socket.id });

        const session = transcriptionSessions.get(meetingId);
        if (session && session.speakers.has(socket.id)) {
            const sp = session.speakers.get(socket.id);
            if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
            session.speakers.delete(socket.id);
        }
    });

    // Transcription Control
    socket.on('start_transcription', ({ meetingId }) => {
        if (!meetingId) return;
        const room = meetingRooms.get(meetingId);
        if (!room) return;

        const broadcastSegment = (segment) => io.to(`meeting:${meetingId}`).emit('transcript_update', segment);
        const speakers = new Map();
        for (const [sid, info] of room.entries()) {
            const ws = createSarvamWS(meetingId, sid, info.name, info.profileImage, broadcastSegment);
            speakers.set(sid, { ws, name: info.name, image: info.profileImage });
        }
        transcriptionSessions.set(meetingId, { active: true, speakers });
        io.to(`meeting:${meetingId}`).emit('transcription_started', { meetingId });
    });

    socket.on('stop_transcription', ({ meetingId }) => {
        if (!meetingId) return;
        const session = transcriptionSessions.get(meetingId);
        if (session) {
            for (const [, sp] of session.speakers) {
                if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
            }
            session.active = false;
            session.speakers.clear();
        }
        transcriptionSessions.delete(meetingId);
        io.to(`meeting:${meetingId}`).emit('transcription_stopped', { meetingId });
    });

    socket.on('audio_chunk', ({ meetingId, data }) => {
        const session = transcriptionSessions.get(meetingId);
        if (!session || !session.active) return;
        const speaker = session.speakers.get(socket.id);
        if (!speaker || !speaker.ws || speaker.ws.readyState !== WebSocket.OPEN) return;
        try {
            speaker.ws.send(JSON.stringify({ audio: { data, sample_rate: '16000', encoding: 'audio/wav' } }));
        } catch {}
    });

    // Agenda sync
    socket.on('agenda_action', async ({ meetingId, action, itemId }) => {
        if (!meetingId || !action || !itemId) return;
        try {
            if (usingMongoFlag && Agenda) {
                const agenda = await Agenda.findOne({ meetingId });
                if (!agenda) return;

                const item = agenda.items.find(i => i.id === itemId);
                if (!item) return;

                if (action === 'start') {
                    for (const i of agenda.items) {
                        if (i.status === 'active') i.status = 'paused';
                    }
                    item.status = 'active';
                    item.startedAt = new Date();
                    agenda.activeItemId = itemId;
                    activeAgendaItems.set(meetingId, itemId);
                } else if (action === 'pause') {
                    item.status = 'paused';
                    agenda.activeItemId = null;
                    activeAgendaItems.delete(meetingId);
                } else if (action === 'complete') {
                    item.status = 'completed';
                    item.completedAt = new Date();
                    if (agenda.activeItemId === itemId) {
                        agenda.activeItemId = null;
                        activeAgendaItems.delete(meetingId);
                    }
                }

                await agenda.save();
                io.to(`meeting:${meetingId}`).emit('agenda_sync', {
                    meetingId, items: agenda.items,
                    activeItemId: agenda.activeItemId,
                });
            } else {
                const items = inMemoryAgendas[meetingId];
                if (!items) return;
                const item = items.find(i => i.id === itemId);
                if (!item) return;

                if (action === 'start') {
                    items.forEach(i => { if (i.status === 'active') i.status = 'paused'; });
                    item.status = 'active';
                    activeAgendaItems.set(meetingId, itemId);
                } else if (action === 'pause') {
                    item.status = 'paused';
                    activeAgendaItems.delete(meetingId);
                } else if (action === 'complete') {
                    item.status = 'completed';
                    activeAgendaItems.delete(meetingId);
                }

                io.to(`meeting:${meetingId}`).emit('agenda_sync', {
                    meetingId, items,
                    activeItemId: activeAgendaItems.get(meetingId) || null,
                });
            }
        } catch (err) {
            console.error('agenda_action error:', err.message);
        }
    });

    // End meeting
    socket.on('end_meeting', async ({ meetingId }) => {
        if (!meetingId) return;
        try {
            if (usingMongoFlag && Meeting) {
                const meeting = await Meeting.findById(meetingId);
                if (!meeting) return;
                if (meeting.hostId.toString() !== socket.userId.toString()) return;

                meeting.status = 'completed';
                await meeting.save();

                // Auto-extract action items from transcript
                try {
                    const transcripts = await Transcript.find({ meetingId }).sort({ createdAt: 1 });
                    if (transcripts.length > 0) {
                        const fullText = transcripts.map(t => `${t.speaker}: ${t.text}`).join('\n');
                        const agenda = await Agenda.findOne({ meetingId });
                        const agendaItems = agenda ? agenda.items : [];

                        try {
                            const actions = await callAIExtractActions(fullText);
                            for (const a of actions) {
                                await ActionItem.create({
                                    meetingId, title: a.title,
                                    assigneeName: a.assignee || null,
                                    category: a.category || 'Technical',
                                    status: 'pending', deadline: a.deadline || null,
                                    source: 'ai-extracted',
                                    aiConfidence: a.confidence || null,
                                });
                            }
                        } catch (e) {
                            console.error('AI action extraction failed:', e.message);
                        }

                        try {
                            const summaries = await callAISummarize(
                                transcripts.map(t => ({ text: t.text, speaker: t.speaker, agendaItemId: t.agendaItemId })),
                                agendaItems.map(i => ({ id: i.id, title: i.title }))
                            );
                            // Store summaries — could go into a MeetingSummary model or meeting doc
                        } catch (e) {
                            console.error('AI summarization failed:', e.message);
                        }
                    }
                } catch (e) {
                    console.error('Post-meeting AI processing error:', e.message);
                }

                // Notify participants
                const participants = meeting.participants || [];
                for (const pid of participants) {
                    try {
                        const notif = await Notification.create({
                            userId: pid, type: 'meeting_summary_ready',
                            meetingId, message: `Summary ready for "${meeting.title}"`,
                        });
                        emitToUser(pid, 'notification', {
                            _id: notif._id, type: notif.type,
                            meetingId, message: notif.message,
                            read: false, createdAt: notif.createdAt,
                        });
                    } catch (e) { /* non-critical */ }
                }
            }

            io.to(`meeting:${meetingId}`).emit('meeting_ended', { meetingId });
        } catch (err) {
            console.error('end_meeting error:', err.message);
        }
    });

    socket.on('join_meeting', ({ meetingId }) => { if (meetingId) socket.join(`meeting:${meetingId}`); });
    socket.on('leave_meeting', ({ meetingId }) => { if (meetingId) socket.leave(`meeting:${meetingId}`); });

    socket.on('disconnect', () => {
        connectedUsers.delete(socket.userId);
        for (const [meetingId, room] of meetingRooms.entries()) {
            if (room.has(socket.id)) {
                room.delete(socket.id);
                io.to(`meeting:${meetingId}`).emit('peer_left', { socketId: socket.id });

                const session = transcriptionSessions.get(meetingId);
                if (session && session.speakers.has(socket.id)) {
                    const sp = session.speakers.get(socket.id);
                    if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
                    session.speakers.delete(socket.id);
                }

                if (room.size === 0) {
                    meetingRooms.delete(meetingId);
                    if (session) {
                        for (const [, sp] of session.speakers) {
                            if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
                        }
                        transcriptionSessions.delete(meetingId);
                    }
                }
            }
        }
    });
});

// ── Pre-meeting brief cron (every hour) ──────────────────────
const { generateBrief, formatBriefEmail } = require('./services/briefGenerator');

cron.schedule('0 * * * *', async () => {
    if (!usingMongoFlag || !Meeting) return;
    try {
        const now = new Date();
        const in24h = new Date(now.getTime() + 25 * 3600000);
        const in23h = new Date(now.getTime() + 23 * 3600000);

        const meetings = await Meeting.find({
            status: 'scheduled',
            confirmedDate: {
                $gte: in23h.toISOString().split('T')[0],
                $lte: in24h.toISOString().split('T')[0],
            },
        }).populate('participants', 'name email');

        for (const meeting of meetings) {
            try {
                const brief = await generateBrief(meeting, callAISummarize);
                const html = formatBriefEmail(brief, meeting._id, CLIENT_URL);
                const transport = await getMailTransporter();

                for (const p of meeting.participants) {
                    await transport.sendMail({
                        from: process.env.SMTP_FROM || '"MCMS Platform" <noreply@mcms.app>',
                        to: p.email,
                        subject: `Pre-Meeting Brief: ${meeting.title}`,
                        html,
                    });

                    try {
                        await Notification.create({
                            userId: p._id, type: 'brief_ready',
                            meetingId: meeting._id,
                            message: `Pre-meeting brief ready for "${meeting.title}"`,
                        });
                        emitToUser(p._id, 'notification', {
                            type: 'brief_ready', meetingId: meeting._id,
                            message: `Pre-meeting brief ready for "${meeting.title}"`,
                            read: false,
                        });
                    } catch (e) { /* non-critical */ }
                }
                console.log(`Brief sent for: ${meeting.title}`);
            } catch (e) {
                console.error(`Brief generation failed for ${meeting.title}:`, e.message);
            }
        }
    } catch (e) {
        console.error('Brief cron error:', e.message);
    }
});

// ── Brief on-demand endpoint ─────────────────────────────────
app.get('/api/meetings/:id/brief', protect, async (req, res) => {
    try {
        if (!usingMongoFlag || !Meeting) return res.status(400).json({ message: 'Database required' });
        const meeting = await Meeting.findById(req.params.id);
        if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
        const brief = await generateBrief(meeting, callAISummarize);
        res.json(brief);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ── Serve client build under /mcms (production) ──────────────
const CLIENT_BUILD = path.join(__dirname, '..', 'client', 'dist');
app.use('/mcms', express.static(CLIENT_BUILD));
app.get('/mcms/*path', (req, res) => {
    res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
});

// ── Start Server ─────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`MCMS Backend running at http://localhost:${PORT}`);
    console.log(`MongoDB: ${usingMongoFlag ? 'Connected' : 'Not running — users stored in-memory'}`);
});
