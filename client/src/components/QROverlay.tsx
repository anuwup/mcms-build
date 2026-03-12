import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from './Icon';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

interface QROverlayProps {
    onClose: () => void;
    meetingTitle: string;
    meetingId: string;
}

export default function QROverlay({ onClose, meetingTitle, meetingId }: QROverlayProps) {
    const { user } = useAuth();
    const [qrUrl, setQrUrl] = useState<string | null>(null);
    const [expiresAt, setExpiresAt] = useState<Date | null>(null);
    const [countdown, setCountdown] = useState(120);
    const [error, setError] = useState<string | null>(null);

    const generateQR = useCallback(async () => {
        if (!meetingId) return;
        try {
            setError(null);
            const res = await fetch(`${API_BASE}/attendance/${meetingId}/generate-qr`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${user?.token}`,
                },
            });
            if (!res.ok) {
                const data = await res.json();
                setError(data.message || 'Failed to generate QR');
                return;
            }
            const data = await res.json();
            setQrUrl(data.url);
            setExpiresAt(new Date(data.expiresAt));
            setCountdown(120);
        } catch (err) {
            setError('Failed to connect to server');
        }
    }, [meetingId, user?.token]);

    useEffect(() => { generateQR(); }, [generateQR]);

    useEffect(() => {
        if (countdown <= 0) {
            generateQR();
            return;
        }
        const timer = setInterval(() => setCountdown(c => c - 1), 1000);
        return () => clearInterval(timer);
    }, [countdown, generateQR]);

    const formatCountdown = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    return (
        <div className="qr-overlay" onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <div className="qr-box" style={{ background: 'white', padding: '16px', borderRadius: '12px' }}>
                    {qrUrl ? (
                        <QRCodeSVG
                            value={qrUrl}
                            size={200}
                            level="H"
                            includeMargin
                            bgColor="#ffffff"
                            fgColor="#111827"
                        />
                    ) : error ? (
                        <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontSize: '14px', textAlign: 'center', padding: '20px' }}>
                            {error}
                        </div>
                    ) : (
                        <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
                            Generating...
                        </div>
                    )}
                </div>

                <div style={{ textAlign: 'center', color: 'white' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Scan for Attendance</h3>
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{meetingTitle}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Auto-refreshes in <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>{formatCountdown(countdown)}</span>
                    </p>
                </div>

                <button
                    onClick={onClose}
                    className="btn btn-secondary"
                    style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                    <Icon icon={Cancel01Icon} size={16} /> Close
                </button>
            </div>
        </div>
    );
}
