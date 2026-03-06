import { useEffect, useRef, useCallback } from 'react';

const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

// Energy gate: only send audio when RMS exceeds this threshold.
// Direct speech into a mic typically produces RMS 0.02–0.3+;
// speaker bleed through echo-cancelled mic is usually < 0.008.
const RMS_GATE_THRESHOLD = 0.012;
// Keep sending for a short window after voice stops to avoid clipping ends
const VOICE_HOLD_FRAMES = 8;

function resampleBuffer(inputBuffer, fromRate, toRate) {
    if (fromRate === toRate) return inputBuffer;
    const ratio = fromRate / toRate;
    const newLength = Math.round(inputBuffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const srcIdx = i * ratio;
        const low = Math.floor(srcIdx);
        const high = Math.min(low + 1, inputBuffer.length - 1);
        const frac = srcIdx - low;
        result[i] = inputBuffer[low] * (1 - frac) + inputBuffer[high] * frac;
    }
    return result;
}

function float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
}

function int16ToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function computeRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
}

// When true, we created the stream (getUserMedia) and must stop its tracks. When false, stream is from the call and we must not stop it.
const OWN_STREAM = true;
const BORROWED_STREAM = false;

export default function useTranscriptionCapture(socket, meetingId, user, options = {}) {
    const { micEnabled = true, callLocalStream = null } = typeof options === 'boolean' ? { micEnabled: options } : options;
    const mediaStreamRef = useRef(null);
    const ownedStreamRef = useRef(false);
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const sourceRef = useRef(null);
    const activeRef = useRef(false);
    const transcriptionActiveRef = useRef(false);
    const holdCounterRef = useRef(0);
    const micEnabledRef = useRef(micEnabled);
    micEnabledRef.current = micEnabled;

    const stopCapture = useCallback((leaveServer = true) => {
        if (!activeRef.current) return;
        activeRef.current = false;

        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current.onaudioprocess = null;
            processorRef.current = null;
        }
        if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
        if (mediaStreamRef.current && ownedStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
        }
        mediaStreamRef.current = null;
        ownedStreamRef.current = false;

        if (leaveServer && socket && meetingId) socket.emit('leave_transcription', { meetingId });
    }, [socket, meetingId]);

    const startCaptureWithStream = useCallback(async (stream, owned) => {
        if (!socket || !meetingId || activeRef.current || !stream) return;
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) return;

        mediaStreamRef.current = stream;
        ownedStreamRef.current = owned;
        activeRef.current = true;
        holdCounterRef.current = 0;

        socket.emit('join_transcription', {
            meetingId,
            speakerName: user?.name || 'Speaker',
            speakerImage: user?.profileImage || null,
        });

        const waitReady = new Promise((resolve) => {
            const handler = () => { socket.off('transcription_ready', handler); resolve(); };
            socket.on('transcription_ready', handler);
            setTimeout(handler, 5000);
        });
        await waitReady;

        if (!activeRef.current) {
            if (owned) stream.getTracks().forEach(t => t.stop());
            return;
        }

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (!activeRef.current) return;
            const track = mediaStreamRef.current?.getAudioTracks()[0];
            if (track && !track.enabled) return;
            if (!micEnabledRef.current) return;
            const inputData = e.inputBuffer.getChannelData(0);

            const rms = computeRMS(inputData);

            if (rms >= RMS_GATE_THRESHOLD) {
                holdCounterRef.current = VOICE_HOLD_FRAMES;
            } else if (holdCounterRef.current > 0) {
                holdCounterRef.current--;
            } else {
                return;
            }

            const resampled = resampleBuffer(inputData, audioCtx.sampleRate, TARGET_SAMPLE_RATE);
            const int16 = float32ToInt16(resampled);
            const base64 = int16ToBase64(int16);
            socket.emit('audio_chunk', { meetingId, data: base64 });
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);

        if (owned) stream.getAudioTracks()[0].onended = () => stopCapture();
    }, [socket, meetingId, user, stopCapture]);

    const startCapture = useCallback(async () => {
        if (!socket || !meetingId || activeRef.current) return;

        const stream = callLocalStream;
        if (stream && stream.active && stream.getAudioTracks().length > 0) {
            await startCaptureWithStream(stream, BORROWED_STREAM);
            return;
        }

        try {
            const ownStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false,
                },
            });
            await startCaptureWithStream(ownStream, OWN_STREAM);
        } catch (err) {
            if (err.name !== 'NotAllowedError') {
                console.error('Transcription capture failed:', err);
            }
            activeRef.current = false;
        }
    }, [socket, meetingId, callLocalStream, startCaptureWithStream]);

    useEffect(() => {
        if (!socket || !meetingId) return;

        const handleStarted = ({ meetingId: mid }) => {
            if (mid === meetingId) {
                transcriptionActiveRef.current = true;
                startCapture();
            }
        };
        const handleStopped = ({ meetingId: mid }) => {
            if (mid === meetingId) {
                transcriptionActiveRef.current = false;
                stopCapture();
            }
        };

        socket.on('transcription_started', handleStarted);
        socket.on('transcription_stopped', handleStopped);

        return () => {
            socket.off('transcription_started', handleStarted);
            socket.off('transcription_stopped', handleStopped);
            transcriptionActiveRef.current = false;
            stopCapture();
        };
    }, [socket, meetingId, startCapture, stopCapture]);

    useEffect(() => {
        if (callLocalStream && transcriptionActiveRef.current && !activeRef.current) {
            startCapture();
        }
        if (!callLocalStream && activeRef.current && !ownedStreamRef.current) {
            stopCapture();
        }
    }, [callLocalStream, startCapture, stopCapture]);

    return { active: activeRef.current, stopCapture };
}
