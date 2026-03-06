import { useEffect, useRef, useState, useCallback } from 'react';

const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
    {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
    {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
];

export default function useWebRTC(socket, meetingId, currentUser) {
    const [peers, setPeers] = useState([]);
    const [localStream, setLocalStream] = useState(null);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [screenStream, setScreenStream] = useState(null);
    const [mediaError, setMediaError] = useState(null);

    const peersRef = useRef(new Map());
    const localStreamRef = useRef(null);
    const screenStreamRef = useRef(null);
    const joinedRef = useRef(false);

    const createPeerConnection = useCallback((remoteSocketId, remoteInfo, initiator) => {
        if (peersRef.current.has(remoteSocketId)) return peersRef.current.get(remoteSocketId).pc;

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        if (localStreamRef.current) {
            for (const track of localStreamRef.current.getTracks()) {
                pc.addTrack(track, localStreamRef.current);
            }
        }

        pc.onicecandidate = (e) => {
            if (e.candidate && socket) {
                socket.emit('signal', { to: remoteSocketId, signal: { type: 'candidate', candidate: e.candidate } });
            }
        };

        const remoteStream = new MediaStream();
        pc.ontrack = (e) => {
            e.streams[0]?.getTracks().forEach(track => {
                if (!remoteStream.getTracks().find(t => t.id === track.id)) {
                    remoteStream.addTrack(track);
                }
            });
            setPeers(prev => {
                const existing = prev.find(p => p.socketId === remoteSocketId);
                if (existing && existing.stream === remoteStream) return prev;
                return prev.filter(p => p.socketId !== remoteSocketId).concat({
                    socketId: remoteSocketId,
                    userId: remoteInfo.userId,
                    name: remoteInfo.name,
                    profileImage: remoteInfo.profileImage,
                    stream: remoteStream,
                });
            });
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                removePeer(remoteSocketId);
            }
        };

        peersRef.current.set(remoteSocketId, { pc, info: remoteInfo, stream: remoteStream });

        if (initiator) {
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
                socket.emit('signal', { to: remoteSocketId, signal: { type: 'offer', sdp: offer.sdp } });
            }).catch(console.error);
        }

        return pc;
    }, [socket]);

    const removePeer = useCallback((socketId) => {
        const entry = peersRef.current.get(socketId);
        if (entry) {
            entry.pc.close();
            peersRef.current.delete(socketId);
        }
        setPeers(prev => prev.filter(p => p.socketId !== socketId));
    }, []);

    const joinRoom = useCallback(async () => {
        if (joinedRef.current) return true;
        setMediaError(null);
        if (!socket) {
            setMediaError('Not connected to server — check your internet connection and reload.');
            return false;
        }
        if (!meetingId) return false;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            });
            localStreamRef.current = stream;
            setLocalStream(stream);
            joinedRef.current = true;

            socket.emit('join_room', {
                meetingId,
                name: currentUser?.name || 'User',
                profileImage: currentUser?.profileImage || null,
            });
            return true;
        } catch (err) {
            console.warn('Camera failed, trying audio-only:', err.name, err.message);
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true },
                    video: false,
                });
                localStreamRef.current = stream;
                setLocalStream(stream);
                setVideoEnabled(false);
                setMediaError('Camera unavailable — joined with audio only');
                joinedRef.current = true;

                socket.emit('join_room', {
                    meetingId,
                    name: currentUser?.name || 'User',
                    profileImage: currentUser?.profileImage || null,
                });
                return true;
            } catch (audioErr) {
                console.error('Cannot access media devices:', audioErr);
                setMediaError(`Cannot access camera or microphone: ${audioErr.message}`);
                return false;
            }
        }
    }, [socket, meetingId, currentUser]);

    const leaveRoom = useCallback(() => {
        if (!joinedRef.current) return;

        if (socket && meetingId) socket.emit('leave_room', { meetingId });

        for (const [sid] of peersRef.current) {
            removePeer(sid);
        }
        setPeers([]);

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
            setLocalStream(null);
        }

        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
            setScreenStream(null);
        }

        joinedRef.current = false;
    }, [socket, meetingId, removePeer]);

    const toggleAudio = useCallback(() => {
        if (!localStreamRef.current) return;
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            setAudioEnabled(audioTrack.enabled);
        }
    }, []);

    const toggleVideo = useCallback(() => {
        if (!localStreamRef.current) return;
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            setVideoEnabled(videoTrack.enabled);
        }
    }, []);

    const toggleScreenShare = useCallback(async () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
            setScreenStream(null);

            // Restore camera track to all peers
            const camTrack = localStreamRef.current?.getVideoTracks()[0];
            if (camTrack) {
                for (const [, { pc }] of peersRef.current) {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(camTrack);
                }
            }
            return;
        }

        try {
            const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
            screenStreamRef.current = screen;
            setScreenStream(screen);

            const screenTrack = screen.getVideoTracks()[0];
            for (const [, { pc }] of peersRef.current) {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(screenTrack);
            }

            screenTrack.onended = () => {
                screenStreamRef.current = null;
                setScreenStream(null);
                const camTrack = localStreamRef.current?.getVideoTracks()[0];
                if (camTrack) {
                    for (const [, { pc }] of peersRef.current) {
                        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                        if (sender) sender.replaceTrack(camTrack);
                    }
                }
            };
        } catch (err) {
            console.error('Screen share failed:', err);
        }
    }, []);

    useEffect(() => {
        if (!socket) return;

        const handleRoomPeers = ({ peers: existingPeers }) => {
            for (const peer of existingPeers) {
                createPeerConnection(peer.socketId, peer, true);
            }
        };

        const handlePeerJoined = ({ socketId, userId, name, profileImage }) => {
            createPeerConnection(socketId, { userId, name, profileImage }, false);
        };

        const handleSignal = async ({ from, signal }) => {
            let entry = peersRef.current.get(from);
            if (!entry) {
                entry = { pc: createPeerConnection(from, { userId: null, name: 'User', profileImage: null }, false) };
                entry = peersRef.current.get(from);
            }
            const { pc } = entry;

            if (signal.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('signal', { to: from, signal: { type: 'answer', sdp: answer.sdp } });
            } else if (signal.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
            } else if (signal.type === 'candidate') {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
            }
        };

        const handlePeerLeft = ({ socketId }) => {
            removePeer(socketId);
        };

        socket.on('room_peers', handleRoomPeers);
        socket.on('peer_joined', handlePeerJoined);
        socket.on('signal', handleSignal);
        socket.on('peer_left', handlePeerLeft);

        return () => {
            socket.off('room_peers', handleRoomPeers);
            socket.off('peer_joined', handlePeerJoined);
            socket.off('signal', handleSignal);
            socket.off('peer_left', handlePeerLeft);
        };
    }, [socket, createPeerConnection, removePeer]);

    useEffect(() => {
        return () => {
            leaveRoom();
        };
    }, [leaveRoom]);

    return {
        localStream,
        peers,
        audioEnabled,
        videoEnabled,
        screenStream,
        mediaError,
        joinRoom,
        leaveRoom,
        toggleAudio,
        toggleVideo,
        toggleScreenShare,
        joined: joinedRef.current,
    };
}
