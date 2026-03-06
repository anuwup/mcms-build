import { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import {
  Mic01Icon,
  MicOff01Icon,
  Video01Icon,
  VideoOffIcon,
  ComputerScreenShareIcon,
  QrCodeIcon,
  UserGroupIcon,
  RecordIcon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons';
import QROverlay from './QROverlay';
import { useSocket } from '../context/SocketContext';

export default function HostControls({
    meetingId,
    meetingTitle,
    audioEnabled,
    videoEnabled,
    screenSharing,
    onToggleAudio,
    onToggleVideo,
    onToggleScreenShare,
    onLeave,
    hasJoined,
}) {
    const { socket } = useSocket();
    const [recording, setRecording] = useState(false);
    const [showQR, setShowQR] = useState(false);

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

    return (
        <>
            <div className="host-controls">
                <div className="controls-group">
                    <button
                        className={`btn-icon tooltip ${audioEnabled ? 'active' : ''}`}
                        data-tooltip={audioEnabled ? 'Mute' : 'Unmute'}
                        onClick={onToggleAudio}
                        disabled={!hasJoined}
                        id="btn-mute"
                    >
                        <Icon icon={audioEnabled ? Mic01Icon : MicOff01Icon} size={18} />
                    </button>

                    <button
                        className={`btn-icon tooltip ${videoEnabled ? 'active' : ''}`}
                        data-tooltip={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                        onClick={onToggleVideo}
                        disabled={!hasJoined}
                        id="btn-video"
                    >
                        <Icon icon={videoEnabled ? Video01Icon : VideoOffIcon} size={18} />
                    </button>

                    <button
                        className={`btn-icon tooltip ${screenSharing ? 'active' : ''}`}
                        data-tooltip={screenSharing ? 'Stop sharing' : 'Share screen'}
                        onClick={onToggleScreenShare}
                        disabled={!hasJoined}
                        id="btn-screen-share"
                    >
                        <Icon icon={ComputerScreenShareIcon} size={18} />
                    </button>

                    <div className="controls-divider"></div>

                    <button
                        className={`control-btn ${recording ? 'recording' : ''}`}
                        onClick={toggleRecording}
                        disabled={!hasJoined}
                        id="btn-record"
                    >
                        <Icon icon={RecordIcon} size={16} />
                        <span>{recording ? 'Recording' : 'Record'}</span>
                        {recording && <div className="rec-dot"></div>}
                    </button>

                    <button
                        className="control-btn"
                        onClick={() => setShowQR(true)}
                        id="btn-qr-attendance"
                    >
                        <Icon icon={QrCodeIcon} size={16} />
                        <span>Attendance</span>
                    </button>

                    <button className="control-btn" id="btn-participants">
                        <Icon icon={UserGroupIcon} size={16} />
                        <span>Participants</span>
                    </button>
                </div>

                {hasJoined && (
                    <button className="btn btn-danger" id="btn-end-meeting" onClick={onLeave} style={{ fontSize: '12px', padding: '8px 16px' }}>
                        <Icon icon={Cancel01Icon} size={14} />
                        <span style={{ marginLeft: '4px' }}>Leave</span>
                    </button>
                )}
            </div>

            {showQR && <QROverlay onClose={() => setShowQR(false)} meetingTitle={meetingTitle} />}
        </>
    );
}
