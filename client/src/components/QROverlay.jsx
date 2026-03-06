import Icon from './Icon';
import { Cancel01Icon } from '@hugeicons/core-free-icons';

export default function QROverlay({ onClose, meetingTitle }) {
    return (
        <div className="qr-overlay" onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()}>
                <div className="qr-box">
                    {/* Simulated QR code pattern */}
                    <svg width="180" height="180" viewBox="0 0 180 180">
                        <rect width="180" height="180" fill="white" rx="8" />
                        {/* QR-like pattern */}
                        <g fill="#111827">
                            {/* Top-left finder */}
                            <rect x="10" y="10" width="42" height="42" rx="4" />
                            <rect x="16" y="16" width="30" height="30" rx="2" fill="white" />
                            <rect x="22" y="22" width="18" height="18" rx="2" fill="#111827" />
                            {/* Top-right finder */}
                            <rect x="128" y="10" width="42" height="42" rx="4" />
                            <rect x="134" y="16" width="30" height="30" rx="2" fill="white" />
                            <rect x="140" y="22" width="18" height="18" rx="2" fill="#111827" />
                            {/* Bottom-left finder */}
                            <rect x="10" y="128" width="42" height="42" rx="4" />
                            <rect x="16" y="134" width="30" height="30" rx="2" fill="white" />
                            <rect x="22" y="140" width="18" height="18" rx="2" fill="#111827" />
                            {/* Data modules */}
                            {Array.from({ length: 12 }, (_, r) =>
                                Array.from({ length: 12 }, (_, c) => {
                                    if ((r < 4 && c < 4) || (r < 4 && c > 7) || (r > 7 && c < 4)) return null;
                                    const show = Math.random() > 0.4;
                                    if (!show) return null;
                                    return <rect key={`${r}-${c}`} x={10 + c * 13.5} y={10 + r * 13.5} width="10" height="10" rx="1.5" fill="#111827" opacity="0.85" />;
                                })
                            )}
                        </g>
                        {/* Center brand */}
                        <rect x="70" y="70" width="40" height="40" rx="8" fill="white" />
                        <rect x="74" y="74" width="32" height="32" rx="6" fill="url(#qrGrad)" />
                        <defs>
                            <linearGradient id="qrGrad" x1="0" y1="0" x2="1" y2="1">
                                <stop stopColor="#4F8EF7" />
                                <stop offset="1" stopColor="#7C5CFC" />
                            </linearGradient>
                        </defs>
                    </svg>
                </div>

                <div style={{ textAlign: 'center', color: 'white' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Scan for Attendance</h3>
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{meetingTitle}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        This QR code expires in <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>2:00</span>
                    </p>
                </div>

                <button
                    onClick={onClose}
                    className="btn btn-secondary"
                    style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                    <Icon icon={Cancel01Icon} size={16} /> Close
                </button>
            </div>
        </div>
    );
}
