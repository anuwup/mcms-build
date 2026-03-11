import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import Icon from './Icon';
import {
    Mic01Icon, MicOff01Icon, Video01Icon, VideoOffIcon,
    ComputerScreenShareIcon, QrCodeIcon, UserGroupIcon,
    RecordIcon, Cancel01Icon, StopIcon,
} from '@hugeicons/core-free-icons';
import QROverlay from './QROverlay';
import { useSocket } from '../context/SocketContext';

const HostControls = forwardRef(function HostControls({
    meetingId, meetingTitle,
    audioEnabled, videoEnabled, screenSharing,
    onToggleAudio, onToggleVideo, onToggleScreenShare,
    onLeave, hasJoined, onMeetingEnded,
}, ref) {
    const { socket } = useSocket();
    const [recording, setRecording] = useState(false);
    const [showQR, setShowQR] = useState(false);

    useImperativeHandle(ref, () => ({
        toggleRecording: () => {
            if (!socket || !meetingId) return;
            if (recording) socket.emit('stop_transcription', { meetingId });
            else socket.emit('start_transcription', { meetingId });
        },
        showAttendance: () => setShowQR(true),
        endMeeting: () => {
            if (!socket || !meetingId) return;
            if (recording) socket.emit('stop_transcription', { meetingId });
            socket.emit('end_meeting', { meetingId });
            onMeetingEnded?.();
        },
    }), [socket, meetingId, recording, onMeetingEnded]);

    useEffect(() => {
        if (!socket) return;
        const onStarted = ({ meetingId: mid }) => { if (mid === meetingId) setRecording(true); };
        const onStopped = ({ meetingId: mid }) => { if (mid === meetingId) setRecording(false); };
        socket.on('transcription_started', onStarted);
        socket.on('transcription_stopped', onStopped);
        return () => {
            socket.off('transcription_started', onStarted);
            socket.off('transcription_stopped', onStopped);
        };
    }, [socket, meetingId]);

    const toggleRecording = useCallback(() => {
        if (!socket || !meetingId) return;
        if (recording) {
            socket.emit('stop_transcription', { meetingId });
        } else {
            socket.emit('start_transcription', { meetingId });
        }
    }, [socket, meetingId, recording]);

    const handleEndMeeting = useCallback(() => {
        if (!socket || !meetingId) return;
        if (recording) socket.emit('stop_transcription', { meetingId });
        socket.emit('end_meeting', { meetingId });
        onMeetingEnded?.();
    }, [socket, meetingId, recording, onMeetingEnded]);

    return (
        <>
            <div className="host-controls">
                <div className="controls-group">
                    <button
                        className={`btn-icon tooltip ${audioEnabled ? 'active' : ''}`}
                        data-tooltip={audioEnabled ? 'Mute' : 'Unmute'}
                        onClick={onToggleAudio}
                        disabled={!hasJoined}
                    >
                        <Icon icon={audioEnabled ? Mic01Icon : MicOff01Icon} size={18} />
                    </button>

                    <button
                        className={`btn-icon tooltip ${videoEnabled ? 'active' : ''}`}
                        data-tooltip={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                        onClick={onToggleVideo}
                        disabled={!hasJoined}
                    >
                        <Icon icon={videoEnabled ? Video01Icon : VideoOffIcon} size={18} />
                    </button>

                    <button
                        className={`btn-icon tooltip ${screenSharing ? 'active' : ''}`}
                        data-tooltip={screenSharing ? 'Stop sharing' : 'Share screen'}
                        onClick={onToggleScreenShare}
                        disabled={!hasJoined}
                    >
                        <Icon icon={ComputerScreenShareIcon} size={18} />
                    </button>

                    <div className="controls-divider"></div>

                    <button
                        className={`control-btn ${recording ? 'recording' : ''}`}
                        onClick={toggleRecording}
                        disabled={!hasJoined}
                    >
                        <Icon icon={RecordIcon} size={16} />
                        <span>{recording ? 'Recording' : 'Record'}</span>
                        {recording && <div className="rec-dot"></div>}
                    </button>

                    <button className="control-btn" onClick={() => setShowQR(true)}>
                        <Icon icon={QrCodeIcon} size={16} />
                        <span>Attendance</span>
                    </button>

                    <button className="control-btn" disabled>
                        <Icon icon={UserGroupIcon} size={16} />
                        <span>Participants</span>
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    {hasJoined && (
                        <>
                            <button
                                className="btn btn-danger"
                                onClick={handleEndMeeting}
                                style={{ fontSize: '12px', padding: '8px 16px' }}
                                title="End meeting for all"
                            >
                                <Icon icon={StopIcon} size={14} />
                                <span style={{ marginLeft: '4px' }}>End</span>
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={onLeave}
                                style={{ fontSize: '12px', padding: '8px 16px' }}
                            >
                                <Icon icon={Cancel01Icon} size={14} />
                                <span style={{ marginLeft: '4px' }}>Leave</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {showQR && <QROverlay onClose={() => setShowQR(false)} meetingTitle={meetingTitle} meetingId={meetingId} />}
        </>
    );
});

export default HostControls;
