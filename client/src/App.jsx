import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import "./index.css";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import AgendaPanel from "./components/AgendaPanel";
import VideoArea from "./components/VideoArea";
import TranscriptFeed from "./components/TranscriptFeed";
import ActionItems from "./components/ActionItems";
import LiveOutcome from "./components/LiveOutcome";
import MeetingCreation from "./components/MeetingCreation";
import ProductivityDashboard from "./components/ProductivityDashboard";
import PollVoting from "./components/PollVoting";
import ProfileSettings from "./components/ProfileSettings";
import useKeyboardShortcuts from "./hooks/useKeyboardShortcuts";
import Icon from "./components/Icon";
import { Calendar02Icon, Clock01Icon, UserIcon } from "@hugeicons/core-free-icons";

// Auth Pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import { useAuth } from "./context/AuthContext";
import { useSocket } from "./context/SocketContext";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

const VIEW_KEYS = ['dashboard', 'meeting', 'schedule', 'archive', 'analytics', 'settings', 'profile'];

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

function DashboardApp() {
  const { user, logout } = useAuth();
  const { socket } = useSocket();

  const [currentView, setCurrentView] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);
  const [pollMeetingId, setPollMeetingId] = useState(null);
  const searchInputRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem("theme") === "light" ? "light" : "dark";
  });

  // Data state
  const [meetings, setMeetings] = useState([]);
  const [agendaItems, setAgendaItems] = useState([]);
  const [transcripts, setTranscripts] = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [selectedMeeting, setSelectedMeeting] = useState(null);

  const [agendaPanelOpen, setAgendaPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const meetingLayoutRef = useRef(null);

  const toggleAgendaPanel = useCallback(() => setAgendaPanelOpen(prev => !prev), []);
  const toggleRightPanel = useCallback(() => setRightPanelOpen(prev => !prev), []);
  const toggleFullscreen = useCallback(() => {
    const target = meetingLayoutRef.current;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      target.requestFullscreen().catch(() => {});
    }
  }, []);

  const shortcuts = useMemo(() => [
    { key: 'k', mod: true, handler: () => searchInputRef.current?.focus(), allowInInput: true },
    { key: 'b', mod: true, handler: () => setSidebarCollapsed(prev => !prev), allowInInput: true },
    { key: 'M', shift: true, handler: () => setShowCreateMeeting(true) },
    { key: 'd', handler: () => setTheme(prev => prev === 'dark' ? 'light' : 'dark') },
    { key: 'f', handler: toggleFullscreen },
    { key: '[', mod: true, handler: () => setAgendaPanelOpen(prev => !prev), allowInInput: true },
    { key: ']', mod: true, handler: () => setRightPanelOpen(prev => !prev), allowInInput: true },
    { key: 'Escape', handler: () => {
      if (pollMeetingId) setPollMeetingId(null);
    }, allowInInput: true },
    ...VIEW_KEYS.map((view, i) => ({
      key: String(i + 1),
      handler: () => setCurrentView(view),
    })),
  ], [pollMeetingId, toggleFullscreen]);

  useKeyboardShortcuts(shortcuts);

  // Helper for authenticated requests
  const fetchWithAuth = async (url, options = {}) => {
    const headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    if (user?.token) {
      headers.Authorization = `Bearer ${user.token}`;
    }
    return fetch(url, { ...options, headers });
  };

  // Fetch data on mount
  useEffect(() => {
    fetchMeetings();
    fetchDashboardStats();
  }, []);

  // Apply theme to document root
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    if (selectedMeeting) {
      fetchAgenda(selectedMeeting.id);
      fetchTranscript(selectedMeeting.id);
      fetchActionItems(selectedMeeting.id);
    }
  }, [selectedMeeting]);

  useEffect(() => {
    if (!socket || !selectedMeeting) return;

    const meetingId = selectedMeeting.id;
    socket.emit('join_meeting', { meetingId });

    const handleTranscriptUpdate = (segment) => {
      if (segment.meetingId === meetingId) {
        setTranscripts(prev => [...prev, segment]);
      }
    };

    const handleTranscriptReplaced = ({ meetingId: replacedId }) => {
      if (replacedId === meetingId) {
        fetchTranscript(meetingId);
      }
    };

    socket.on('transcript_update', handleTranscriptUpdate);
    socket.on('transcript_replaced', handleTranscriptReplaced);

    return () => {
      socket.emit('leave_meeting', { meetingId });
      socket.off('transcript_update', handleTranscriptUpdate);
      socket.off('transcript_replaced', handleTranscriptReplaced);
    };
  }, [socket, selectedMeeting]);

  const fetchMeetings = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/meetings`);
      if (res.ok) {
        const data = await res.json();
        setMeetings(data);
        if (data.length > 0) setSelectedMeeting(data[0]);
      }
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
    }
  };

  const fetchAgenda = async (meetingId) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/agenda/${meetingId}`);
      if (res.ok) setAgendaItems(await res.json());
    } catch (err) {
      console.error("Failed to fetch agenda:", err);
    }
  };

  const fetchTranscript = async (meetingId) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/transcript/${meetingId}`);
      if (res.ok) setTranscripts(await res.json());
    } catch (err) {
      console.error("Failed to fetch transcript:", err);
    }
  };

  const fetchActionItems = async (meetingId) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/action-items/${meetingId}`);
      if (res.ok) setActionItems(await res.json());
    } catch (err) {
      console.error("Failed to fetch action items:", err);
    }
  };

  const fetchDashboardStats = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/dashboard/stats`);
      if (res.ok) setDashboardStats(await res.json());
    } catch (err) {
      console.error("Failed to fetch dashboard stats:", err);
    }
  };

  const handleCreateMeeting = async (meetingData) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/meetings`, {
        method: "POST",
        body: JSON.stringify(meetingData),
      });
      if (res.ok) {
        const newMeeting = await res.json();
        setMeetings((prev) => [newMeeting, ...prev]);
        setSelectedMeeting(newMeeting);
        return newMeeting;
      }
    } catch (err) {
      console.error("Failed to create meeting:", err);
    }
    return null;
  };

  const renderContent = () => {
    switch (currentView) {
      case "dashboard":
        return (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <ProductivityDashboard stats={dashboardStats} userName={user?.name} />
          </div>
        );

      case "meeting":
        if (!selectedMeeting) {
          return (
            <div style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
              <h2 style={{ fontSize: "1.375rem", fontWeight: 700, marginBottom: "1rem" }}>
                Live Meeting
              </h2>
              <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
                Select a meeting below to join the call and see agenda, transcript, and notes.
              </p>
              <div className="meeting-list">
                {meetings.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="meeting-card glass-card"
                    onClick={() => {
                      setSelectedMeeting(meeting);
                    }}
                  >
                    <div className="meeting-card-title">{meeting.title}</div>
                    <div className="meeting-card-meta">
                      <span className={`chip ${meeting.modality === "Online" ? "chip-blue" : meeting.modality === "Hybrid" ? "chip-violet" : "chip-emerald"}`}>
                        {meeting.modality}
                      </span>
                      {meeting.date && <span><Icon icon={Calendar02Icon} size={14} /> {formatDate(meeting.date)}</span>}
                      {meeting.time && <span><Icon icon={Clock01Icon} size={14} /> {meeting.time}</span>}
                      <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                      <span className={`chip ${meeting.status === "completed" ? "chip-emerald" : meeting.status === "pending_poll" ? "chip-blue" : "chip-amber"}`}>
                        {meeting.status === "pending_poll" ? "Poll Open" : meeting.status}
                      </span>
                      {meeting.status === "pending_poll" && meeting.pollId && (
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ marginLeft: "auto" }}
                          onClick={(e) => { e.stopPropagation(); setPollMeetingId(meeting.id); }}
                        >
                          Vote
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div
            ref={meetingLayoutRef}
            className={`meeting-layout ${!agendaPanelOpen ? 'agenda-hidden' : ''} ${!rightPanelOpen ? 'right-hidden' : ''}`}
          >
            {agendaPanelOpen && (
              <div className="meeting-side-panel meeting-side-panel-left open">
                <AgendaPanel
                  agendaItems={agendaItems}
                  onItemChange={setAgendaItems}
                  onClose={toggleAgendaPanel}
                />
              </div>
            )}
            <VideoArea
              meetingId={selectedMeeting?.id}
              meetingTitle={selectedMeeting?.title || "Select a Meeting"}
              participants={selectedMeeting?.participants || []}
              modality={selectedMeeting?.modality}
              currentUser={user}
              fullscreenRef={meetingLayoutRef}
              agendaPanelOpen={agendaPanelOpen}
              rightPanelOpen={rightPanelOpen}
              onToggleAgendaPanel={toggleAgendaPanel}
              onToggleRightPanel={toggleRightPanel}
            />
            {rightPanelOpen && (
              <div className="meeting-side-panel meeting-side-panel-right open">
                <div className="right-panel-content">
                  <TranscriptFeed transcripts={transcripts} onClosePanel={toggleRightPanel} />
                  <ActionItems items={actionItems} />
                  <LiveOutcome />
                </div>
              </div>
            )}
          </div>
        );

      case "schedule":
        return (
          <div style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
            <h2
              style={{
                fontSize: "1.375rem",
                fontWeight: 700,
                marginBottom: "1rem",
              }}
            >
              Scheduled Meetings
            </h2>
            <div className="meeting-list">
              {meetings.map((meeting) => (
                <div
                  key={meeting.id}
                  className={`meeting-card glass-card ${selectedMeeting?.id === meeting.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedMeeting(meeting);
                    setCurrentView("meeting");
                  }}
                  style={
                    selectedMeeting?.id === meeting.id
                      ? { borderColor: "var(--primary-border)" }
                      : {}
                  }
                >
                  <div className="meeting-card-title">{meeting.title}</div>
                  <div className="meeting-card-meta">
                    <span
                      className={`chip ${meeting.modality === "Online" ? "chip-blue" : meeting.modality === "Hybrid" ? "chip-violet" : "chip-emerald"}`}
                    >
                      {meeting.modality}
                    </span>
                    {meeting.date && <span><Icon icon={Calendar02Icon} size={14} /> {formatDate(meeting.date)}</span>}
                    {meeting.time && <span><Icon icon={Clock01Icon} size={14} /> {meeting.time}</span>}
                    <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                    <span
                      className={`chip ${meeting.status === "completed" ? "chip-emerald" : meeting.status === "pending_poll" ? "chip-blue" : "chip-amber"}`}
                    >
                      {meeting.status === "pending_poll" ? "Poll Open" : meeting.status}
                    </span>
                    {meeting.status === "pending_poll" && meeting.pollId && (
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ marginLeft: 'auto' }}
                        onClick={(e) => { e.stopPropagation(); setPollMeetingId(meeting.id); }}
                      >
                        Vote
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case "archive":
        return (
          <div style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
            <h2
              style={{ fontSize: "1.375rem", fontWeight: 700, marginBottom: "0.5rem" }}
            >
              Meeting Archives
            </h2>
            <p
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-muted)",
                marginBottom: "1.25rem",
              }}
            >
              Search and browse past meeting transcripts, summaries, and action
              items.
            </p>
            <div className="meeting-list">
              {meetings
                .filter((m) => m.status === "completed")
                .map((meeting) => (
                  <div key={meeting.id} className="meeting-card glass-card">
                    <div className="meeting-card-title">{meeting.title}</div>
                    <div className="meeting-card-meta">
                      <span><Icon icon={Calendar02Icon} size={14} /> {formatDate(meeting.date)}</span>
                      <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                      <span className="chip chip-emerald">Completed</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        );

      case "analytics":
        return (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <ProductivityDashboard stats={dashboardStats} userName={user?.name} />
          </div>
        );

      case "profile":
        return (
          <div style={{ flex: 1, overflow: "auto" }}>
            <ProfileSettings />
          </div>
        );

      default:
        return (
          <div className="empty-state" style={{ flex: 1 }}>
            <p>Select a view from the sidebar</p>
          </div>
        );
    }
  };

  return (
    <div className="app-container">
      <TopBar
        streak={dashboardStats?.streak || 0}
        userName={user?.name || dashboardStats?.user || "User"}
        onNewMeeting={() => setShowCreateMeeting(true)}
        theme={theme}
        onToggleTheme={() =>
          setTheme((prev) => (prev === "dark" ? "light" : "dark"))
        }
        sidebarCollapsed={sidebarCollapsed}
        onSidebarToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={logout}
        onOpenPoll={(meetingId) => setPollMeetingId(meetingId)}
        searchInputRef={searchInputRef}
        onViewChange={setCurrentView}
      />

      <div className="main-area">
        <Sidebar
          currentView={currentView}
          onViewChange={setCurrentView}
          collapsed={sidebarCollapsed}
          onLogout={logout}
        />

        <div className="content-area">{renderContent()}</div>
      </div>

      {showCreateMeeting && (
        <MeetingCreation
          onClose={() => setShowCreateMeeting(false)}
          onSubmit={handleCreateMeeting}
        />
      )}

      {pollMeetingId && (
        <PollVoting
          meetingId={pollMeetingId}
          onClose={() => setPollMeetingId(null)}
        />
      )}
    </div>
  );
}

// Main App component that maps auth states to the correct UI
export default function App() {
  const { user, loading } = useAuth();
  const [authView, setAuthView] = useState("login"); // 'login' or 'signup'

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--bg-primary)",
        }}
      >
        <div style={{ color: "var(--primary)", fontSize: "1.5rem" }}>
          ⌘ MCMS Loading...
        </div>
      </div>
    );
  }

  // If not authenticated, show login or signup pages
  if (!user) {
    if (authView === "login") return <Login onNavigate={setAuthView} />;
    if (authView === "signup") return <Signup onNavigate={setAuthView} />;
  }

  // If authenticated, show the main dashboard
  return <DashboardApp />;
}
