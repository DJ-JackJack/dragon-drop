/** The Dragon Drop mark (a gold drop with a dragon's eye) and wordmark. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <defs>
        <linearGradient id="dd-g" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#fff0b0" /><stop offset="0.4" stopColor="#e6c25a" /><stop offset="0.75" stopColor="#bf9626" /><stop offset="1" stopColor="#7d5c10" />
        </linearGradient>
        <linearGradient id="dd-r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f3d77c" /><stop offset="1" stopColor="#8a6a18" /></linearGradient>
        <radialGradient id="dd-i" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stopColor="#ffe9a0" /><stop offset="0.6" stopColor="#e0a82e" /><stop offset="1" stopColor="#a8641a" /></radialGradient>
      </defs>
      <path d="M128 20 C153 57 205 100 205 156 A77 77 0 0 1 51 156 C51 100 103 57 128 20 Z" fill="url(#dd-g)" />
      <path d="M128 33 C150 64 193 104 193 154" fill="none" stroke="#fff6cf" strokeOpacity="0.5" strokeWidth="5" strokeLinecap="round" />
      <g transform="rotate(-9 128 158)">
        <path d="M62 158 C90 122 166 122 194 158 C166 194 90 194 62 158 Z" fill="#0a0a0c" />
        <circle cx="128" cy="158" r="26" fill="url(#dd-i)" />
        <ellipse cx="128" cy="158" rx="6" ry="22" fill="#0a0a0c" />
        <path d="M62 158 C90 122 166 122 194 158 C166 194 90 194 62 158 Z" fill="none" stroke="url(#dd-r)" strokeWidth="3.5" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand" data-testid="brand">
      <Logo size={26} />
      <span className="wordmark">Dragon Drop</span>
    </div>
  );
}
