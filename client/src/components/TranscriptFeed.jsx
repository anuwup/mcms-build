import { useState, useEffect, useRef, useMemo } from 'react';
import Icon from './Icon';
import ShortcutTooltip from './ShortcutTooltip';
import { PinIcon, ThumbsUpIcon, ThumbsDownIcon, MinusSignIcon, ArrowDown01Icon, ArrowUp01Icon, Notebook01Icon, SidebarRightIcon } from '@hugeicons/core-free-icons';

const SERVER_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5001/api').replace(/\/api$/, '');

const sentimentConfig = {
    positive: { icon: ThumbsUpIcon, class: 'sentiment-positive', label: 'Positive' },
    neutral: { icon: MinusSignIcon, class: 'sentiment-neutral', label: 'Neutral' },
    negative: { icon: ThumbsDownIcon, class: 'sentiment-negative', label: 'Negative' },
};

const SPEAKER_COLORS = [
    '#3AA99F', '#8B7EC8', '#DA702C', '#D14D41',
    '#879A39', '#4385BE', '#CE5D97', '#5E409D',
];

function getSpeakerColor(speaker) {
    if (!speaker) return SPEAKER_COLORS[0];
    let hash = 0;
    for (let i = 0; i < speaker.length; i++) {
        hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
    }
    return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}

const TIME_GAP_FOR_NEW_PARAGRAPH_S = 15;

function parseTimestamp(ts) {
    if (!ts) return 0;
    const parts = ts.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

function groupTranscripts(transcripts) {
    if (!transcripts.length) return [];

    const groups = [];
    let current = null;

    for (const entry of transcripts) {
        const sameSpeaker = current && current.speaker === entry.speaker;
        const sameLang = current && current.languageCode === entry.languageCode;
        const timeDiff = current
            ? Math.abs(parseTimestamp(entry.timestamp) - parseTimestamp(current.lastTimestamp))
            : Infinity;
        const withinTimeWindow = timeDiff < TIME_GAP_FOR_NEW_PARAGRAPH_S;

        if (sameSpeaker && sameLang && withinTimeWindow) {
            current.texts.push(entry.text);
            current.lastTimestamp = entry.timestamp;
            current.lastId = entry.id;
            if (!current.speakerImage && entry.speakerImage) current.speakerImage = entry.speakerImage;
        } else {
            if (current) groups.push(current);
            current = {
                speaker: entry.speaker,
                speakerImage: entry.speakerImage || null,
                languageCode: entry.languageCode,
                firstTimestamp: entry.timestamp,
                lastTimestamp: entry.timestamp,
                texts: [entry.text],
                id: entry.id,
                lastId: entry.id,
            };
        }
    }
    if (current) groups.push(current);
    return groups;
}

export default function TranscriptFeed({ transcripts, isLive, onClosePanel }) {
    const listRef = useRef(null);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [transcripts.length]);

    const groups = useMemo(() => groupTranscripts(transcripts), [transcripts]);

    return (
        <div className="transcript-panel panel">
            <div className="section-header collapsible-header" onClick={() => setCollapsed(c => !c)}>
                <div className="section-title-container">
                    <Icon icon={Notebook01Icon} size={14} />
                    <span className="section-title">Live Transcript</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    {isLive && <span className="chip chip-emerald" style={{ fontSize: '10px' }}>● LIVE</span>}
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {transcripts.length} segment{transcripts.length !== 1 ? 's' : ''}
                    </span>
                    <Icon icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
                    {onClosePanel && (
                        <ShortcutTooltip keys={['mod', ']']} position="bottom">
                            <button
                                className="btn-icon"
                                onClick={(e) => { e.stopPropagation(); onClosePanel(); }}
                                id="btn-close-right-panel"
                            >
                                <Icon icon={SidebarRightIcon} size={14} />
                            </button>
                        </ShortcutTooltip>
                    )}
                </div>
            </div>

            {!collapsed && (
                <div className="transcript-list" ref={listRef}>
                    {groups.map((group, gi) => {
                        const color = getSpeakerColor(group.speaker);
                        return (
                            <div
                                key={group.id}
                                className="transcript-group animate-in"
                                style={{ animationDelay: `${gi * 0.04}s` }}
                            >
                                <div
                                    className="transcript-group-bar"
                                    style={{ backgroundColor: color }}
                                />
                                <div className="transcript-group-content">
                                    <div className="transcript-header">
                                        <div className="transcript-speaker-row">
                                            <div
                                                className="transcript-avatar"
                                                style={{ backgroundColor: group.speakerImage ? 'transparent' : color }}
                                            >
                                                {group.speakerImage
                                                    ? <img src={`${SERVER_BASE}${group.speakerImage}`} alt="" className="transcript-avatar-img" />
                                                    : (group.speaker?.charAt(0) || '?')
                                                }
                                            </div>
                                            <div>
                                                <span className="transcript-speaker">{group.speaker}</span>
                                                <span className="transcript-time">{group.firstTimestamp}</span>
                                            </div>
                                        </div>
                                        <div className="transcript-badges">
                                            {group.languageCode && (
                                                <span className="chip" style={{ padding: '2px 6px', fontSize: '9px' }}>
                                                    {group.languageCode}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <p className="transcript-text" id={`transcript-${group.id}`}>
                                        {group.texts.join(' ')}
                                    </p>

                                    <div className="transcript-actions">
                                        <button className="transcript-action-btn" id={`pin-${group.id}`}>
                                            <Icon icon={PinIcon} size={12} />
                                            Pin Resource
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {transcripts.length === 0 && (
                        <div className="empty-state">
                            <p style={{ fontSize: '14px' }}>No transcript yet</p>
                            <p style={{ fontSize: '12px' }}>Start recording to see live transcription here</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
