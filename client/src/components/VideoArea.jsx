import { useCallback, useState, useEffect, useRef } from "react";
import HostControls from "./HostControls";
import Icon from "./Icon";
import {
  UserGroupIcon,
  FullScreenIcon,
  MinimizeScreenIcon,
  SidebarLeftIcon,
  SidebarRightIcon,
  Mic01Icon,
  MicOff01Icon,
  Video01Icon,
  VideoOffIcon,
  ComputerScreenShareIcon,
  CallEnd01Icon,
  Call02Icon,
} from "@hugeicons/core-free-icons";
import ShortcutTooltip from "./ShortcutTooltip";
import useWebRTC from "../hooks/useWebRTC";

function VideoTile({ stream, name, image, muted, camOff, isLocal, isScreen, serverBase }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideo = stream && stream.getVideoTracks().some((t) => t.enabled && !camOff);

  return (
    <div className={`rtc-tile${isLocal ? " rtc-tile-local" : ""}${isScreen ? " rtc-tile-screen" : ""}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`rtc-video${hasVideo ? "" : " rtc-video-hidden"}`}
      />
      {!hasVideo && (
        <div className="rtc-tile-avatar">
          {image ? (
            <img src={`${serverBase || ""}${image}`} alt="" className="rtc-avatar-img" />
          ) : (
            <span>{(name || "?").charAt(0).toUpperCase()}</span>
          )}
        </div>
      )}
      <div className="rtc-tile-nameplate">
        {muted && (
          <span className="rtc-mute-indicator">
            <Icon icon={MicOff01Icon} size={11} />
          </span>
        )}
        <span className="rtc-name-text">{isLocal ? "You" : name || "User"}</span>
      </div>
    </div>
  );
}

export default function VideoArea({
  meetingId,
  meetingTitle,
  participants,
  modality,
  currentUser,
  fullscreenRef,
  agendaPanelOpen,
  rightPanelOpen,
  onToggleAgendaPanel,
  onToggleRightPanel,
  onMicStateChange,
  onCallStreamReady,
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isOnline = modality === "Online" || modality === "Hybrid";

  const {
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
  } = useWebRTC(meetingId, currentUser, isOnline);

  const serverBase = (import.meta.env.VITE_API_URL || "http://localhost:5001/api").replace("/api", "");

  useEffect(() => {
    if (joined && onMicStateChange) onMicStateChange(micEnabled);
  }, [joined, micEnabled, onMicStateChange]);

  useEffect(() => {
    if (!onCallStreamReady) return;
    if (joined && localStream) onCallStreamReady(localStream);
    else onCallStreamReady(null);
  }, [joined, localStream, onCallStreamReady]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const target = fullscreenRef?.current;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      target.requestFullscreen().catch(() => {});
    }
  }, [fullscreenRef]);

  const totalCount = (joined ? 1 : 0) + peers.length;
  const gridClass =
    totalCount <= 1
      ? "rtc-grid-1"
      : totalCount === 2
        ? "rtc-grid-2"
        : totalCount <= 4
          ? "rtc-grid-4"
          : "rtc-grid-6";

  return (
    <div className="video-area">
      <div className="video-header">
        {!agendaPanelOpen && (
          <ShortcutTooltip keys={["mod", "["]} position="right">
            <button className="video-panel-toggle" onClick={onToggleAgendaPanel}>
              <Icon icon={SidebarLeftIcon} size={16} />
            </button>
          </ShortcutTooltip>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="video-meeting-title">
            {meetingTitle || "No Active Meeting"}
          </h2>
          <div className="video-meeting-meta">
            <Icon icon={UserGroupIcon} size={14} />
            <span>{participants?.length || 0} participants</span>
          </div>
        </div>
        <ShortcutTooltip keys={["F"]}>
          <button
            className="btn-icon"
            id="btn-fullscreen"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            <Icon icon={isFullscreen ? MinimizeScreenIcon : FullScreenIcon} size={16} />
          </button>
        </ShortcutTooltip>
        {!rightPanelOpen && (
          <ShortcutTooltip keys={["mod", "]"]} position="left">
            <button className="video-panel-toggle" onClick={onToggleRightPanel}>
              <Icon icon={SidebarRightIcon} size={16} />
            </button>
          </ShortcutTooltip>
        )}
      </div>

      <div className="video-container">
        <div className="video-placeholder">
          {isOnline ? (
            joined ? (
              <div className={`rtc-grid ${gridClass}`}>
                <VideoTile
                  stream={screenSharing ? screenStream : localStream}
                  name={currentUser?.name}
                  image={currentUser?.profileImage}
                  muted={!micEnabled}
                  camOff={!camEnabled && !screenSharing}
                  isLocal
                  isScreen={screenSharing}
                  serverBase={serverBase}
                />
                {peers.map((peer) => (
                  <VideoTile
                    key={peer.socketId}
                    stream={peer.stream}
                    name={peer.name}
                    image={peer.image}
                    muted={!peer.micEnabled}
                    camOff={!peer.camEnabled}
                    serverBase={serverBase}
                  />
                ))}
              </div>
            ) : (
              <div className="rtc-join-prompt">
                <div className="rtc-join-icon">
                  <Icon icon={Video01Icon} size={36} />
                </div>
                <h3>Ready to join?</h3>
                <p>Your camera and microphone will be activated when you join.</p>
                <button className="btn btn-primary rtc-join-btn" onClick={joinCall}>
                  <Icon icon={Call02Icon} size={18} />
                  Join Meeting
                </button>
              </div>
            )
          ) : modality === "Offline" ? (
            <div className="rtc-offline-notice">
              This is an Offline meeting. Location details are in the schedule.
            </div>
          ) : (
            <div className="video-grid">
              {(participants || ["Host", "Participant 1", "Participant 2", "Participant 3"])
                .slice(0, 4)
                .map((p, i) => (
                  <div key={i} className="video-tile" style={{ animationDelay: `${i * 0.1}s` }}>
                    <div className="video-tile-avatar">
                      <span>{typeof p === "string" ? p.charAt(0).toUpperCase() : "?"}</span>
                    </div>
                    <div className="video-tile-name">{p}</div>
                    {i === 0 && <div className="host-badge">HOST</div>}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {isOnline && joined && (
        <div className="rtc-toolbar">
          <button
            className={`rtc-toolbar-btn${micEnabled ? "" : " rtc-btn-off"}`}
            onClick={toggleMic}
            data-tooltip={micEnabled ? "Mute" : "Unmute"}
          >
            <Icon icon={micEnabled ? Mic01Icon : MicOff01Icon} size={20} />
          </button>
          <button
            className={`rtc-toolbar-btn${camEnabled ? "" : " rtc-btn-off"}`}
            onClick={toggleCamera}
            data-tooltip={camEnabled ? "Camera off" : "Camera on"}
          >
            <Icon icon={camEnabled ? Video01Icon : VideoOffIcon} size={20} />
          </button>
          <button
            className={`rtc-toolbar-btn${screenSharing ? " rtc-btn-active" : ""}`}
            onClick={shareScreen}
            data-tooltip={screenSharing ? "Stop sharing" : "Share screen"}
          >
            <Icon icon={ComputerScreenShareIcon} size={20} />
          </button>
          <button className="rtc-toolbar-btn rtc-btn-hangup" onClick={hangUp} data-tooltip="Leave call">
            <Icon icon={CallEnd01Icon} size={20} />
          </button>
        </div>
      )}

      <HostControls meetingId={meetingId} meetingTitle={meetingTitle} />

      <style>{`
        .video-area {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-primary);
          border: 0.0625rem solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .video-panel-toggle {
          flex-shrink: 0;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-card);
          border: 0.0625rem solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          cursor: pointer;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
          padding: 0;
        }
        .video-panel-toggle:hover {
          background: var(--bg-hover);
          color: var(--primary);
          border-color: var(--border-hover);
        }
        .video-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1.25rem;
          border-bottom: 0.0625rem solid var(--border);
        }
        .video-meeting-title {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 0.125rem;
        }
        .video-meeting-meta {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .video-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          overflow: hidden;
        }
        .video-placeholder {
          width: 100%;
          height: 100%;
          border-radius: var(--radius-lg);
          overflow: hidden;
        }

        /* ── Video grid (placeholder fallback) ── */
        .video-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.5rem;
          width: 100%;
          height: 100%;
        }
        .video-tile {
          position: relative;
          background: var(--bg-elevated);
          border: 0.0625rem solid var(--border);
          border-radius: var(--radius-md);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.625rem;
          animation: slideUp 0.4s ease both;
          transition: border-color 0.3s;
        }
        .video-tile:hover { border-color: var(--border-hover); }
        .video-tile-avatar {
          width: 3.5rem;
          height: 3.5rem;
          border-radius: 50%;
          background: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.375rem;
          font-weight: 700;
          color: white;
        }
        .video-tile-name { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
        .host-badge {
          position: absolute;
          top: 0.625rem;
          right: 0.625rem;
          padding: 0.1875rem 0.5rem;
          background: var(--primary);
          border-radius: 6.25rem;
          font-size: 0.625rem;
          font-weight: 700;
          color: white;
          letter-spacing: 0.03125rem;
        }

        /* ── WebRTC Grid ── */
        .rtc-grid {
          display: grid;
          gap: 0.5rem;
          width: 100%;
          height: 100%;
        }
        .rtc-grid-1 { grid-template-columns: 1fr; }
        .rtc-grid-2 { grid-template-columns: repeat(2, 1fr); }
        .rtc-grid-4 { grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 1fr); }
        .rtc-grid-6 { grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); }

        .rtc-tile {
          position: relative;
          background: var(--bg-elevated);
          border: 0.0625rem solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: slideUp 0.3s ease both;
        }
        .rtc-tile-local { border-color: var(--primary); border-width: 0.125rem; }
        .rtc-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
        }
        .rtc-tile-local .rtc-video { transform: scaleX(-1); }
        .rtc-tile-screen .rtc-video { object-fit: contain; transform: none; }
        .rtc-video-hidden { display: none; }

        .rtc-tile-avatar {
          width: 4rem;
          height: 4rem;
          border-radius: 50%;
          background: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          font-weight: 700;
          color: white;
        }
        .rtc-avatar-img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        }

        .rtc-tile-nameplate {
          position: absolute;
          bottom: 0.5rem;
          left: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.375rem;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(4px);
          padding: 0.25rem 0.625rem;
          border-radius: 0.375rem;
          max-width: calc(100% - 1rem);
        }
        .rtc-name-text {
          font-size: 0.75rem;
          font-weight: 500;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rtc-mute-indicator {
          display: flex;
          align-items: center;
          color: #E8705F;
          flex-shrink: 0;
        }

        /* ── Toolbar ── */
        .rtc-toolbar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          border-top: 0.0625rem solid var(--border);
        }
        .rtc-toolbar-btn {
          width: 2.75rem;
          height: 2.75rem;
          border-radius: 50%;
          border: 0.0625rem solid var(--border);
          background: var(--bg-card);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.15s;
        }
        .rtc-toolbar-btn:hover {
          background: var(--bg-hover);
          border-color: var(--border-hover);
          transform: scale(1.05);
        }
        .rtc-btn-off {
          background: var(--bg-elevated);
          color: #E8705F;
          border-color: #E8705F40;
        }
        .rtc-btn-off:hover { background: #E8705F20; }
        .rtc-btn-active {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
        }
        .rtc-btn-active:hover { opacity: 0.9; }
        .rtc-btn-hangup {
          background: #D14D41;
          color: white;
          border-color: #D14D41;
        }
        .rtc-btn-hangup:hover {
          background: #AF3029;
          border-color: #AF3029;
        }

        /* ── Join prompt ── */
        .rtc-join-prompt {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 0.75rem;
          text-align: center;
          color: var(--text-secondary);
        }
        .rtc-join-icon {
          width: 5rem;
          height: 5rem;
          border-radius: 50%;
          background: var(--bg-elevated);
          border: 0.0625rem solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary);
          margin-bottom: 0.5rem;
        }
        .rtc-join-prompt h3 {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }
        .rtc-join-prompt p {
          font-size: 0.875rem;
          color: var(--text-muted);
          margin: 0;
          max-width: 22rem;
        }
        .rtc-join-btn {
          margin-top: 0.75rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.75rem !important;
          font-size: 0.9375rem !important;
        }

        .rtc-offline-notice {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
