import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import {
    Search01Icon,
    Notification01Icon,
    FireIcon,
    UserIcon,
    Sun03Icon,
    Add01Icon,
    Logout01Icon,
    Calendar02Icon,
    BarChartIcon,
    Tick01Icon,
    Moon02Icon,
} from '@hugeicons/core-free-icons';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import Kbd from './Kbd';
import ShortcutTooltip from './ShortcutTooltip';

const _raw = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const API_BASE = _raw.endsWith('/api') ? _raw : `${_raw}/api`;
const SERVER_BASE = _raw.replace(/\/api$/, '');

function SidebarToggleIcon({ collapsed }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="svg-icon sidebar-toggle-button-icon">
            <rect x="1" y="2" width="22" height="20" rx="4" />
            <rect x={collapsed ? "4.9" : "4"} y={collapsed ? "6" : "5"} width="2" height={collapsed ? "12" : "14"} rx="1" fill="currentColor" className={collapsed ? 'sidebar-toggle-icon-close' : 'sidebar-toggle-icon-open'} />
        </svg>
    );
}

function timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export default function TopBar({ streak, userName, onNewMeeting, theme = 'dark', onToggleTheme, sidebarCollapsed, onSidebarToggle, onLogout, onOpenPoll, searchInputRef, onViewChange }) {
    const { user } = useAuth();
    const { socket } = useSocket();
    const [showNotif, setShowNotif] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const notifRef = useRef(null);
    const userMenuRef = useRef(null);

    const unreadCount = notifications.filter(n => !n.read).length;

    useEffect(() => {
        if (!user?.token) return;
        fetch(`${API_BASE}/notifications`, {
            headers: { Authorization: `Bearer ${user.token}` },
        })
            .then(r => r.ok ? r.json() : [])
            .then(setNotifications)
            .catch(() => {});
    }, [user?.token]);

    useEffect(() => {
        if (!socket) return;
        const handler = (notif) => {
            setNotifications(prev => [notif, ...prev]);
        };
        socket.on('notification', handler);
        return () => socket.off('notification', handler);
    }, [socket]);

    useEffect(() => {
        function handleClickOutside(e) {
            if (notifRef.current && !notifRef.current.contains(e.target)) {
                setShowNotif(false);
            }
            if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
                setShowUserMenu(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const markAllRead = async () => {
        try {
            await fetch(`${API_BASE}/notifications/read-all`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${user?.token}`, 'Content-Type': 'application/json' },
            });
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        } catch { /* ignore */ }
    };

    const handleNotifClick = async (notif) => {
        if (!notif.read) {
            try {
                await fetch(`${API_BASE}/notifications/${notif._id}/read`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${user?.token}`, 'Content-Type': 'application/json' },
                });
                setNotifications(prev => prev.map(n => n._id === notif._id ? { ...n, read: true } : n));
            } catch { /* ignore */ }
        }

        if (notif.type === 'poll_invite' && onOpenPoll) {
            onOpenPoll(notif.meetingId?._id || notif.meetingId);
            setShowNotif(false);
        }
    };

    const getNotifIcon = (type) => {
        switch (type) {
            case 'poll_invite': return BarChartIcon;
            case 'meeting_confirmed': return Calendar02Icon;
            default: return Notification01Icon;
        }
    };

    return (
        <header className="topbar">
            <div className="topbar-left">
                <ShortcutTooltip keys={['mod', 'B']}>
                    <div type="button" className="sidebar-toggle" onClick={onSidebarToggle} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                        <SidebarToggleIcon collapsed={sidebarCollapsed} />
                    </div>
                </ShortcutTooltip>
                <div className="topbar-brand">
                    <span className="brand-name">MCMS</span>
                </div>
            </div>

            <div className="topbar-center">
                <div className="search-box">
                    <Icon icon={Search01Icon} size={16} />
                    <input ref={searchInputRef} type="text" placeholder="Search meetings, agendas, transcripts..." />
                    <Kbd keys={['mod', 'K']} className="kbd-hint" />
                </div>
            </div>

            <div className="topbar-right">
                <ShortcutTooltip keys={['Shift', 'M']}>
                    <button className="btn btn-primary" onClick={onNewMeeting} id="btn-new-meeting">
                        <Icon icon={Add01Icon} size={16} /> New Meeting
                    </button>
                </ShortcutTooltip>

                <div className="streak-badge tooltip" data-tooltip={`${streak} meeting streak!`}>
                    <Icon icon={FireIcon} size={16} className="streak-icon" />
                    <span>{streak}</span>
                </div>

                <div ref={notifRef} style={{ position: 'relative' }}>
                    <button
                        className={`btn-icon ${showNotif ? 'active' : ''}`}
                        onClick={() => setShowNotif(!showNotif)}
                        id="btn-notifications"
                    >
                        <Icon icon={Notification01Icon} size={18} />
                        {unreadCount > 0 && <span className="notif-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                    </button>

                    {showNotif && (
                        <div className="notification-dropdown">
                            <div className="notification-dropdown-header">
                                <span className="notification-dropdown-title">Notifications</span>
                                {unreadCount > 0 && (
                                    <button className="notification-mark-read" onClick={markAllRead}>
                                        <Icon icon={Tick01Icon} size={12} />
                                        Mark all read
                                    </button>
                                )}
                            </div>
                            <div className="notification-dropdown-body">
                                {notifications.length === 0 ? (
                                    <div className="notification-empty">No notifications yet</div>
                                ) : (
                                    notifications.map(n => (
                                        <button
                                            key={n._id}
                                            className={`notification-item${n.read ? '' : ' unread'}`}
                                            onClick={() => handleNotifClick(n)}
                                        >
                                            <div className={`notification-item-icon ${n.type === 'poll_invite' ? 'poll' : n.type === 'meeting_confirmed' ? 'confirmed' : ''}`}>
                                                <Icon icon={getNotifIcon(n.type)} size={14} />
                                            </div>
                                            <div className="notification-item-content">
                                                <p className="notification-item-message">{n.message}</p>
                                                <span className="notification-item-time">{timeAgo(n.createdAt)}</span>
                                            </div>
                                            {!n.read && <span className="notification-unread-dot" />}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div ref={userMenuRef} className="user-profile" style={{ position: 'relative' }}>
                    <div
                        className="user-menu"
                        onClick={() => setShowUserMenu(!showUserMenu)}
                        style={{ cursor: 'pointer' }}
                    >
                        <div className="user-avatar">
                            {user?.profileImage
                                ? <img src={`${SERVER_BASE}${user.profileImage}`} alt="" className="user-avatar-img" />
                                : <Icon icon={UserIcon} size={18} />
                            }
                        </div>
                    </div>

                    {showUserMenu && (
                        <div className="glass-card" style={{
                            position: 'absolute', right: 0, top: '3rem', width: '12.5rem',
                            padding: '0.5rem', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '0.25rem'
                        }}>
                            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '0.0625rem solid var(--border)', marginBottom: '0.25rem' }}>
                                <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{userName}</div>
                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Host Account</div>
                            </div>
                            <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start', border: 'none' }} onClick={() => { onViewChange?.('profile'); setShowUserMenu(false); }}>Profile Settings</button>
                            {onLogout && (
                                <button
                                    className="btn btn-secondary"
                                    style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--accent-rose)', border: 'none' }}
                                    onClick={onLogout}
                                >
                                    <Icon icon={Logout01Icon} size={16} />
                                    <span style={{ marginLeft: '0.5rem' }}>Logout</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <ShortcutTooltip keys={['D']}>
                    <button
                        type="button"
                        className={`theme-toggle tooltip ${theme === 'light' ? 'light' : 'dark'}`}
                        data-tooltip={theme === 'light' ? 'Toggle dark mode' : 'Toggle light mode'}
                        aria-label="Toggle color theme"
                        onClick={onToggleTheme}
                    >
                        <span className="theme-toggle-thumb">
                            {theme === 'light' ? <Icon icon={Sun03Icon} size={14} /> : <Icon icon={Moon02Icon} size={14} />}
                        </span>
                    </button>
                </ShortcutTooltip>
            </div>
        </header>
    );
}
