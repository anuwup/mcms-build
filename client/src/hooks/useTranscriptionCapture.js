import { useEffect, useRef, useCallback } from 'react';

const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

// RMS gate: only send audio frames where the speaker is actually talking.
// This eliminates speaker bleed (echo-cancelled mic captures ~0.005 RMS for
// playback audio, while direct speech is typically 0.02–0.3+).
const RMS_GATE_THRESHOLD = 0.012;
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

/**
 * Captures the local microphone stream and sends audio chunks to the server
 * via socket for per-speaker transcription. Each participant's audio is sent
 * independently — the server receives isolated streams just like Google Meet's
 * architecture, enabling accurate speaker attribution.
 */
export default function useTranscriptionCapture(socket, meetingId, localStream) {
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const sourceRef = useRef(null);
    const activeRef = useRef(false);
    const holdCounterRef = useRef(0);

    const stopCapture = useCallback(() => {
        if (!activeRef.current) return;
        activeRef.current = false;

        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current.onaudioprocess = null;
            processorRef.current = null;
        }
        if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
    }, []);

    const startCapture = useCallback(() => {
        if (!socket || !meetingId || !localStream || activeRef.current) return;

        const audioTrack = localStream.getAudioTracks()[0];
        if (!audioTrack) return;

        activeRef.current = true;
        holdCounterRef.current = 0;

        // Tap into the existing local media stream — no new getUserMedia needed
        // since the WebRTC hook already acquired it.
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioCtx;

        const audioOnlyStream = new MediaStream([audioTrack]);
        const source = audioCtx.createMediaStreamSource(audioOnlyStream);
        sourceRef.current = source;

        const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (!activeRef.current) return;
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
    }, [socket, meetingId, localStream]);

    useEffect(() => {
        if (!socket || !meetingId) return;

        const handleStarted = ({ meetingId: mid }) => {
            if (mid === meetingId) startCapture();
        };
        const handleStopped = ({ meetingId: mid }) => {
            if (mid === meetingId) stopCapture();
        };

        socket.on('transcription_started', handleStarted);
        socket.on('transcription_stopped', handleStopped);

        return () => {
            socket.off('transcription_started', handleStarted);
            socket.off('transcription_stopped', handleStopped);
            stopCapture();
        };
    }, [socket, meetingId, startCapture, stopCapture]);

    return { active: activeRef.current, stopCapture };
}
