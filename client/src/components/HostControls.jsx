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
  Shield01Icon,
  RecordIcon,
} from '@hugeicons/core-free-icons';
import QROverlay from './QROverlay';
import { useSocket } from '../context/SocketContext';

export default function HostControls({ meetingId, meetingTitle }) {
    const { socket } = useSocket();
    const [recording, setRecording] = useState(false);
    const [muted, setMuted] = useState(false);
    const [videoOn, setVideoOn] = useState(true);
    const [sharing, setSharing] = useState(false);
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
                        className={`btn-icon tooltip ${muted ? '' : 'active'}`}
                        data-tooltip={muted ? 'Unmute' : 'Mute'}
                        onClick={() => setMuted(!muted)}
                        id="btn-mute"
                    >
                        {muted ? <Icon icon={MicOff01Icon} size={18} /> : <Icon icon={Mic01Icon} size={18} />}
                    </button>

                    <button
                        className={`btn-icon tooltip ${videoOn ? 'active' : ''}`}
                        data-tooltip={videoOn ? 'Turn off camera' : 'Turn on camera'}
                        onClick={() => setVideoOn(!videoOn)}
                        id="btn-video"
                    >
                        {videoOn ? <Icon icon={Video01Icon} size={18} /> : <Icon icon={VideoOffIcon} size={18} />}
                    </button>

                    <button
                        className={`btn-icon tooltip ${sharing ? 'active' : ''}`}
                        data-tooltip={sharing ? 'Stop sharing' : 'Share screen'}
                        onClick={() => setSharing(!sharing)}
                        id="btn-screen-share"
                    >
                        <Icon icon={ComputerScreenShareIcon} size={18} />
                    </button>

                    <div className="controls-divider"></div>

                    <button
                        className={`control-btn ${recording ? 'recording' : ''}`}
                        onClick={toggleRecording}
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

                    <button className="control-btn" id="btn-host-actions">
                        <Icon icon={Shield01Icon} size={16} />
                        <span>Host Panel</span>
                    </button>
                </div>

                <button className="btn btn-danger" id="btn-end-meeting" style={{ fontSize: '12px', padding: '8px 16px' }}>
                    End Meeting
                </button>
            </div>

            {showQR && <QROverlay onClose={() => setShowQR(false)} meetingTitle={meetingTitle} />}
        </>
    );
}
