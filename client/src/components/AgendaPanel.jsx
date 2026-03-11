import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from './Icon';
import ShortcutTooltip from './ShortcutTooltip';
import {
    PlayIcon, PauseIcon, CheckmarkCircle01Icon, Clock01Icon,
    Add01Icon, ViewAgendaIcon, SidebarLeftIcon,
} from '@hugeicons/core-free-icons';
import { useSocket } from '../context/SocketContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

export default function AgendaPanel({ agendaItems, meetingId, isHost, onItemChange, onClose, fetchWithAuth, addAgendaItemTrigger, onAddTriggered }) {
    const { socket } = useSocket();
    const [items, setItems] = useState(agendaItems);
    const [activeId, setActiveId] = useState(null);
    const [countdown, setCountdown] = useState(0);
    const [addingItem, setAddingItem] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDuration, setNewDuration] = useState(10);
    const intervalRef = useRef(null);

    useEffect(() => { setItems(agendaItems); }, [agendaItems]);

    useEffect(() => {
        if (addAgendaItemTrigger && addAgendaItemTrigger > 0) {
            setAddingItem(true);
            onAddTriggered?.();
        }
    }, [addAgendaItemTrigger, onAddTriggered]);

    useEffect(() => {
        const active = items.find(i => i.status === 'active');
        if (active) {
            setActiveId(active.id);
            setCountdown(active.duration * 60);
        }
    }, []);

    useEffect(() => {
        if (!socket) return;
        const handleSync = ({ meetingId: mid, items: syncedItems, activeItemId }) => {
            if (mid !== meetingId) return;
            setItems(syncedItems);
            setActiveId(activeItemId);
            onItemChange?.(syncedItems);

            if (activeItemId) {
                const item = syncedItems.find(i => i.id === activeItemId);
                if (item) setCountdown(item.duration * 60);
            } else {
                clearInterval(intervalRef.current);
                setCountdown(0);
            }
        };
        socket.on('agenda_sync', handleSync);
        return () => socket.off('agenda_sync', handleSync);
    }, [socket, meetingId, onItemChange]);

    useEffect(() => {
        if (activeId && countdown > 0) {
            intervalRef.current = setInterval(() => {
                setCountdown(prev => {
                    if (prev <= 1) { clearInterval(intervalRef.current); return 0; }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(intervalRef.current);
    }, [activeId]);

    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const emitAction = useCallback((action, itemId) => {
        if (socket && meetingId) {
            socket.emit('agenda_action', { meetingId, action, itemId });
        }
    }, [socket, meetingId]);

    const startItem = (id) => {
        clearInterval(intervalRef.current);
        emitAction('start', id);
        const updated = items.map(item => ({
            ...item,
            status: item.id === id ? 'active' : (item.status === 'active' ? 'completed' : item.status)
        }));
        setItems(updated);
        setActiveId(id);
        const item = items.find(i => i.id === id);
        setCountdown(item.duration * 60);
        onItemChange?.(updated);
    };

    const pauseItem = (id) => {
        clearInterval(intervalRef.current);
        emitAction('pause', id);
    };

    const completeItem = (id) => {
        clearInterval(intervalRef.current);
        emitAction('complete', id);
        const updated = items.map(item => ({
            ...item,
            status: item.id === id ? 'completed' : item.status
        }));
        setItems(updated);
        setActiveId(null);
        setCountdown(0);
        onItemChange?.(updated);
    };

    const handleAddItem = async () => {
        if (!newTitle.trim()) return;
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/agenda/${meetingId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle.trim(), duration: newDuration }),
            });
            if (res.ok) {
                const item = await res.json();
                setItems(prev => [...prev, item]);
                onItemChange?.([...items, item]);
                setNewTitle('');
                setNewDuration(10);
                setAddingItem(false);
            }
        } catch (err) {
            console.error('Failed to add agenda item:', err);
        }
    };

    const activeItem = items.find(i => i.id === activeId);
    const progress = activeItem ? ((activeItem.duration * 60 - countdown) / (activeItem.duration * 60)) * 100 : 0;

    return (
        <div className="agenda-panel panel">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="section-title-container">
                    <Icon icon={ViewAgendaIcon} size={14} />
                    <span className="section-title">Agenda</span>
                    <span className="chip chip-blue">{items.length}</span>
                </div>
                {onClose && (
                    <ShortcutTooltip keys={['mod', '[']} position="bottom">
                        <button className="btn-icon" onClick={onClose} id="btn-close-agenda">
                            <Icon icon={SidebarLeftIcon} size={16} />
                        </button>
                    </ShortcutTooltip>
                )}
            </div>

            {activeId && (
                <div className="agenda-progress-bar">
                    <div className="agenda-progress-fill" style={{ width: `${progress}%` }}></div>
                    <div className="agenda-progress-label">
                        <span>{activeItem?.title}</span>
                        <span className="countdown-badge">{formatTime(countdown)}</span>
                    </div>
                </div>
            )}

            <div className="agenda-items-list">
                {items.map((item, index) => {
                    const isActive = item.id === activeId;
                    return (
                        <div
                            key={item.id}
                            className={`agenda-item-row ${isActive ? 'active' : ''} ${item.status === 'completed' ? 'completed' : ''}`}
                        >
                            <div className="agenda-item-info">
                                <span className="agenda-item-number">{index + 1}</span>
                                <span className="agenda-item-title">{item.title}</span>
                                <span className="agenda-item-duration">{item.duration}m</span>
                            </div>

                            {isHost && (
                                <div className="agenda-item-actions">
                                    {item.status !== 'completed' && !isActive && (
                                        <button className="btn-icon btn-icon-sm" onClick={() => startItem(item.id)}>
                                            <Icon icon={PlayIcon} size={12} />
                                        </button>
                                    )}
                                    {isActive && (
                                        <>
                                            <button className="btn-icon btn-icon-sm" onClick={() => pauseItem(item.id)}>
                                                <Icon icon={PauseIcon} size={12} />
                                            </button>
                                            <button className="btn-icon btn-icon-sm" onClick={() => completeItem(item.id)}>
                                                <Icon icon={CheckmarkCircle01Icon} size={12} />
                                            </button>
                                        </>
                                    )}
                                    {item.status === 'completed' && (
                                        <Icon icon={CheckmarkCircle01Icon} size={14} style={{ color: 'var(--accent-emerald)' }} />
                                    )}
                                </div>
                            )}
                            {!isHost && item.status === 'completed' && (
                                <Icon icon={CheckmarkCircle01Icon} size={14} style={{ color: 'var(--accent-emerald)' }} />
                            )}
                        </div>
                    );
                })}
            </div>

            {addingItem ? (
                <div
                    className="inline-form-card"
                    style={{ margin: '0 0.5rem 0.5rem' }}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAddingItem(false); } }}
                >
                    <input
                        type="text"
                        className="input-field"
                        placeholder="Item title..."
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAddingItem(false); } }}
                        autoFocus
                        style={{ marginBottom: '0.25rem' }}
                    />
                    <div className="inline-form-row">
                        <input
                            type="number"
                            className="input-field"
                            value={newDuration}
                            onChange={(e) => setNewDuration(parseInt(e.target.value) || 5)}
                            min={1}
                        />
                        <span className="unit-label">min</span>
                        <button className="btn btn-sm btn-primary" onClick={handleAddItem} style={{ marginLeft: 'auto' }}>Add</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => setAddingItem(false)}>Cancel</button>
                    </div>
                </div>
            ) : (
                <ShortcutTooltip keys={['A']} position="top" fullWidth>
                    <button
                        className="btn btn-secondary"
                        style={{ margin: '0 var(--lk-size-sm)', width: 'calc(100% - 2 * var(--lk-size-sm))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => setAddingItem(true)}
                    >
                        <Icon icon={Add01Icon} size={16} /> Add Item
                    </button>
                </ShortcutTooltip>
            )}
        </div>
    );
}
