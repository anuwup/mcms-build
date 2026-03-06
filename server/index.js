const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');
const WebSocket = require('ws');

dotenv.config();

// ── Optional MongoDB connection ──────────────────────────────
let usingMongo = false;
let User = null;
let Meeting = null;
let Poll = null;
let Notification = null;
let RSVP = null;
let Transcript = null;
let Note = null;
try {
    const mongoose = require('mongoose');
    mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mcms_db')
        .then(() => {
            console.log('✅ MongoDB Connected');
            usingMongo = true;
        })
        .catch(err => console.log('⚠️  MongoDB not available — using in-memory store:', err.message));
    User = require('./models/User');
    Meeting = require('./models/Meeting');
    Poll = require('./models/Poll');
    Notification = require('./models/Notification');
    RSVP = require('./models/RSVP');
    Transcript = require('./models/Transcript');
    Note = require('./models/Note');
} catch (e) {
    console.log('⚠️  Mongoose not found — using in-memory store');
}

// ── In-memory fallback store ─────────────────────────────────
const inMemoryUsers = [];

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'mcms_super_secret_key';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors({
    origin: [CLIENT_URL, 'https://anupchavan.com', 'https://www.anupchavan.com'].filter(Boolean),
    credentials: true,
}));
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const recordingsDir = path.join(__dirname, 'uploads', 'recordings');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
    app.use('/mcms', express.static(clientDist, { index: false }));
    app.get(/^\/mcms\/?.*$/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const avatarStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${req.user.id}-${Date.now()}${ext}`);
    },
});
const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only image files are allowed'));
    },
});

// ── Socket.io Setup ──────────────────────────────────────────
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const connectedUsers = new Map();

io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.id;
        next();
    } catch {
        next(new Error('Invalid token'));
    }
});

// ── Sarvam AI Transcription State ─────────────────────────────
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

// Per-meeting state
const meetingTranscriptionState = new Map(); // meetingId -> { startTime, speakers: Map<speakerKey, SpeakerState> }
const meetingAudioBuffers = new Map();

// WebRTC peer tracking: meetingId -> Map<socketId, { userId, name, image }>
const meetingPeers = new Map();

const PARA_SILENCE_GAP_MS = 3000;
const PARA_MAX_CHARS = 500;

function speakerKey(meetingId, userId) { return `${meetingId}::${userId}`; }

function getSpeakerState(meetingId, userId) {
    const meeting = meetingTranscriptionState.get(meetingId);
    if (!meeting) return null;
    return meeting.speakers.get(userId) || null;
}

function openSpeakerSarvamWS(meetingId, userId, speakerName, speakerImage) {
    const meeting = meetingTranscriptionState.get(meetingId);
    if (!meeting) return null;

    const params = new URLSearchParams({
        model: 'saaras:v3',
        mode: 'transcribe',
        sample_rate: '16000',
        'language-code': 'unknown',
    });
    const url = `wss://api.sarvam.ai/speech-to-text/ws?${params}`;
    const ws = new WebSocket(url, {
        headers: { 'Api-Subscription-Key': SARVAM_API_KEY },
    });

    const state = {
        ws,
        speakerName,
        speakerImage,
        ready: false,
        pendingChunks: [],
        paraBuffer: { fragments: [], languageCode: null, startTime: null, firstTimestamp: null, flushTimer: null },
    };

    ws.on('open', () => {
        console.log(`🎙️  Sarvam WS opened for ${speakerName} in meeting ${meetingId}`);
        state.ready = true;
        for (const chunk of state.pendingChunks) {
            if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
        }
        state.pendingChunks = [];
    });

    ws.on('message', async (rawMsg) => {
        try {
            const msg = JSON.parse(rawMsg.toString());
            if (msg.type === 'data' && msg.data?.transcript) {
                const transcript = msg.data.transcript.trim();
                if (!transcript) return;
                await handleSpeakerFragment(meetingId, userId, transcript, msg.data);
            }
        } catch (err) {
            console.error(`Sarvam WS message error (${speakerName}):`, err.message);
        }
    });

    ws.on('error', (err) => {
        console.error(`Sarvam WS error (${speakerName}):`, err.message);
    });

    ws.on('close', () => {
        console.log(`🎙️  Sarvam WS closed for ${speakerName} in meeting ${meetingId}`);
    });

    meeting.speakers.set(userId, state);
    return state;
}

async function handleSpeakerFragment(meetingId, userId, transcript, sarvamData) {
    const meeting = meetingTranscriptionState.get(meetingId);
    const speaker = meeting?.speakers.get(userId);
    if (!meeting || !speaker) return;

    const elapsedSec = (Date.now() - meeting.startTime) / 1000;
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const langCode = sarvamData.language_code || null;

    const buf = speaker.paraBuffer;
    const langChanged = buf.languageCode && langCode && buf.languageCode !== langCode;
    const totalChars = buf.fragments.join(' ').length;
    const overMaxLen = totalChars + transcript.length > PARA_MAX_CHARS;

    if (buf.fragments.length > 0 && (langChanged || overMaxLen)) {
        await flushSpeakerParagraph(meetingId, userId);
    }

    if (buf.fragments.length === 0) {
        buf.languageCode = langCode;
        buf.startTime = sarvamData.metrics?.audio_duration ? elapsedSec - sarvamData.metrics.audio_duration : elapsedSec;
        buf.firstTimestamp = timestamp;
    }
    buf.fragments.push(transcript);

    if (buf.flushTimer) clearTimeout(buf.flushTimer);
    buf.flushTimer = setTimeout(() => flushSpeakerParagraph(meetingId, userId), PARA_SILENCE_GAP_MS);
}

async function flushSpeakerParagraph(meetingId, userId) {
    const meeting = meetingTranscriptionState.get(meetingId);
    const speaker = meeting?.speakers.get(userId);
    if (!speaker) return;

    const buf = speaker.paraBuffer;
    if (buf.fragments.length === 0) return;

    const text = buf.fragments.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) { buf.fragments = []; return; }

    const elapsedSec = (Date.now() - meeting.startTime) / 1000;

    const segment = {
        meetingId,
        speaker: speaker.speakerName,
        speakerImage: speaker.speakerImage,
        text,
        timestamp: buf.firstTimestamp,
        startTime: buf.startTime,
        endTime: elapsedSec,
        sentiment: null,
        languageCode: buf.languageCode,
    };

    if (usingMongo && Transcript) {
        const doc = await Transcript.create(segment);
        segment._id = doc._id;
        segment.id = doc._id.toString();
    } else {
        segment.id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    io.to(`meeting:${meetingId}`).emit('transcript_update', segment);

    buf.fragments = [];
    buf.languageCode = null;
    buf.startTime = null;
    buf.firstTimestamp = null;
    if (buf.flushTimer) { clearTimeout(buf.flushTimer); buf.flushTimer = null; }
}

async function closeSpeakerSarvam(meetingId, userId) {
    const meeting = meetingTranscriptionState.get(meetingId);
    const speaker = meeting?.speakers.get(userId);
    if (!speaker) return;

    await flushSpeakerParagraph(meetingId, userId);
    if (speaker.paraBuffer.flushTimer) clearTimeout(speaker.paraBuffer.flushTimer);

    const ws = speaker.ws;
    try {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'flush' }));
        }
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
        }, 2000);
    } catch (err) {
        console.error('Error closing speaker Sarvam WS:', err.message);
    }
    meeting.speakers.delete(userId);
}

async function closeAllSpeakerConnections(meetingId) {
    const meeting = meetingTranscriptionState.get(meetingId);
    if (!meeting) return;
    const userIds = [...meeting.speakers.keys()];
    for (const uid of userIds) {
        await closeSpeakerSarvam(meetingId, uid);
    }
    meetingTranscriptionState.delete(meetingId);
}

function saveAudioBuffer(meetingId) {
    const chunks = meetingAudioBuffers.get(meetingId);
    if (!chunks || chunks.length === 0) return null;
    const filePath = path.join(recordingsDir, `${meetingId}.wav`);
    const combined = Buffer.concat(chunks);
    fs.writeFileSync(filePath, combined);
    meetingAudioBuffers.delete(meetingId);
    return filePath;
}

io.on('connection', (socket) => {
    connectedUsers.set(socket.userId, socket.id);
    socket.join(`user:${socket.userId}`);

    socket.on('join_meeting', ({ meetingId }) => {
        if (meetingId) {
            socket.join(`meeting:${meetingId}`);
            socket.currentMeetingId = meetingId;
        }
    });

    socket.on('leave_meeting', ({ meetingId }) => {
        if (meetingId) {
            socket.leave(`meeting:${meetingId}`);
            socket.currentMeetingId = null;
        }
    });

    socket.on('start_transcription', ({ meetingId }) => {
        if (!SARVAM_API_KEY) {
            socket.emit('transcription_error', { message: 'Sarvam API key not configured' });
            return;
        }
        if (meetingTranscriptionState.has(meetingId)) {
            socket.emit('transcription_error', { message: 'Transcription already active for this meeting' });
            return;
        }

        meetingTranscriptionState.set(meetingId, { startTime: Date.now(), speakers: new Map() });
        meetingAudioBuffers.set(meetingId, []);

        io.to(`meeting:${meetingId}`).emit('transcription_started', { meetingId });
        console.log(`🎙️  Transcription started for meeting ${meetingId} by user ${socket.userId}`);
    });

    socket.on('join_transcription', async ({ meetingId, speakerName, speakerImage }) => {
        const meeting = meetingTranscriptionState.get(meetingId);
        if (!meeting) return;
        if (meeting.speakers.has(socket.userId)) {
            socket.emit('transcription_ready', { meetingId });
            return;
        }

        const name = speakerName || 'Speaker';
        const image = speakerImage || null;
        if (!image && usingMongo && User) {
            try {
                const u = await User.findById(socket.userId).select('name profileImage');
                if (u) {
                    openSpeakerSarvamWS(meetingId, socket.userId, u.name || name, u.profileImage || image);
                    socket.emit('transcription_ready', { meetingId });
                    console.log(`🎙️  ${u.name} joined transcription for meeting ${meetingId}`);
                    return;
                }
            } catch (_) {}
        }
        openSpeakerSarvamWS(meetingId, socket.userId, name, image);
        socket.emit('transcription_ready', { meetingId });
        console.log(`🎙️  ${name} joined transcription for meeting ${meetingId}`);
    });

    socket.on('audio_chunk', ({ meetingId, data }) => {
        if (!meetingId || !data) return;

        const buffer = Buffer.from(data, 'base64');
        const chunks = meetingAudioBuffers.get(meetingId);
        if (chunks) chunks.push(buffer);

        const speaker = getSpeakerState(meetingId, socket.userId);
        if (!speaker) return;

        const payload = JSON.stringify({
            audio: { data, sample_rate: '16000', encoding: 'audio/wav' },
        });

        if (speaker.ready && speaker.ws.readyState === WebSocket.OPEN) {
            speaker.ws.send(payload);
        } else {
            speaker.pendingChunks.push(payload);
        }
    });

    socket.on('leave_transcription', async ({ meetingId }) => {
        await closeSpeakerSarvam(meetingId, socket.userId);
    });

    socket.on('stop_transcription', async ({ meetingId }) => {
        await closeAllSpeakerConnections(meetingId);
        const audioPath = saveAudioBuffer(meetingId);

        io.to(`meeting:${meetingId}`).emit('transcription_stopped', {
            meetingId,
            hasRecording: !!audioPath,
        });
        console.log(`🎙️  Transcription stopped for meeting ${meetingId}`);
    });

    // ── WebRTC Signaling ──────────────────────────────────────
    socket.on('webrtc_join', async ({ meetingId, name, image }) => {
        if (!meetingId) return;
        if (!meetingPeers.has(meetingId)) meetingPeers.set(meetingId, new Map());
        const room = meetingPeers.get(meetingId);

        let peerName = name || 'User';
        let peerImage = image || null;
        if (usingMongo && User && (!name || !image)) {
            try {
                const u = await User.findById(socket.userId).select('name profileImage');
                if (u) { peerName = u.name || peerName; peerImage = u.profileImage || peerImage; }
            } catch (_) {}
        }

        const existingPeers = [];
        for (const [sid, info] of room) {
            existingPeers.push({ socketId: sid, userId: info.userId, name: info.name, image: info.image });
        }
        socket.emit('webrtc_peers', { peers: existingPeers });

        room.set(socket.id, { userId: socket.userId, name: peerName, image: peerImage });

        socket.to(`meeting:${meetingId}`).emit('webrtc_peer_joined', {
            socketId: socket.id,
            userId: socket.userId,
            name: peerName,
            image: peerImage,
        });
    });

    socket.on('webrtc_offer', ({ to, sdp }) => {
        io.to(to).emit('webrtc_offer', { from: socket.id, sdp });
    });

    socket.on('webrtc_answer', ({ to, sdp }) => {
        io.to(to).emit('webrtc_answer', { from: socket.id, sdp });
    });

    socket.on('webrtc_ice_candidate', ({ to, candidate }) => {
        io.to(to).emit('webrtc_ice_candidate', { from: socket.id, candidate });
    });

    socket.on('webrtc_toggle', ({ meetingId, kind, enabled }) => {
        if (!meetingId) return;
        socket.to(`meeting:${meetingId}`).emit('webrtc_peer_toggle', {
            socketId: socket.id, kind, enabled,
        });
    });

    socket.on('webrtc_leave', ({ meetingId }) => {
        if (!meetingId) return;
        const room = meetingPeers.get(meetingId);
        if (room) {
            room.delete(socket.id);
            if (room.size === 0) meetingPeers.delete(meetingId);
        }
        socket.to(`meeting:${meetingId}`).emit('webrtc_peer_left', { socketId: socket.id });
    });

    socket.on('disconnect', () => {
        connectedUsers.delete(socket.userId);
        for (const [meetingId, room] of meetingPeers) {
            if (room.has(socket.id)) {
                room.delete(socket.id);
                io.to(`meeting:${meetingId}`).emit('webrtc_peer_left', { socketId: socket.id });
                if (room.size === 0) meetingPeers.delete(meetingId);
            }
        }
    });
});

function emitToUser(userId, event, data) {
    io.to(`user:${userId.toString()}`).emit(event, data);
}

// ── Email Setup (Nodemailer) ─────────────────────────────────
let transporter = null;

async function getMailTransporter() {
    if (transporter) return transporter;

    if (process.env.SENDGRID_API_KEY) {
        transporter = nodemailer.createTransport({
            host: 'smtp.sendgrid.net',
            port: 587,
            secure: false,
            auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
        });
        console.log('📧 Using SendGrid for email delivery');
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
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: { user: testAccount.user, pass: testAccount.pass },
        });
        console.log('📧 Using Ethereal test email — preview URLs in console');
    }
    return transporter;
}

function generateRsvpToken(meetingId, userId) {
    return jwt.sign({ meetingId: meetingId.toString(), userId: userId.toString(), purpose: 'rsvp' }, JWT_SECRET, { expiresIn: '30d' });
}

async function sendRsvpEmail(meeting, user, slot) {
    try {
        const transport = await getMailTransporter();
        const token = generateRsvpToken(meeting._id, user._id);
        const baseUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

        const makeLink = (response) =>
            `${baseUrl}/api/rsvp/${meeting._id}/respond?token=${token}&response=${response}`;

        const dateStr = slot ? `${slot.date} at ${slot.time}` : `${meeting.date} at ${meeting.time}`;
        const meetingLink = `${CLIENT_URL}/?meeting=${meeting._id}`;
        const meetingLinkSection = meeting.modality !== 'Offline'
            ? `<p style="margin:16px 0"><strong>Meeting Link:</strong> <a href="${meetingLink}" style="color:#6366f1">${meetingLink}</a></p>`
            : '';
        const locationSection = meeting.location
            ? `<p><strong>Location:</strong> ${meeting.location}</p>`
            : '';

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a2e">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:20px">Meeting Invitation</h1>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 16px;color:#1a1a2e">${meeting.title}</h2>
    <p><strong>Date/Time:</strong> ${dateStr}</p>
    <p><strong>Type:</strong> ${meeting.modality}</p>
    ${locationSection}
    ${meetingLinkSection}
    <p style="margin:24px 0 12px;font-weight:600">Will you attend?</p>
    <div style="display:flex;gap:12px">
      <a href="${makeLink('yes')}" style="display:inline-block;padding:10px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Yes</a>
      <a href="${makeLink('no')}" style="display:inline-block;padding:10px 28px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">No</a>
      <a href="${makeLink('maybe')}" style="display:inline-block;padding:10px 28px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Maybe</a>
    </div>
  </div>
</body>
</html>`;

        const info = await transport.sendMail({
            from: process.env.SMTP_FROM || '"MCMS Platform" <noreply@mcms.app>',
            to: user.email,
            subject: `Meeting Invitation: ${meeting.title}`,
            html,
        });

        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) console.log(`📧 Preview RSVP email for ${user.email}: ${previewUrl}`);
    } catch (err) {
        console.error('Failed to send RSVP email:', err.message);
    }
}

// ─── Auth Helpers ─────────────────────────────────────────────
const generateToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
const { protect } = require('./middleware/auth');

// ─── REGISTER ─────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Please provide name, email, and password' });
        }

        if (usingMongo && User) {
            let existing = await User.findOne({ email });
            if (existing) return res.status(400).json({ message: 'User already exists' });
            const user = await User.create({ name, email, password });
            return res.status(201).json({ _id: user._id, name: user.name, email: user.email, profileImage: user.profileImage, isAdmin: user.isAdmin, token: generateToken(user._id) });
        } else {
            const existing = inMemoryUsers.find(u => u.email === email.toLowerCase());
            if (existing) return res.status(400).json({ message: 'User already exists' });
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            const userId = `user_${Date.now()}`;
            const user = { _id: userId, name, email: email.toLowerCase(), password: hashedPassword };
            inMemoryUsers.push(user);
            return res.status(201).json({ _id: user._id, name: user.name, email: user.email, token: generateToken(user._id) });
        }
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── LOGIN ────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Please provide email and password' });
        }

        if (usingMongo && User) {
            const user = await User.findOne({ email });
            if (!user) return res.status(401).json({ message: 'Invalid email or password' });
            const isMatch = await user.matchPassword(password);
            if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });
            return res.json({ _id: user._id, name: user.name, email: user.email, profileImage: user.profileImage, isAdmin: user.isAdmin, token: generateToken(user._id) });
        } else {
            const user = inMemoryUsers.find(u => u.email === email.toLowerCase());
            if (!user) return res.status(401).json({ message: 'Invalid email or password' });
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });
            return res.json({ _id: user._id, name: user.name, email: user.email, token: generateToken(user._id) });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── ME ───────────────────────────────────────────────────────
app.get('/api/auth/me', protect, async (req, res) => {
    try {
        if (usingMongo && User) {
            const user = await User.findById(req.user.id).select('-password');
            return res.json(user);
        }
        const user = inMemoryUsers.find(u => u._id === req.user.id);
        res.json(user ? { _id: user._id, name: user.name, email: user.email } : null);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// ─── USER SEARCH (for participant picker) ─────────────────────
app.get('/api/users/search', protect, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();

        if (usingMongo && User) {
            let filter = { _id: { $ne: req.user.id } };
            if (q.length >= 1) {
                const regex = new RegExp(q, 'i');
                filter = { $and: [filter, { $or: [{ name: regex }, { email: regex }] }] };
            }
            const users = await User.find(filter).select('name email profileImage').limit(10);
            return res.json(users);
        }

        if (!q) {
            const results = inMemoryUsers
                .filter(u => u._id !== req.user.id)
                .slice(0, 10)
                .map(u => ({ _id: u._id, name: u.name, email: u.email, profileImage: u.profileImage || null }));
            return res.json(results);
        }
        const lower = q.toLowerCase();
        const results = inMemoryUsers
            .filter(u => u._id !== req.user.id && (u.name.toLowerCase().includes(lower) || u.email.includes(lower)))
            .slice(0, 10)
            .map(u => ({ _id: u._id, name: u.name, email: u.email, profileImage: u.profileImage || null }));
        res.json(results);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── PROFILE ROUTES ───────────────────────────────────────────
app.put('/api/profile/name', protect, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });

        if (usingMongo && User) {
            const user = await User.findByIdAndUpdate(req.user.id, { name: name.trim() }, { new: true }).select('-password');
            return res.json({ name: user.name, email: user.email, profileImage: user.profileImage, isAdmin: user.isAdmin });
        }
        const user = inMemoryUsers.find(u => u._id === req.user.id);
        if (user) user.name = name.trim();
        res.json({ name: user.name, email: user.email });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.put('/api/profile/email', protect, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.trim()) return res.status(400).json({ message: 'Email is required' });

        if (usingMongo && User) {
            const existing = await User.findOne({ email: email.toLowerCase(), _id: { $ne: req.user.id } });
            if (existing) return res.status(400).json({ message: 'Email is already in use' });
            const user = await User.findByIdAndUpdate(req.user.id, { email: email.toLowerCase().trim() }, { new: true }).select('-password');
            return res.json({ name: user.name, email: user.email, profileImage: user.profileImage, isAdmin: user.isAdmin });
        }
        const existing = inMemoryUsers.find(u => u.email === email.toLowerCase() && u._id !== req.user.id);
        if (existing) return res.status(400).json({ message: 'Email is already in use' });
        const user = inMemoryUsers.find(u => u._id === req.user.id);
        if (user) user.email = email.toLowerCase().trim();
        res.json({ name: user.name, email: user.email });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.put('/api/profile/password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Both current and new passwords are required' });
        if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });

        if (usingMongo && User) {
            const user = await User.findById(req.user.id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            const isMatch = await user.matchPassword(currentPassword);
            if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect' });
            user.password = newPassword;
            await user.save();
            return res.json({ message: 'Password updated successfully' });
        }
        const user = inMemoryUsers.find(u => u._id === req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect' });
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/profile/avatar', protect, (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
        if (err) return res.status(400).json({ message: err.message });
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
        const imageUrl = `/uploads/avatars/${req.file.filename}`;

        if (usingMongo && User) {
            const user = await User.findById(req.user.id);
            if (user.profileImage) {
                const oldPath = path.join(__dirname, user.profileImage);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            user.profileImage = imageUrl;
            await user.save();
            return res.json({ profileImage: imageUrl });
        }
        const user = inMemoryUsers.find(u => u._id === req.user.id);
        if (user) user.profileImage = imageUrl;
        res.json({ profileImage: imageUrl });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.delete('/api/profile/avatar', protect, async (req, res) => {
    try {
        if (usingMongo && User) {
            const user = await User.findById(req.user.id);
            if (user.profileImage) {
                const oldPath = path.join(__dirname, user.profileImage);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            user.profileImage = null;
            await user.save();
            return res.json({ profileImage: null });
        }
        const user = inMemoryUsers.find(u => u._id === req.user.id);
        if (user) user.profileImage = null;
        res.json({ profileImage: null });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.delete('/api/profile/account', protect, async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ message: 'Password is required to delete account' });

        if (usingMongo && User) {
            const user = await User.findById(req.user.id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            const isMatch = await user.matchPassword(password);
            if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });

            if (user.profileImage) {
                const oldPath = path.join(__dirname, user.profileImage);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            await User.findByIdAndDelete(req.user.id);
            return res.json({ message: 'Account deleted successfully' });
        }
        const idx = inMemoryUsers.findIndex(u => u._id === req.user.id);
        if (idx === -1) return res.status(404).json({ message: 'User not found' });
        const isMatch = await bcrypt.compare(password, inMemoryUsers[idx].password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });
        inMemoryUsers.splice(idx, 1);
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── Mock Data ────────────────────────────────────────────────
const meetings = [
    {
        id: 'mtg-001', title: 'Sprint Planning — Q1 Review', modality: 'Online',
        date: '2026-03-05', time: '10:00 AM', host: 'Dr. Sharma',
        participants: ['Ravi K.', 'Ananya P.', 'Kiran M.', 'Priya S.'], status: 'scheduled',
    },
    {
        id: 'mtg-002', title: 'CS301 — Data Structures Lecture', modality: 'Hybrid',
        date: '2026-03-06', time: '2:00 PM', host: 'Prof. Reddy',
        participants: ['60 students'], status: 'scheduled',
    },
    {
        id: 'mtg-003', title: 'Frontend Candidate Evaluation', modality: 'Online',
        date: '2026-02-28', time: '3:00 PM', host: 'HR Team',
        participants: ['Priya S.', 'Ravi K.'], status: 'completed',
    },
];

const agendas = {
    'mtg-001': [
        { id: 'ag-1', title: 'Review Previous Sprint Goals', duration: 10, status: 'active', notes: '' },
        { id: 'ag-2', title: 'Demo: New Dashboard Module', duration: 15, status: 'pending', notes: '' },
        { id: 'ag-3', title: 'Plan next sprint tasks', duration: 20, status: 'pending', notes: '' },
    ],
};

const transcripts = {
    'mtg-001': [
        { id: 't-1', speaker: 'Dr. Sharma', text: "Let's start with the sprint review.", timestamp: '10:01:12', sentiment: 'neutral', agendaId: 'ag-1' },
        { id: 't-2', speaker: 'Ravi K.', text: 'I completed the QR module integration.', timestamp: '10:03:45', sentiment: 'positive', agendaId: 'ag-1' },
    ],
};

const actionItems = {
    'mtg-001': [
        { id: 'ai-1', title: 'Complete QR module', assignee: 'Ananya P.', category: 'Technical', status: 'in-progress', deadline: '2026-03-08', agendaId: 'ag-1' },
        { id: 'ai-2', title: 'Write unit tests for agenda panel', assignee: 'Kiran M.', category: 'Technical', status: 'pending', deadline: '2026-03-09', agendaId: 'ag-2' },
    ],
};

const dashboardStats = {
    user: 'Kiran M.', role: 'Host', streak: 7, totalMeetings: 42,
    totalHours: 63.5, punctualityRate: 94, tasksCompleted: 28, tasksTotal: 32,
    badges: [
        { name: 'Action Hero', icon: '🏆', description: '90%+ tasks on time' },
        { name: '7-Day Streak', icon: '🔥', description: '7 consecutive on-time meetings' },
    ],
    weeklyHeatmap: [
        { day: 'Mon', hours: 3.5 }, { day: 'Tue', hours: 5.0 }, { day: 'Wed', hours: 2.0 },
        { day: 'Thu', hours: 4.5 }, { day: 'Fri', hours: 3.0 },
    ],
    monthlyAttendance: [{ week: 'W1', attended: 5, total: 6 }, { week: 'W2', attended: 6, total: 6 }],
    sentimentProfile: { positive: 62, neutral: 30, negative: 8 },
    speakingTime: 18.5, avgMeetingDuration: 45,
};

// ─── Protected API Routes ────────────────────────────────────
app.get('/api/meetings', protect, async (req, res) => {
    try {
        if (usingMongo && Meeting) {
            const dbMeetings = await Meeting.find({}).sort({ createdAt: -1 }).populate('participants', 'name email profileImage');
            const formatted = dbMeetings.map(m => ({
                id: m._id,
                title: m.title,
                modality: m.modality,
                date: m.confirmedDate || m.date,
                time: m.confirmedTime || m.time,
                location: m.location,
                host: m.host || 'Unknown',
                hostId: m.hostId,
                participants: m.participants,
                status: m.status,
                pollId: m.pollId,
            }));
            return res.json([...formatted, ...meetings]);
        }
        res.json(meetings);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/meetings', protect, async (req, res) => {
    try {
        const { title, modality, timeSlots, location, participants } = req.body;

        let hostName = 'You';
        if (usingMongo && User) {
            const userDoc = await User.findById(req.user.id);
            if (userDoc) hostName = userDoc.name;
        }

        const isSingleSlot = timeSlots && timeSlots.length === 1;

        if (usingMongo && Meeting) {
            const newMeeting = await Meeting.create({
                title,
                modality,
                location: location || null,
                date: isSingleSlot ? timeSlots[0].date : null,
                time: isSingleSlot ? timeSlots[0].time : null,
                confirmedDate: isSingleSlot ? timeSlots[0].date : null,
                confirmedTime: isSingleSlot ? timeSlots[0].time : null,
                host: hostName,
                hostId: req.user.id,
                participants: participants || [],
                status: isSingleSlot ? 'scheduled' : 'pending_poll',
            });

            let pollData = null;

            if (timeSlots && timeSlots.length > 1) {
                const poll = await Poll.create({
                    meetingId: newMeeting._id,
                    slots: timeSlots.map(s => ({ date: s.date, time: s.time, votes: [] })),
                });
                newMeeting.pollId = poll._id;
                await newMeeting.save();
                pollData = { _id: poll._id, slots: poll.slots, status: poll.status };

                if (participants && participants.length > 0) {
                    for (const pid of participants) {
                        const notif = await Notification.create({
                            userId: pid,
                            type: 'poll_invite',
                            meetingId: newMeeting._id,
                            message: `You've been invited to vote on time slots for "${title}"`,
                        });
                        emitToUser(pid, 'notification', {
                            _id: notif._id,
                            type: notif.type,
                            meetingId: newMeeting._id,
                            meetingTitle: title,
                            message: notif.message,
                            read: false,
                            createdAt: notif.createdAt,
                        });
                    }
                }
            }

            if (isSingleSlot && participants && participants.length > 0) {
                const participantDocs = await User.find({ _id: { $in: participants } });
                for (const p of participantDocs) {
                    sendRsvpEmail(newMeeting, p, timeSlots[0]);
                    const notif = await Notification.create({
                        userId: p._id,
                        type: 'meeting_confirmed',
                        meetingId: newMeeting._id,
                        message: `You're invited to "${title}" on ${timeSlots[0].date} at ${timeSlots[0].time}`,
                    });
                    emitToUser(p._id, 'notification', {
                        _id: notif._id,
                        type: notif.type,
                        meetingId: newMeeting._id,
                        meetingTitle: title,
                        message: notif.message,
                        read: false,
                        createdAt: notif.createdAt,
                    });
                }
            }

            const populated = await Meeting.findById(newMeeting._id).populate('participants', 'name email profileImage');

            return res.status(201).json({
                id: populated._id,
                title: populated.title,
                modality: populated.modality,
                date: populated.confirmedDate || populated.date,
                time: populated.confirmedTime || populated.time,
                location: populated.location,
                host: populated.host,
                hostId: populated.hostId,
                participants: populated.participants,
                status: populated.status,
                pollId: populated.pollId,
                poll: pollData,
            });
        }

        // In-memory fallback
        const slot = isSingleSlot ? timeSlots[0] : null;
        const newMeeting = {
            id: `mtg-${Date.now()}`, title, modality,
            date: slot?.date, time: slot?.time, location,
            host: hostName, participants: participants || [],
            status: isSingleSlot ? 'scheduled' : 'pending_poll',
        };
        meetings.push(newMeeting);
        res.status(201).json(newMeeting);
    } catch (error) {
        console.error('Create meeting error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── POLL ROUTES ──────────────────────────────────────────────
app.get('/api/polls/:meetingId', protect, async (req, res) => {
    try {
        if (!usingMongo || !Poll) return res.json(null);
        const poll = await Poll.findOne({ meetingId: req.params.meetingId });
        if (!poll) return res.status(404).json({ message: 'Poll not found' });

        const meeting = await Meeting.findById(req.params.meetingId).select('title modality');
        res.json({ ...poll.toObject(), meetingId: req.params.meetingId, meetingTitle: meeting?.title, modality: meeting?.modality });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/polls/:pollId/vote', protect, async (req, res) => {
    try {
        if (!usingMongo || !Poll) return res.status(400).json({ message: 'Database required' });

        const { slotIndex } = req.body;
        const poll = await Poll.findById(req.params.pollId);
        if (!poll) return res.status(404).json({ message: 'Poll not found' });
        if (poll.status === 'resolved') return res.status(400).json({ message: 'Poll already resolved' });

        const userId = req.user.id;

        // Remove previous vote from any slot
        for (const slot of poll.slots) {
            slot.votes = slot.votes.filter(v => v.toString() !== userId.toString());
        }

        if (slotIndex < 0 || slotIndex >= poll.slots.length) {
            return res.status(400).json({ message: 'Invalid slot index' });
        }

        poll.slots[slotIndex].votes.push(userId);
        await poll.save();

        const meeting = await Meeting.findById(poll.meetingId).populate('participants', 'name email');
        if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

        // +1 for host
        const totalVoters = meeting.participants.length + 1;
        const majority = Math.ceil(totalVoters / 2);

        let resolved = false;
        for (let i = 0; i < poll.slots.length; i++) {
            if (poll.slots[i].votes.length >= majority) {
                poll.status = 'resolved';
                poll.resolvedSlot = i;
                await poll.save();

                const winSlot = poll.slots[i];
                meeting.confirmedDate = winSlot.date;
                meeting.confirmedTime = winSlot.time;
                meeting.date = winSlot.date;
                meeting.time = winSlot.time;
                meeting.status = 'scheduled';
                await meeting.save();

                // Send RSVP emails and notifications to all participants
                for (const p of meeting.participants) {
                    sendRsvpEmail(meeting, p, winSlot);
                    const notif = await Notification.create({
                        userId: p._id,
                        type: 'meeting_confirmed',
                        meetingId: meeting._id,
                        message: `"${meeting.title}" is confirmed for ${winSlot.date} at ${winSlot.time}`,
                    });
                    emitToUser(p._id, 'notification', {
                        _id: notif._id,
                        type: notif.type,
                        meetingId: meeting._id,
                        meetingTitle: meeting.title,
                        message: notif.message,
                        read: false,
                        createdAt: notif.createdAt,
                    });
                }

                // Notify host too
                const hostNotif = await Notification.create({
                    userId: meeting.hostId,
                    type: 'meeting_confirmed',
                    meetingId: meeting._id,
                    message: `Your meeting "${meeting.title}" is confirmed for ${winSlot.date} at ${winSlot.time}`,
                });
                emitToUser(meeting.hostId, 'notification', {
                    _id: hostNotif._id,
                    type: hostNotif.type,
                    meetingId: meeting._id,
                    meetingTitle: meeting.title,
                    message: hostNotif.message,
                    read: false,
                    createdAt: hostNotif.createdAt,
                });

                resolved = true;
                break;
            }
        }

        // Broadcast updated poll to all interested users
        const allUserIds = [meeting.hostId.toString(), ...meeting.participants.map(p => p._id.toString())];
        for (const uid of allUserIds) {
            emitToUser(uid, 'poll_updated', {
                pollId: poll._id,
                meetingId: meeting._id,
                slots: poll.slots,
                status: poll.status,
                resolvedSlot: poll.resolvedSlot,
                resolved,
            });
        }

        res.json({
            poll: poll.toObject(),
            resolved,
            meeting: resolved ? {
                id: meeting._id,
                confirmedDate: meeting.confirmedDate,
                confirmedTime: meeting.confirmedTime,
            } : null,
        });
    } catch (error) {
        console.error('Vote error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── NOTIFICATION ROUTES ──────────────────────────────────────
app.get('/api/notifications', protect, async (req, res) => {
    try {
        if (!usingMongo || !Notification) return res.json([]);
        const notifs = await Notification.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('meetingId', 'title');
        res.json(notifs);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.patch('/api/notifications/:id/read', protect, async (req, res) => {
    try {
        if (!usingMongo || !Notification) return res.json({ success: true });
        await Notification.findByIdAndUpdate(req.params.id, { read: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.patch('/api/notifications/read-all', protect, async (req, res) => {
    try {
        if (!usingMongo || !Notification) return res.json({ success: true });
        await Notification.updateMany({ userId: req.user.id, read: false }, { read: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── RSVP ROUTES ──────────────────────────────────────────────
app.get('/api/rsvp/:meetingId', protect, async (req, res) => {
    try {
        if (!usingMongo || !RSVP) return res.json([]);
        const rsvps = await RSVP.find({ meetingId: req.params.meetingId }).populate('userId', 'name email');
        res.json(rsvps);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/rsvp/:meetingId', protect, async (req, res) => {
    try {
        if (!usingMongo || !RSVP) return res.status(400).json({ message: 'Database required' });

        const { response } = req.body;
        if (!['yes', 'no', 'maybe'].includes(response)) {
            return res.status(400).json({ message: 'Invalid response' });
        }

        const rsvp = await RSVP.findOneAndUpdate(
            { meetingId: req.params.meetingId, userId: req.user.id },
            { response, respondedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json(rsvp);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Token-based RSVP from email — no auth required
app.get('/api/rsvp/:meetingId/respond', async (req, res) => {
    try {
        const { token, response } = req.query;
        if (!token || !response || !['yes', 'no', 'maybe'].includes(response)) {
            return res.status(400).send(rsvpPage('Invalid link', '', response));
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.purpose !== 'rsvp' || decoded.meetingId !== req.params.meetingId) {
            return res.status(400).send(rsvpPage('Invalid or expired link', '', response));
        }

        if (usingMongo && RSVP) {
            await RSVP.findOneAndUpdate(
                { meetingId: req.params.meetingId, userId: decoded.userId },
                { response, respondedAt: new Date() },
                { upsert: true, new: true }
            );
        }

        const meeting = usingMongo && Meeting ? await Meeting.findById(req.params.meetingId) : null;
        const title = meeting ? meeting.title : 'Meeting';
        res.send(rsvpPage(`Your response "${response}" has been recorded for`, title, response));
    } catch (error) {
        res.status(400).send(rsvpPage('This link has expired or is invalid', '', ''));
    }
});

function rsvpPage(message, meetingTitle, response) {
    const colorMap = { yes: '#22c55e', no: '#ef4444', maybe: '#f59e0b' };
    const accent = colorMap[response] || '#6366f1';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RSVP — MCMS</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f3f4f6">
<div style="background:#fff;padding:40px;border-radius:16px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:420px">
  <div style="width:56px;height:56px;border-radius:50%;background:${accent};margin:0 auto 20px;display:flex;align-items:center;justify-content:center">
    <span style="color:#fff;font-size:24px">${response === 'yes' ? '✓' : response === 'no' ? '✗' : '?'}</span>
  </div>
  <h2 style="margin:0 0 8px;color:#1a1a2e">${message}</h2>
  ${meetingTitle ? `<p style="color:#6366f1;font-weight:600;font-size:18px">${meetingTitle}</p>` : ''}
  <p style="color:#6b7280;margin-top:20px">You can close this tab.</p>
</div></body></html>`;
}

// ─── TRANSCRIPTION ROUTES ─────────────────────────────────────
app.get('/api/transcript/:meetingId', protect, async (req, res) => {
    try {
        if (usingMongo && Transcript) {
            const docs = await Transcript.find({ meetingId: req.params.meetingId })
                .sort({ startTime: 1, createdAt: 1 });
            const formatted = docs.map(d => ({
                id: d._id,
                speaker: d.speaker,
                speakerImage: d.speakerImage || null,
                text: d.text,
                timestamp: d.timestamp,
                startTime: d.startTime,
                endTime: d.endTime,
                sentiment: d.sentiment,
                agendaId: d.agendaItemId,
                languageCode: d.languageCode,
            }));
            return res.json(formatted);
        }
        res.json(transcripts[req.params.meetingId] || []);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/transcription/batch/:meetingId', protect, async (req, res) => {
    try {
        if (!SARVAM_API_KEY) {
            return res.status(400).json({ message: 'Sarvam API key not configured' });
        }
        if (!usingMongo || !Transcript || !Meeting) {
            return res.status(400).json({ message: 'Database required for batch transcription' });
        }

        const meeting = await Meeting.findById(req.params.meetingId);
        if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
        if (meeting.hostId.toString() !== req.user.id.toString()) {
            return res.status(403).json({ message: 'Only the host can trigger batch transcription' });
        }

        const audioPath = path.join(recordingsDir, `${req.params.meetingId}.wav`);
        if (!fs.existsSync(audioPath)) {
            return res.status(404).json({ message: 'No recording found for this meeting' });
        }

        const { numSpeakers } = req.body;
        const { SarvamAIClient } = require('sarvamai');
        const sarvamClient = new SarvamAIClient({ apiSubscriptionKey: SARVAM_API_KEY });

        const job = await sarvamClient.speechToTextJob.createJob({
            model: 'saaras:v3',
            mode: 'transcribe',
            languageCode: 'unknown',
            withDiarization: true,
            numSpeakers: numSpeakers || 4,
        });

        await job.uploadFiles([audioPath]);
        await job.start();
        await job.waitUntilComplete();

        const outputDir = path.join(recordingsDir, `batch-${req.params.meetingId}`);
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        await job.downloadOutputs(outputDir);

        const outputFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));
        if (outputFiles.length === 0) {
            return res.status(500).json({ message: 'Batch processing returned no results' });
        }

        const result = JSON.parse(fs.readFileSync(path.join(outputDir, outputFiles[0]), 'utf-8'));

        await Transcript.deleteMany({ meetingId: req.params.meetingId });

        const entries = result.diarized_transcript?.entries || [];
        const newDocs = [];
        for (const entry of entries) {
            const now = new Date();
            const doc = await Transcript.create({
                meetingId: req.params.meetingId,
                speaker: `Speaker ${parseInt(entry.speaker_id, 10) + 1}`,
                text: entry.transcript,
                timestamp: new Date(entry.start_time_seconds * 1000).toISOString().slice(11, 19),
                startTime: entry.start_time_seconds,
                endTime: entry.end_time_seconds,
                languageCode: result.language_code || null,
            });
            newDocs.push(doc);
        }

        io.to(`meeting:${req.params.meetingId}`).emit('transcript_replaced', {
            meetingId: req.params.meetingId,
        });

        res.json({
            message: 'Batch diarization complete',
            totalSegments: newDocs.length,
            speakers: [...new Set(entries.map(e => e.speaker_id))].length,
        });
    } catch (error) {
        console.error('Batch transcription error:', error);
        res.status(500).json({ message: 'Batch transcription failed', error: error.message });
    }
});

// ─── Existing data routes ─────────────────────────────────────
app.get('/api/agenda/:meetingId', protect, (req, res) => res.json(agendas[req.params.meetingId] || []));
app.get('/api/action-items/:meetingId', protect, (req, res) => res.json(actionItems[req.params.meetingId] || []));

app.get('/api/dashboard/stats', protect, (req, res) => {
    const stats = { ...dashboardStats };
    if (req.user && req.user.name) stats.user = req.user.name;
    res.json(stats);
});

// ─── NOTES ROUTES ─────────────────────────────────────────────
const inMemoryNotes = {};

app.get('/api/notes/:meetingId', protect, async (req, res) => {
    try {
        if (usingMongo && Note) {
            const note = await Note.findOne({ meetingId: req.params.meetingId, userId: req.user.id });
            return res.json(note ? { content: note.content } : { content: null });
        }
        const key = `${req.params.meetingId}::${req.user.id}`;
        res.json({ content: inMemoryNotes[key] || null });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.put('/api/notes/:meetingId', protect, async (req, res) => {
    try {
        const { content } = req.body;
        if (usingMongo && Note) {
            const note = await Note.findOneAndUpdate(
                { meetingId: req.params.meetingId, userId: req.user.id },
                { content },
                { upsert: true, new: true }
            );
            return res.json({ content: note.content });
        }
        const key = `${req.params.meetingId}::${req.user.id}`;
        inMemoryNotes[key] = content;
        res.json({ content });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── Start Server ────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`✅ MCMS Backend running at http://localhost:${PORT}`);
    console.log(`   MongoDB: ${usingMongo ? 'Connected' : 'Not running — users stored in-memory (lost on restart)'}`);
});
