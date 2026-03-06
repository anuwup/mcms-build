import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export default function useWebRTC(meetingId, currentUser, active) {
  const { socket } = useSocket();
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [peers, setPeers] = useState([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [joined, setJoined] = useState(false);

  const peerConnections = useRef(new Map());
  const remoteStreams = useRef(new Map());
  const pendingCandidates = useRef(new Map());
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const joinedRef = useRef(false);
  const meetingIdRef = useRef(meetingId);

  meetingIdRef.current = meetingId;

  const createPeerConnection = useCallback((remoteSocketId, peerInfo) => {
    if (peerConnections.current.has(remoteSocketId)) {
      return peerConnections.current.get(remoteSocketId);
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit('webrtc_ice_candidate', {
          to: remoteSocketId,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      remoteStreams.current.set(remoteSocketId, stream);
      setPeers((prev) => {
        const existing = prev.find((p) => p.socketId === remoteSocketId);
        if (existing) {
          return prev.map((p) =>
            p.socketId === remoteSocketId ? { ...p, stream } : p
          );
        }
        return [
          ...prev,
          {
            socketId: remoteSocketId,
            userId: peerInfo?.userId,
            name: peerInfo?.name || 'User',
            image: peerInfo?.image,
            stream,
            micEnabled: true,
            camEnabled: true,
          },
        ];
      });
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        pc.restartIce();
      }
    };

    peerConnections.current.set(remoteSocketId, pc);

    setPeers((prev) => {
      if (prev.find((p) => p.socketId === remoteSocketId)) return prev;
      return [
        ...prev,
        {
          socketId: remoteSocketId,
          userId: peerInfo?.userId,
          name: peerInfo?.name || 'User',
          image: peerInfo?.image,
          stream: remoteStreams.current.get(remoteSocketId) || null,
          micEnabled: true,
          camEnabled: true,
        },
      ];
    });

    return pc;
  }, [socket]);

  const handleOffer = useCallback(async ({ from, sdp }) => {
    const pc = createPeerConnection(from, null);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

    const queued = pendingCandidates.current.get(from) || [];
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    pendingCandidates.current.delete(from);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { to: from, sdp: answer });
  }, [createPeerConnection, socket]);

  const handleAnswer = useCallback(async ({ from, sdp }) => {
    const pc = peerConnections.current.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

    const queued = pendingCandidates.current.get(from) || [];
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    pendingCandidates.current.delete(from);
  }, []);

  const handleIceCandidate = useCallback(async ({ from, candidate }) => {
    const pc = peerConnections.current.get(from);
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    } else {
      if (!pendingCandidates.current.has(from)) pendingCandidates.current.set(from, []);
      pendingCandidates.current.get(from).push(candidate);
    }
  }, []);

  const handlePeerJoined = useCallback(async (peerInfo) => {
    const pc = createPeerConnection(peerInfo.socketId, peerInfo);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc_offer', { to: peerInfo.socketId, sdp: offer });
  }, [createPeerConnection, socket]);

  const handlePeerLeft = useCallback(({ socketId }) => {
    const pc = peerConnections.current.get(socketId);
    if (pc) { pc.close(); peerConnections.current.delete(socketId); }
    remoteStreams.current.delete(socketId);
    pendingCandidates.current.delete(socketId);
    setPeers((prev) => prev.filter((p) => p.socketId !== socketId));
  }, []);

  const handlePeerToggle = useCallback(({ socketId, kind, enabled }) => {
    setPeers((prev) =>
      prev.map((p) =>
        p.socketId === socketId
          ? { ...p, [kind === 'audio' ? 'micEnabled' : 'camEnabled']: enabled }
          : p
      )
    );
  }, []);

  const handleExistingPeers = useCallback(async ({ peers: existingPeers }) => {
    for (const peer of existingPeers) {
      const pc = createPeerConnection(peer.socketId, peer);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc_offer', { to: peer.socketId, sdp: offer });
    }
  }, [createPeerConnection, socket]);

  const cleanupConnections = useCallback(() => {
    for (const [, pc] of peerConnections.current) pc.close();
    peerConnections.current.clear();
    remoteStreams.current.clear();
    pendingCandidates.current.clear();
    setPeers([]);
  }, []);

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) track.stop();
      localStreamRef.current = null;
      setLocalStream(null);
    }
    if (screenStreamRef.current) {
      for (const track of screenStreamRef.current.getTracks()) track.stop();
      screenStreamRef.current = null;
      setScreenStream(null);
      setScreenSharing(false);
    }
  }, []);

  const joinCall = useCallback(async () => {
    if (!socket || !meetingId || joinedRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMicEnabled(true);
      setCamEnabled(true);
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setMicEnabled(true);
        setCamEnabled(false);
      } catch {
        localStreamRef.current = null;
        setLocalStream(null);
        setMicEnabled(false);
        setCamEnabled(false);
      }
    }

    joinedRef.current = true;
    setJoined(true);
    socket.emit('webrtc_join', {
      meetingId,
      name: currentUser?.name,
      image: currentUser?.profileImage,
    });
  }, [socket, meetingId, currentUser]);

  const hangUp = useCallback(() => {
    if (socket && meetingIdRef.current) {
      socket.emit('webrtc_leave', { meetingId: meetingIdRef.current });
    }
    cleanupConnections();
    stopLocalStream();
    joinedRef.current = false;
    setJoined(false);
  }, [socket, cleanupConnections, stopLocalStream]);

  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicEnabled(track.enabled);
    if (socket && meetingIdRef.current) {
      socket.emit('webrtc_toggle', {
        meetingId: meetingIdRef.current,
        kind: 'audio',
        enabled: track.enabled,
      });
    }
  }, [socket]);

  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamEnabled(track.enabled);
    if (socket && meetingIdRef.current) {
      socket.emit('webrtc_toggle', {
        meetingId: meetingIdRef.current,
        kind: 'video',
        enabled: track.enabled,
      });
    }
  }, [socket]);

  const shareScreen = useCallback(async () => {
    if (screenSharing) {
      if (screenStreamRef.current) {
        for (const track of screenStreamRef.current.getTracks()) track.stop();
      }
      screenStreamRef.current = null;
      setScreenStream(null);
      setScreenSharing(false);

      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        for (const [, pc] of peerConnections.current) {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(camTrack).catch(() => {});
        }
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      setScreenSharing(true);

      const screenTrack = stream.getVideoTracks()[0];
      for (const [, pc] of peerConnections.current) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack).catch(() => {});
      }

      screenTrack.onended = () => {
        screenStreamRef.current = null;
        setScreenStream(null);
        setScreenSharing(false);
        const camTrack = localStreamRef.current?.getVideoTracks()[0];
        if (camTrack) {
          for (const [, pc] of peerConnections.current) {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(camTrack).catch(() => {});
          }
        }
      };
    } catch {
      // user cancelled screen share dialog
    }
  }, [screenSharing]);

  // Attach / detach socket listeners
  useEffect(() => {
    if (!socket || !active) return;

    socket.on('webrtc_peers', handleExistingPeers);
    socket.on('webrtc_peer_joined', handlePeerJoined);
    socket.on('webrtc_peer_left', handlePeerLeft);
    socket.on('webrtc_offer', handleOffer);
    socket.on('webrtc_answer', handleAnswer);
    socket.on('webrtc_ice_candidate', handleIceCandidate);
    socket.on('webrtc_peer_toggle', handlePeerToggle);

    return () => {
      socket.off('webrtc_peers', handleExistingPeers);
      socket.off('webrtc_peer_joined', handlePeerJoined);
      socket.off('webrtc_peer_left', handlePeerLeft);
      socket.off('webrtc_offer', handleOffer);
      socket.off('webrtc_answer', handleAnswer);
      socket.off('webrtc_ice_candidate', handleIceCandidate);
      socket.off('webrtc_peer_toggle', handlePeerToggle);
    };
  }, [socket, active, handleExistingPeers, handlePeerJoined, handlePeerLeft, handleOffer, handleAnswer, handleIceCandidate, handlePeerToggle]);

  // Cleanup on unmount or meeting change
  useEffect(() => {
    return () => {
      if (joinedRef.current) hangUp();
    };
  }, [meetingId, hangUp]);

  return {
    localStream,
    screenStream,
    peers,
    micEnabled,
    camEnabled,
    screenSharing,
    joined,
    joinCall,
    hangUp,
    toggleMic,
    toggleCamera,
    shareScreen,
  };
}
