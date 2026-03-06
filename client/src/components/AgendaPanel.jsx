import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import ShortcutTooltip from './ShortcutTooltip';
import {
  PlayIcon,
  PauseIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Add01Icon,
  ViewAgendaIcon,
  SidebarLeftIcon,
} from '@hugeicons/core-free-icons';

export default function AgendaPanel({ agendaItems, onItemChange, onClose }) {
    const [items, setItems] = useState(agendaItems);
    const [activeId, setActiveId] = useState(null);
    const [countdown, setCountdown] = useState(0);
    const intervalRef = useRef(null);

    useEffect(() => { setItems(agendaItems); }, [agendaItems]);

    useEffect(() => {
        const active = items.find(i => i.status === 'active');
        if (active) {
            setActiveId(active.id);
            setCountdown(active.duration * 60);
        }
    }, []);

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

    const startItem = (id) => {
        clearInterval(intervalRef.current);
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

    const pauseItem = () => {
        clearInterval(intervalRef.current);
    };

    const completeItem = (id) => {
        clearInterval(intervalRef.current);
        const updated = items.map(item => ({
            ...item,
            status: item.id === id ? 'completed' : item.status
        }));
        setItems(updated);
        setActiveId(null);
        setCountdown(0);
        onItemChange?.(updated);
    };

    const activeItem = items.find(i => i.id === activeId);
    const progress = activeItem ? ((activeItem.duration * 60 - countdown) / (activeItem.duration * 60)) * 100 : 0;

    return (
        <div className="agenda-panel panel">
            <div className="section-header">
				<div className="section-title-container">
					<Icon icon={ViewAgendaIcon} size={16} />
                <span className="section-title">Agenda</span>
				</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lk-size-2xs)' }}>
                    <button className="btn-icon" id="btn-add-agenda">
                        <Icon icon={Add01Icon} size={16} />
                    </button>
                    {onClose && (
                        <ShortcutTooltip keys={['mod', '[']} position="bottom">
                            <button
                                className="btn-icon"
                                onClick={onClose}
                                id="btn-close-agenda"
                            >
                                <Icon icon={SidebarLeftIcon} size={16} />
                            </button>
                        </ShortcutTooltip>
                    )}
                </div>
            </div>

            {activeId && (
                <div className="agenda-timer-bar">
                    <div className="timer-display">
                        <Icon icon={Clock01Icon} size={14} />
                        <span className="timer-value">{formatTime(countdown)}</span>
                        <span className="timer-label">remaining</span>
                    </div>
                    <div className="progress-bar">
                        <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>
            )}

            <div className="agenda-list">
                {items.map((item, index) => (
                    <div
                        key={item.id}
                        className={`agenda-item ${item.status} animate-in`}
                        style={{ animationDelay: `${index * 0.05}s` }}
                        id={`agenda-item-${item.id}`}
                    >
                        <div className="agenda-item-header">
                            <div className="agenda-item-number">
                                {item.status === 'completed' ? (
                                    <Icon icon={CheckmarkCircle01Icon} size={18} className="completed-icon" />
                                ) : item.status === 'active' ? (
                                    <div className="active-pulse"></div>
                                ) : (
                                    <span>{index + 1}</span>
                                )}
                            </div>
                            <div className="agenda-item-content">
                                <div className="agenda-item-title">{item.title}</div>
                                <div className="agenda-item-meta">
                                    <Icon icon={Clock01Icon} size={12} />
                                    <span>{item.duration} min</span>
                                </div>
                            </div>
                        </div>

                        {item.status !== 'completed' && (
                            <div className="agenda-item-actions">
                                {item.status === 'active' ? (
                                    <>
                                        <button className="btn btn-secondary" onClick={pauseItem} style={{ fontSize: '12px', padding: '5px 10px' }}>
                                            <Icon icon={PauseIcon} size={12} /> Pause
                                        </button>
                                        <button className="btn btn-success" onClick={() => completeItem(item.id)} style={{ fontSize: '12px', padding: '5px 10px' }}>
                                            <Icon icon={CheckmarkCircle01Icon} size={12} /> Complete
                                        </button>
                                    </>
                                ) : (
                                    <button className="btn btn-primary" onClick={() => startItem(item.id)} style={{ fontSize: '12px', padding: '5px 10px' }}>
                                        <Icon icon={PlayIcon} size={12} /> Start
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
