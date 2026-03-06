import { useCallback, useState, useEffect, useRef } from "react";
import HostControls from "./HostControls";
import Icon from "./Icon";
import {
  UserGroupIcon,
  FullScreenIcon,
  MinimizeScreenIcon,
  SidebarLeftIcon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import ShortcutTooltip from "./ShortcutTooltip";
import useWebRTC from "../hooks/useWebRTC";
import useTranscriptionCapture from "../hooks/useTranscriptionCapture";
import { useSocket } from "../context/SocketContext";

const SERVER_BASE = (import.meta.env.VITE_API_URL || "http://localhost:5001").replace(/\/api$/, "");

function VideoTile({ stream, name, profileImage, muted, isSelf, speaking }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideo = stream?.getVideoTracks().some((t) => t.enabled && !t.muted);
  const initial = name?.charAt(0)?.toUpperCase() || "?";

  return (
    <div className={`video-tile ${speaking ? "speaking" : ""}`}>
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="video-tile-video"
          style={isSelf ? { transform: "scaleX(-1)" } : undefined}
        />
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted={muted} style={{ display: "none" }} />
          <div className="video-tile-avatar">
            {profileImage ? (
              <img
                src={`${SERVER_BASE}${profileImage}`}
                alt=""
                className="video-tile-avatar-img"
              />
            ) : (
              <span>{initial}</span>
            )}
          </div>
        </>
      )}
      <div className="video-tile-name">
        {name || "User"}
        {isSelf && " (You)"}
      </div>
      {isSelf && <div className="self-badge">YOU</div>}
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
}) {
  const { socket } = useSocket();
  const {
    localStream,
    peers,
    audioEnabled,
    videoEnabled,
    screenStream,
    joinRoom,
    leaveRoom,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
  } = useWebRTC(socket, meetingId, currentUser);

  useTranscriptionCapture(socket, meetingId, localStream);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    setHasJoined(false);
  }, [meetingId]);

  const toggleFullscreen = useCallback(() => {
    const target = fullscreenRef?.current;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      target.requestFullscreen().catch(() => {});
    }
  }, [fullscreenRef]);

  const handleJoin = useCallback(async () => {
    await joinRoom();
    setHasJoined(true);
  }, [joinRoom]);

  const handleLeave = useCallback(() => {
    leaveRoom();
    setHasJoined(false);
  }, [leaveRoom]);

  const totalParticipants = 1 + peers.length;

  const gridClass =
    totalParticipants <= 1
      ? "grid-1"
      : totalParticipants <= 2
        ? "grid-2"
        : totalParticipants <= 4
          ? "grid-4"
          : totalParticipants <= 6
            ? "grid-6"
            : "grid-many";

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
          <h2 className="video-meeting-title">{meetingTitle || "No Active Meeting"}</h2>
          <div className="video-meeting-meta">
            <Icon icon={UserGroupIcon} size={14} />
            <span>
              {hasJoined ? `${totalParticipants} in call` : `${participants?.length || 0} participants`}
            </span>
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
          {modality === "Offline" ? (
            <div className="video-offline-message">
              This is an Offline meeting. Location details are in the schedule.
            </div>
          ) : !hasJoined ? (
            <div className="video-prejoin">
              <div className="prejoin-card">
                <div className="prejoin-avatar">
                  {currentUser?.profileImage ? (
                    <img
                      src={`${SERVER_BASE}${currentUser.profileImage}`}
                      alt=""
                      className="prejoin-avatar-img"
                    />
                  ) : (
                    <span>{currentUser?.name?.charAt(0)?.toUpperCase() || "U"}</span>
                  )}
                </div>
                <h3 className="prejoin-title">{meetingTitle}</h3>
                <p className="prejoin-subtitle">Ready to join?</p>
                <button className="btn btn-primary prejoin-btn" onClick={handleJoin}>
                  Join Meeting
                </button>
              </div>
            </div>
          ) : (
            <div className={`video-grid ${gridClass}`}>
              <VideoTile
                stream={screenStream || localStream}
                name={currentUser?.name}
                profileImage={currentUser?.profileImage}
                muted={true}
                isSelf={true}
              />
              {peers.map((peer) => (
                <VideoTile
                  key={peer.socketId}
                  stream={peer.stream}
                  name={peer.name}
                  profileImage={peer.profileImage}
                  muted={false}
                  isSelf={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <HostControls
        meetingId={meetingId}
        meetingTitle={meetingTitle}
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        screenSharing={!!screenStream}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={toggleScreenShare}
        onLeave={handleLeave}
        hasJoined={hasJoined}
      />

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
          padding: 0.75rem;
          overflow: hidden;
        }
        .video-placeholder {
          width: 100%;
          height: 100%;
          border-radius: var(--radius-lg);
          overflow: hidden;
        }
        .video-offline-message {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-muted);
        }

        /* Pre-join screen */
        .video-prejoin {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          background: var(--bg-elevated);
          border-radius: var(--radius-lg);
          border: 0.0625rem solid var(--border);
        }
        .prejoin-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          padding: 3rem 4rem;
        }
        .prejoin-avatar {
          width: 5rem;
          height: 5rem;
          border-radius: 50%;
          background: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          font-weight: 700;
          color: white;
          overflow: hidden;
        }
        .prejoin-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .prejoin-title {
          font-size: 1.125rem;
          font-weight: 600;
          text-align: center;
        }
        .prejoin-subtitle {
          font-size: 0.8125rem;
          color: var(--text-muted);
        }
        .prejoin-btn {
          margin-top: 0.5rem;
          padding: 0.625rem 2rem;
          font-size: 0.875rem;
        }

        /* Video grid */
        .video-grid {
          display: grid;
          gap: 0.375rem;
          width: 100%;
          height: 100%;
        }
        .grid-1 { grid-template-columns: 1fr; }
        .grid-2 { grid-template-columns: repeat(2, 1fr); }
        .grid-4 { grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 1fr); }
        .grid-6 { grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); }
        .grid-many { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }

        .video-tile {
          position: relative;
          background: var(--bg-elevated);
          border: 0.0625rem solid var(--border);
          border-radius: var(--radius-md);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          animation: slideUp 0.4s ease both;
          transition: border-color 0.3s;
        }
        .video-tile:hover {
          border-color: var(--border-hover);
        }
        .video-tile.speaking {
          border-color: var(--primary);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent);
        }
        .video-tile-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
        }
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
          overflow: hidden;
        }
        .video-tile-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .video-tile-name {
          position: absolute;
          bottom: 0.5rem;
          left: 0.5rem;
          padding: 0.1875rem 0.5rem;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: #fff;
          backdrop-filter: blur(4px);
        }
        .self-badge {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          padding: 0.125rem 0.375rem;
          background: var(--primary);
          border-radius: 6.25rem;
          font-size: 0.5625rem;
          font-weight: 700;
          color: white;
          letter-spacing: 0.03125rem;
        }
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
      `}</style>
    </div>
  );
}
