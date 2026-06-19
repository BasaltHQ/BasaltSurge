import re

file_path = r"u:\BasaltSurge\portalpay-official\src\components\landing\home-content.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replacement 1: Bento Box 1 (Checkout QR Scan)
target_1 = """                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(ellipse at 50% 60%, var(--pp-secondary) 0%, transparent 70%)' }} />
                      {/* Phone frame with QR */}
                      <div className="relative w-[45%] max-w-[160px] aspect-[9/16] rounded-[16px] border border-white/10 bg-black/80 shadow-[0_0_40px_rgba(0,0,0,0.5)] flex flex-col items-center justify-center overflow-hidden">
                        {/* Status bar */}
                        <div className="absolute top-0 left-0 right-0 h-5 flex items-center justify-center">
                          <div className="w-8 h-1.5 rounded-full bg-white/10 mt-1" />
                        </div>
                        {/* QR Code grid */}
                        <svg className="w-[65%] aspect-square" viewBox="0 0 80 80" fill="none">
                          {/* Corner brackets */}
                          <rect x="4" y="4" width="20" height="20" rx="2" stroke="var(--pp-secondary)" strokeWidth="2.5" fill="none" />
                          <rect x="8" y="8" width="12" height="12" rx="1" fill="var(--pp-secondary)" opacity="0.7" />
                          <rect x="56" y="4" width="20" height="20" rx="2" stroke="var(--pp-secondary)" strokeWidth="2.5" fill="none" />
                          <rect x="60" y="8" width="12" height="12" rx="1" fill="var(--pp-secondary)" opacity="0.7" />
                          <rect x="4" y="56" width="20" height="20" rx="2" stroke="var(--pp-secondary)" strokeWidth="2.5" fill="none" />
                          <rect x="8" y="60" width="12" height="12" rx="1" fill="var(--pp-secondary)" opacity="0.7" />
                          {/* Data dots */}
                          {[
                            [30,10],[36,10],[42,10],[48,10],
                            [30,16],[42,16],[30,22],[36,22],[48,22],
                            [10,30],[16,30],[22,30],[30,30],[42,30],[48,30],[54,30],[60,30],[66,30],[72,30],
                            [10,36],[30,36],[36,36],[48,36],[60,36],[72,36],
                            [10,42],[22,42],[30,42],[42,42],[54,42],[66,42],[72,42],
                            [10,48],[16,48],[30,48],[36,48],[48,48],[60,48],[72,48],
                            [30,54],[42,54],[48,54],[54,54],[60,54],[66,54],[72,54],
                            [30,60],[36,60],[48,60],[60,60],
                            [30,66],[42,66],[54,66],[66,66],[72,66],
                            [30,72],[36,72],[48,72],[60,72],[72,72],
                          ].map(([cx,cy], i) => (
                            <rect key={i} x={cx} y={cy} width="4" height="4" rx="0.5" fill="var(--pp-primary)" opacity={0.4 + (i % 3) * 0.2} />
                          ))}
                        </svg>
                        {/* Scan line sweeping over QR */}
                        <motion.div
                          animate={{ y: ['-80%', '80%'] }}
                          transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                          className="absolute left-[17%] right-[17%] h-[2px]"
                          style={{ background: 'var(--pp-secondary)', boxShadow: '0 0 12px 3px var(--pp-secondary)' }}
                        />
                        {/* Bottom pill button */}
                        <div className="absolute bottom-3 w-[50%] h-4 rounded-full opacity-40" style={{ backgroundColor: 'var(--pp-secondary)' }} />
                      </div>
                      {/* Pulse ring around phone */}
                      <motion.div
                        animate={{ scale: [1, 1.6], opacity: [0.3, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                        className="absolute w-[50%] max-w-[180px] aspect-[9/16] rounded-[20px] border-2 pointer-events-none"
                        style={{ borderColor: 'var(--pp-secondary)' }}
                      />
                    </div>"""

replace_1 = """                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      {/* Neutral Tech Background */}
                      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_bento_bg.png")' }} />
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(ellipse at 50% 60%, var(--pp-secondary, #10b981) 0%, transparent 70%)' }} />
                      {/* Phone frame with QR */}
                      <div className="relative w-[45%] max-w-[160px] aspect-[9/16] rounded-[16px] border border-white/20 bg-black/60 backdrop-blur-md shadow-[0_0_40px_rgba(0,0,0,0.6)] flex flex-col items-center justify-center overflow-hidden">
                        {/* Status bar */}
                        <div className="absolute top-0 left-0 right-0 h-5 flex items-center justify-center">
                          <div className="w-8 h-1.5 rounded-full bg-white/10 mt-1" />
                        </div>
                        {/* QR Code grid */}
                        <svg className="w-[65%] aspect-square" viewBox="0 0 80 80" fill="none">
                          {/* Corner brackets */}
                          <rect x="4" y="4" width="20" height="20" rx="2" stroke="var(--pp-secondary, #10b981)" strokeWidth="2.5" fill="none" />
                          <rect x="8" y="8" width="12" height="12" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.85" />
                          <rect x="56" y="4" width="20" height="20" rx="2" stroke="var(--pp-secondary, #10b981)" strokeWidth="2.5" fill="none" />
                          <rect x="60" y="8" width="12" height="12" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.85" />
                          <rect x="4" y="56" width="20" height="20" rx="2" stroke="var(--pp-secondary, #10b981)" strokeWidth="2.5" fill="none" />
                          <rect x="8" y="60" width="12" height="12" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.85" />
                          {/* Data dots */}
                          {[
                            [30,10],[36,10],[42,10],[48,10],
                            [30,16],[42,16],[30,22],[36,22],[48,22],
                            [10,30],[16,30],[22,30],[30,30],[42,30],[48,30],[54,30],[60,30],[66,30],[72,30],
                            [10,36],[30,36],[36,36],[48,36],[60,36],[72,36],
                            [10,42],[22,42],[30,42],[42,42],[54,42],[66,42],[72,42],
                            [10,48],[16,48],[30,48],[36,48],[48,48],[60,48],[72,48],
                            [30,54],[42,54],[48,54],[54,54],[60,54],[66,54],[72,54],
                            [30,60],[36,60],[48,60],[60,60],
                            [30,66],[42,66],[54,66],[66,66],[72,66],
                            [30,72],[36,72],[48,72],[60,72],[72,72],
                          ].map(([cx,cy], i) => (
                            <rect key={i} x={cx} y={cy} width="4" height="4" rx="0.5" fill="var(--pp-primary, #34d399)" opacity={0.65 + (i % 3) * 0.15} />
                          ))}
                        </svg>
                        {/* Scan line sweeping over QR */}
                        <motion.div
                          animate={{ y: ['-80%', '80%'] }}
                          transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                          className="absolute left-[17%] right-[17%] h-[2px]"
                          style={{ background: 'var(--pp-secondary, #10b981)', boxShadow: '0 0 16px 4px var(--pp-secondary, #10b981)' }}
                        />
                        {/* Bottom pill button */}
                        <div className="absolute bottom-3 w-[50%] h-4 rounded-full opacity-60" style={{ backgroundColor: 'var(--pp-secondary, #10b981)' }} />
                      </div>
                      {/* Pulse ring around phone */}
                      <motion.div
                        animate={{ scale: [1, 1.6], opacity: [0.35, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                        className="absolute w-[50%] max-w-[180px] aspect-[9/16] rounded-[20px] border-2 pointer-events-none"
                        style={{ borderColor: 'var(--pp-secondary, #10b981)' }}
                      />
                    </div>"""

# Replacement 2: Bento Box 2 (Custom Branding)
target_2 = """                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center p-6">
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-15" style={{ background: 'radial-gradient(ellipse at 30% 40%, var(--pp-primary) 0%, transparent 60%)' }} />
                      <div className="relative w-full max-w-[200px] flex flex-col gap-3">
                        {/* Color palette row */}
                        <div className="flex gap-2 justify-center">
                          {[
                            { color: 'var(--pp-primary)', delay: 0 },
                            { color: 'var(--pp-secondary)', delay: 0.3 },
                            { color: 'var(--pp-primary)', delay: 0.6, opacity: 0.5 },
                            { color: 'var(--pp-secondary)', delay: 0.9, opacity: 0.3 },
                          ].map((swatch, i) => (
                            <motion.div
                              key={i}
                              animate={{ scale: [1, 1.15, 1], opacity: [swatch.opacity || 0.8, 1, swatch.opacity || 0.8] }}
                              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: swatch.delay }}
                              className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg border border-white/10 shadow-lg"
                              style={{ backgroundColor: swatch.color }}
                            />
                          ))}
                        </div>
                        {/* Mini receipt skeleton */}
                        <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2.5 backdrop-blur-sm">
                          <div className="w-[60%] h-2 rounded-full mx-auto" style={{ backgroundColor: 'var(--pp-secondary)', opacity: 0.5 }} />
                          <div className="w-full h-[1px] bg-white/10" />
                          <div className="flex justify-between">
                            <div className="w-[40%] h-1.5 rounded-full bg-white/15" />
                            <div className="w-[20%] h-1.5 rounded-full bg-white/15" />
                          </div>
                          <div className="flex justify-between">
                            <div className="w-[55%] h-1.5 rounded-full bg-white/10" />
                            <div className="w-[15%] h-1.5 rounded-full bg-white/10" />
                          </div>
                          <div className="w-full h-[1px] bg-white/10" />
                          <div className="flex justify-between">
                            <div className="w-[30%] h-2 rounded-full bg-white/20 font-bold" />
                            <div className="w-[25%] h-2 rounded-full" style={{ backgroundColor: 'var(--pp-primary)', opacity: 0.5 }} />
                          </div>
                        </div>
                      </div>
                    </div>"""

replace_2 = """                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center p-6">
                      {/* Neutral Tech Background */}
                      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_bento_bg.png")' }} />
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-15" style={{ background: 'radial-gradient(ellipse at 30% 40%, var(--pp-primary, #34d399) 0%, transparent 60%)' }} />
                      <div className="relative w-full max-w-[200px] flex flex-col gap-3">
                        {/* Color palette row */}
                        <div className="flex gap-2 justify-center">
                          {[
                            { color: 'var(--pp-primary, #34d399)', delay: 0 },
                            { color: 'var(--pp-secondary, #10b981)', delay: 0.3 },
                            { color: 'var(--pp-primary, #34d399)', delay: 0.6, opacity: 0.5 },
                            { color: 'var(--pp-secondary, #10b981)', delay: 0.9, opacity: 0.3 },
                          ].map((swatch, i) => (
                            <motion.div
                              key={i}
                              animate={{ scale: [1, 1.15, 1], opacity: [swatch.opacity || 0.8, 1, swatch.opacity || 0.8] }}
                              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: swatch.delay }}
                              className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg border border-white/20 shadow-lg"
                              style={{ backgroundColor: swatch.color }}
                            />
                          ))}
                        </div>
                        {/* Mini receipt skeleton */}
                        <div className="mt-2 rounded-xl border border-white/20 bg-white/[0.06] p-4 flex flex-col gap-2.5 backdrop-blur-md shadow-xl">
                          <div className="w-[60%] h-2 rounded-full mx-auto" style={{ backgroundColor: 'var(--pp-secondary, #10b981)', opacity: 0.7 }} />
                          <div className="w-full h-[1px] bg-white/10" />
                          <div className="flex justify-between">
                            <div className="w-[40%] h-1.5 rounded-full bg-white/15" />
                            <div className="w-[20%] h-1.5 rounded-full bg-white/15" />
                          </div>
                          <div className="flex justify-between">
                            <div className="w-[55%] h-1.5 rounded-full bg-white/10" />
                            <div className="w-[15%] h-1.5 rounded-full bg-white/10" />
                          </div>
                          <div className="w-full h-[1px] bg-white/10" />
                          <div className="flex justify-between">
                            <div className="w-[30%] h-2 rounded-full bg-white/20 font-bold" />
                            <div className="w-[25%] h-2 rounded-full" style={{ backgroundColor: 'var(--pp-primary, #34d399)', opacity: 0.7 }} />
                          </div>
                        </div>
                      </div>
                    </div>"""

# Replacement 3: Bento Box 3 (Touchpoints)
target_3 = """                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(ellipse at 50% 20%, var(--pp-secondary) 0%, transparent 60%)' }} />
                      <svg className="w-[85%] h-[85%] max-w-[260px]" viewBox="0 0 200 140" fill="none">
                        {/* Cloud node at top */}
                        <ellipse cx="100" cy="20" rx="28" ry="12" stroke="var(--pp-secondary)" strokeWidth="1" fill="none" opacity="0.6" />
                        <text x="100" y="23" textAnchor="middle" fill="var(--pp-secondary)" fontSize="6" opacity="0.8">Cloud</text>
                        {/* Connection lines from cloud to devices */}
                        <path d="M80 30 L40 90" stroke="var(--pp-primary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3s" repeatCount="indefinite" />
                        </path>
                        <path d="M100 32 L100 90" stroke="var(--pp-secondary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="2.5s" repeatCount="indefinite" />
                        </path>
                        <path d="M120 30 L160 90" stroke="var(--pp-primary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3.5s" repeatCount="indefinite" />
                        </path>
                        {/* Kiosk (left) */}
                        <rect x="22" y="90" width="36" height="40" rx="3" stroke="var(--pp-secondary)" strokeWidth="1" fill="none" opacity="0.5" />
                        <rect x="26" y="94" width="28" height="24" rx="1" fill="var(--pp-secondary)" opacity="0.08" />
                        <text x="40" y="122" textAnchor="middle" fill="white" fontSize="5" opacity="0.4">Kiosk</text>
                        {/* Terminal (center) */}
                        <rect x="80" y="92" width="40" height="28" rx="3" stroke="var(--pp-secondary)" strokeWidth="1" fill="none" opacity="0.5" />
                        <rect x="84" y="96" width="32" height="16" rx="1" fill="var(--pp-secondary)" opacity="0.08" />
                        <rect x="88" y="120" width="24" height="6" rx="1" fill="var(--pp-primary)" opacity="0.15" />
                        <text x="100" y="136" textAnchor="middle" fill="white" fontSize="5" opacity="0.4">Terminal</text>
                        {/* Handheld (right) */}
                        <rect x="147" y="90" width="24" height="38" rx="4" stroke="var(--pp-secondary)" strokeWidth="1" fill="none" opacity="0.5" />
                        <rect x="150" y="94" width="18" height="24" rx="1" fill="var(--pp-secondary)" opacity="0.08" />
                        <text x="159" y="122" textAnchor="middle" fill="white" fontSize="5" opacity="0.4">Handheld</text>
                        {/* Pulse dots traveling down lines */}
                        <circle r="2" fill="var(--pp-secondary)" opacity="0.8">
                          <animateMotion path="M80 30 L40 90" dur="3s" repeatCount="indefinite" />
                        </circle>
                        <circle r="2" fill="var(--pp-secondary)" opacity="0.8">
                          <animateMotion path="M100 32 L100 90" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                        <circle r="2" fill="var(--pp-secondary)" opacity="0.8">
                          <animateMotion path="M120 30 L160 90" dur="3.5s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                    </div>"""

replace_3 = """                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      {/* Neutral Tech Background */}
                      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_bento_bg.png")' }} />
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(ellipse at 50% 20%, var(--pp-secondary, #10b981) 0%, transparent 60%)' }} />
                      <svg className="w-[85%] h-[85%] max-w-[260px]" viewBox="0 0 200 140" fill="none">
                        {/* Cloud node at top */}
                        <ellipse cx="100" cy="20" rx="28" ry="12" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="black" opacity="0.85" />
                        <text x="100" y="23" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="6.5" fontWeight="bold" opacity="0.95">Cloud</text>
                        {/* Connection lines from cloud to devices */}
                        <path d="M80 30 L40 90" stroke="var(--pp-primary, #34d399)" strokeWidth="1" strokeDasharray="3 3" opacity="0.75">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3s" repeatCount="indefinite" />
                        </path>
                        <path d="M100 32 L100 90" stroke="var(--pp-secondary, #10b981)" strokeWidth="1" strokeDasharray="3 3" opacity="0.75">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="2.5s" repeatCount="indefinite" />
                        </path>
                        <path d="M120 30 L160 90" stroke="var(--pp-primary, #34d399)" strokeWidth="1" strokeDasharray="3 3" opacity="0.75">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3.5s" repeatCount="indefinite" />
                        </path>
                        {/* Kiosk (left) */}
                        <rect x="22" y="90" width="36" height="40" rx="3" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" fill="black" opacity="0.8" />
                        <rect x="26" y="94" width="28" height="24" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                        <text x="40" y="122" textAnchor="middle" fill="white" fontSize="5.5" fontWeight="semibold" opacity="0.85">Kiosk</text>
                        {/* Terminal (center) */}
                        <rect x="80" y="92" width="40" height="28" rx="3" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" fill="black" opacity="0.8" />
                        <rect x="84" y="96" width="32" height="16" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                        <rect x="88" y="120" width="24" height="6" rx="1" fill="var(--pp-primary, #34d399)" opacity="0.25" />
                        <text x="100" y="136" textAnchor="middle" fill="white" fontSize="5.5" fontWeight="semibold" opacity="0.85">Terminal</text>
                        {/* Handheld (right) */}
                        <rect x="147" y="90" width="24" height="38" rx="4" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" fill="black" opacity="0.8" />
                        <rect x="150" y="94" width="18" height="24" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                        <text x="159" y="122" textAnchor="middle" fill="white" fontSize="5.5" fontWeight="semibold" opacity="0.85">Handheld</text>
                        {/* Pulse dots traveling down lines */}
                        <circle r="2.5" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M80 30 L40 90" dur="3s" repeatCount="indefinite" />
                        </circle>
                        <circle r="2.5" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M100 32 L100 90" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                        <circle r="2.5" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M120 30 L160 90" dur="3.5s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                    </div>"""

# Replacement 4: Bento Box 4 (Programmable Routing)
target_4 = """                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(ellipse at 30% 50%, var(--pp-primary) 0%, transparent 50%)' }} />
                      <svg className="w-[90%] h-[80%] max-w-[400px]" viewBox="0 0 300 180" fill="none">
                        {/* Source node — incoming payment */}
                        <rect x="10" y="70" width="60" height="40" rx="8" stroke="var(--pp-secondary)" strokeWidth="1.5" fill="none" opacity="0.6" />
                        <text x="40" y="86" textAnchor="middle" fill="var(--pp-secondary)" fontSize="7" opacity="0.9">Payment</text>
                        <text x="40" y="98" textAnchor="middle" fill="white" fontSize="6" opacity="0.4">$100.00</text>
                        {/* Central router hub */}
                        <circle cx="140" cy="90" r="18" stroke="var(--pp-secondary)" strokeWidth="1.5" fill="none" opacity="0.5" />
                        <circle cx="140" cy="90" r="8" fill="var(--pp-secondary)" opacity="0.15" />
                        <text x="140" y="93" textAnchor="middle" fill="var(--pp-secondary)" fontSize="6" opacity="0.8">Router</text>
                        {/* Line: source → router */}
                        <path d="M70 90 L122 90" stroke="var(--pp-primary)" strokeWidth="1" strokeDasharray="4 3" opacity="0.5">
                          <animate attributeName="stroke-dashoffset" from="28" to="0" dur="2s" repeatCount="indefinite" />
                        </path>
                        <circle r="2.5" fill="var(--pp-primary)" opacity="0.9">
                          <animateMotion path="M70 90 L122 90" dur="2s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 1 — Vendor (top) */}
                        <path d="M158 80 L220 40" stroke="var(--pp-secondary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="2.5s" repeatCount="indefinite" />
                        </path>
                        <rect x="220" y="22" width="65" height="36" rx="6" stroke="var(--pp-secondary)" strokeWidth="1" fill="none" opacity="0.5" />
                        <text x="252" y="38" textAnchor="middle" fill="white" fontSize="6" opacity="0.5">Vendor A</text>
                        <text x="252" y="50" textAnchor="middle" fill="var(--pp-secondary)" fontSize="7" opacity="0.7">50%</text>
                        <circle r="2" fill="var(--pp-secondary)" opacity="0.8">
                          <animateMotion path="M158 80 L220 40" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 2 — Platform (middle) */}
                        <path d="M158 90 L220 90" stroke="var(--pp-secondary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3s" repeatCount="indefinite" />
                        </path>
                        <rect x="220" y="72" width="65" height="36" rx="6" stroke="var(--pp-primary)" strokeWidth="1" fill="none" opacity="0.5" />
                        <text x="252" y="88" textAnchor="middle" fill="white" fontSize="6" opacity="0.5">Platform</text>
                        <text x="252" y="100" textAnchor="middle" fill="var(--pp-primary)" fontSize="7" opacity="0.7">30%</text>
                        <circle r="2" fill="var(--pp-primary)" opacity="0.8">
                          <animateMotion path="M158 90 L220 90" dur="3s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 3 — Reserve (bottom) */}
                        <path d="M158 100 L220 140" stroke="var(--pp-secondary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3.5s" repeatCount="indefinite" />
                        </path>
                        <rect x="220" y="122" width="65" height="36" rx="6" stroke="var(--pp-secondary)" strokeWidth="1" fill="none" opacity="0.5" />
                        <text x="252" y="138" textAnchor="middle" fill="white" fontSize="6" opacity="0.5">Reserve</text>
                        <text x="252" y="150" textAnchor="middle" fill="var(--pp-secondary)" fontSize="7" opacity="0.7">20%</text>
                        <circle r="2" fill="var(--pp-secondary)" opacity="0.8">
                          <animateMotion path="M158 100 L220 140" dur="3.5s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                    </div>"""

replace_4 = """                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      {/* Neutral Tech Background */}
                      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_bento_bg.png")' }} />
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(ellipse at 30% 50%, var(--pp-primary, #34d399) 0%, transparent 50%)' }} />
                      <svg className="w-[90%] h-[80%] max-w-[400px]" viewBox="0 0 300 180" fill="none">
                        {/* Source node — incoming payment */}
                        <rect x="10" y="70" width="60" height="40" rx="8" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="black" opacity="0.8" />
                        <text x="40" y="86" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="7.5" fontWeight="bold" opacity="0.95">Payment</text>
                        <text x="40" y="98" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="medium" opacity="0.8">$100.00</text>
                        {/* Central router hub */}
                        <circle cx="140" cy="90" r="18" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="black" opacity="0.8" />
                        <circle cx="140" cy="90" r="8" fill="var(--pp-secondary, #10b981)" opacity="0.2" />
                        <text x="140" y="93" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="6.5" fontWeight="bold" opacity="0.95">Router</text>
                        {/* Line: source → router */}
                        <path d="M70 90 L122 90" stroke="var(--pp-primary, #34d399)" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7">
                          <animate attributeName="stroke-dashoffset" from="28" to="0" dur="2s" repeatCount="indefinite" />
                        </path>
                        <circle r="3" fill="var(--pp-primary, #34d399)" opacity="1.0">
                          <animateMotion path="M70 90 L122 90" dur="2s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 1 — Vendor (top) */}
                        <path d="M158 80 L220 40" stroke="var(--pp-secondary, #10b981)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="2.5s" repeatCount="indefinite" />
                        </path>
                        <rect x="220" y="22" width="65" height="36" rx="6" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" fill="black" opacity="0.8" />
                        <text x="252" y="38" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="medium" opacity="0.75">Vendor A</text>
                        <text x="252" y="50" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="7.5" fontWeight="bold" opacity="0.9">50%</text>
                        <circle r="2.5" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M158 80 L220 40" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 2 — Platform (middle) */}
                        <path d="M158 90 L220 90" stroke="var(--pp-secondary, #10b981)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3s" repeatCount="indefinite" />
                        </path>
                        <rect x="220" y="72" width="65" height="36" rx="6" stroke="var(--pp-primary, #34d399)" strokeWidth="1.2" fill="black" opacity="0.8" />
                        <text x="252" y="88" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="medium" opacity="0.75">Platform</text>
                        <text x="252" y="100" textAnchor="middle" fill="var(--pp-primary, #34d399)" fontSize="7.5" fontWeight="bold" opacity="0.9">30%</text>
                        <circle r="2.5" fill="var(--pp-primary, #34d399)" opacity="1.0">
                          <animateMotion path="M158 90 L220 90" dur="3s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 3 — Reserve (bottom) */}
                        <path d="M158 100 L220 140" stroke="var(--pp-secondary, #10b981)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3.5s" repeatCount="indefinite" />
                        </path>
                        <rect x="220" y="122" width="65" height="36" rx="6" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" fill="black" opacity="0.8" />
                        <text x="252" y="138" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="medium" opacity="0.75">Reserve</text>
                        <text x="252" y="150" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="7.5" fontWeight="bold" opacity="0.9">20%</text>
                        <circle r="2.5" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M158 100 L220 140" dur="3.5s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                    </div>"""

# Replacement 5: Timeline
target_5 = """                <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                  {/* Ambient gradient */}
                  <div className="absolute inset-0 opacity-15" style={{ background: 'linear-gradient(135deg, var(--pp-primary) 0%, transparent 40%, var(--pp-secondary) 100%)' }} />
                  {/* 4-step pipeline SVG */}
                  <svg className="w-[90%] h-auto max-w-[500px]" viewBox="0 0 400 200" fill="none">
                    {/* Step nodes */}
                    {[
                      { x: 30, label: 'Configure', sub: 'Brand & Wallet', icon: 'M50 70 L50 60 L60 60 L60 70 M45 70 L65 70 L65 85 L45 85 Z' },
                      { x: 135, label: 'Generate', sub: 'Receipt & QR', icon: 'M155 60 L165 60 L165 70 L155 70 Z M155 72 L165 72 L165 82 L155 82 Z M152 58 L168 58 L168 84 L152 84 Z' },
                      { x: 240, label: 'Scan & Pay', sub: 'Instant Settle', icon: 'M260 60 L260 85 M252 68 L260 60 L268 68' },
                      { x: 345, label: 'Reconcile', sub: 'Real-time', icon: 'M358 62 L362 70 L366 62 M358 72 L362 80 L366 72 M355 58 L355 84 L369 84 L369 58 Z' },
                    ].map((step, i) => (
                      <g key={i}>
                        {/* Node circle */}
                        <circle cx={step.x + 10} cy={100} r="28" stroke="var(--pp-secondary)" strokeWidth="1" fill="none" opacity="0.4" />
                        <circle cx={step.x + 10} cy={100} r="16" fill="var(--pp-secondary)" opacity="0.06" />
                        {/* Step number */}
                        <text x={step.x + 10} y={105} textAnchor="middle" fill="var(--pp-secondary)" fontSize="14" fontWeight="bold" opacity="0.6">{i + 1}</text>
                        {/* Label */}
                        <text x={step.x + 10} y={148} textAnchor="middle" fill="white" fontSize="9" opacity="0.7">{step.label}</text>
                        <text x={step.x + 10} y={162} textAnchor="middle" fill="var(--pp-secondary)" fontSize="7" opacity="0.4">{step.sub}</text>
                      </g>
                    ))}
                    {/* Connectors with animated dash */}
                    {[
                      { d: 'M68 100 L107 100' },
                      { d: 'M173 100 L212 100' },
                      { d: 'M278 100 L317 100' },
                    ].map((conn, i) => (
                      <g key={i}>
                        <path d={conn.d} stroke="var(--pp-primary)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.4">
                          <animate attributeName="stroke-dashoffset" from="32" to="0" dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
                        </path>
                        {/* Chevron arrow */}
                        <circle r="3" fill="var(--pp-secondary)" opacity="0.8">
                          <animateMotion path={conn.d} dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
                        </circle>
                      </g>
                    ))}
                    {/* Speed lines burst from center */}
                    {[15, 35, 165, 185].map((y, i) => (
                      <line key={i} x1="120" y1={y} x2="280" y2={y} stroke="var(--pp-secondary)" strokeWidth="0.5" opacity="0.08" />
                    ))}
                  </svg>
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />"""

replace_5 = """                <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-start justify-center pt-16 md:pt-24">
                  {/* Neutral Tech Background */}
                  <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_timeline_bg.png")' }} />
                  {/* Ambient gradient */}
                  <div className="absolute inset-0 opacity-10" style={{ background: 'linear-gradient(135deg, var(--pp-primary, #34d399) 0%, transparent 40%, var(--pp-secondary, #10b981) 100%)' }} />
                  {/* 4-step pipeline SVG */}
                  <svg className="w-[90%] h-auto max-w-[500px]" viewBox="0 0 400 200" fill="none">
                    {/* Step nodes */}
                    {[
                      { x: 30, label: 'Configure', sub: 'Brand & Wallet', icon: 'M50 70 L50 60 L60 60 L60 70 M45 70 L65 70 L65 85 L45 85 Z' },
                      { x: 135, label: 'Generate', sub: 'Receipt & QR', icon: 'M155 60 L165 60 L165 70 L155 70 Z M155 72 L165 72 L165 82 L155 82 Z M152 58 L168 58 L168 84 L152 84 Z' },
                      { x: 240, label: 'Scan & Pay', sub: 'Instant Settle', icon: 'M260 60 L260 85 M252 68 L260 60 L268 68' },
                      { x: 345, label: 'Reconcile', sub: 'Real-time', icon: 'M358 62 L362 70 L366 62 M358 72 L362 80 L366 72 M355 58 L355 84 L369 84 L369 58 Z' },
                    ].map((step, i) => (
                      <g key={i}>
                        {/* Node circle */}
                        <circle cx={step.x + 10} cy={100} r="28" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="black" opacity="0.7" />
                        <circle cx={step.x + 10} cy={100} r="16" fill="var(--pp-secondary, #10b981)" opacity="0.12" />
                        {/* Step number */}
                        <text x={step.x + 10} y={105} textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="14" fontWeight="bold" opacity="0.95">{i + 1}</text>
                        {/* Label */}
                        <text x={step.x + 10} y={148} textAnchor="middle" fill="white" fontSize="9" fontWeight="semibold" opacity="0.95">{step.label}</text>
                        <text x={step.x + 10} y={162} textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="7" opacity="0.75">{step.sub}</text>
                      </g>
                    ))}
                    {/* Connectors with animated dash */}
                    {[
                      { d: 'M68 100 L107 100' },
                      { d: 'M173 100 L212 100' },
                      { d: 'M278 100 L317 100' },
                    ].map((conn, i) => (
                      <g key={i}>
                        <path d={conn.d} stroke="var(--pp-primary, #34d399)" strokeWidth="1.8" strokeDasharray="4 4" opacity="0.65">
                          <animate attributeName="stroke-dashoffset" from="32" to="0" dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
                        </path>
                        {/* Chevron arrow */}
                        <circle r="3" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path={conn.d} dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
                        </circle>
                      </g>
                    ))}
                    {/* Speed lines burst from center */}
                    {[15, 35, 165, 185].map((y, i) => (
                      <line key={i} x1="120" y1={y} x2="280" y2={y} stroke="var(--pp-secondary, #10b981)" strokeWidth="0.5" opacity="0.12" />
                    ))}
                  </svg>
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />"""

# Replacement 6: Crypto vs Legacy Rail
target_6 = """                <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                  {/* Ambient glow */}
                  <div className="absolute inset-0 opacity-12" style={{ background: 'radial-gradient(ellipse at 50% 60%, var(--pp-secondary) 0%, transparent 60%)' }} />
                  <svg className="w-[88%] h-auto max-w-[420px]" viewBox="0 0 360 260" fill="none">
                    {/* Legacy rail — crossed out */}
                    <g opacity="0.25">
                      <rect x="30" y="30" width="120" height="75" rx="8" stroke="white" strokeWidth="1" fill="none" />
                      <rect x="30" y="55" width="120" height="12" fill="white" opacity="0.1" />
                      <text x="90" y="50" textAnchor="middle" fill="white" fontSize="8">Card Rail</text>
                      <text x="90" y="92" textAnchor="middle" fill="white" fontSize="6" opacity="0.5">2-5 Day Settle</text>
                      {/* Strike-through */}
                      <line x1="25" y1="25" x2="155" y2="110" stroke="#ff4444" strokeWidth="1.5" opacity="0.6" />
                      <line x1="155" y1="25" x2="25" y2="110" stroke="#ff4444" strokeWidth="1.5" opacity="0.6" />
                    </g>
                    {/* Arrow from legacy to crypto */}
                    <path d="M160 67 L195 67" stroke="white" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.2" />
                    <text x="178" y="60" textAnchor="middle" fill="white" fontSize="7" opacity="0.3">→</text>

                    {/* Crypto rail — active */}
                    {/* Wallet node */}
                    <circle cx="230" cy="45" r="20" stroke="var(--pp-secondary)" strokeWidth="1.2" fill="none" opacity="0.6" />
                    <circle cx="230" cy="45" r="10" fill="var(--pp-secondary)" opacity="0.08" />
                    <text x="230" y="48" textAnchor="middle" fill="var(--pp-secondary)" fontSize="7" opacity="0.8">Wallet</text>

                    {/* Chain node */}
                    <circle cx="295" cy="130" r="22" stroke="var(--pp-primary)" strokeWidth="1.2" fill="none" opacity="0.6" />
                    <circle cx="295" cy="130" r="11" fill="var(--pp-primary)" opacity="0.08" />
                    <text x="295" y="128" textAnchor="middle" fill="var(--pp-primary)" fontSize="7" opacity="0.8">Chain</text>
                    <text x="295" y="138" textAnchor="middle" fill="white" fontSize="5" opacity="0.35">Finality</text>

                    {/* Merchant node */}
                    <circle cx="230" cy="215" r="20" stroke="var(--pp-secondary)" strokeWidth="1.2" fill="none" opacity="0.6" />
                    <circle cx="230" cy="215" r="10" fill="var(--pp-secondary)" opacity="0.08" />
                    <text x="230" y="218" textAnchor="middle" fill="var(--pp-secondary)" fontSize="7" opacity="0.8">Merchant</text>

                    {/* Path: Wallet → Chain */}
                    <path d="M248 55 L278 115" stroke="var(--pp-secondary)" strokeWidth="1" strokeDasharray="4 3" opacity="0.4">
                      <animate attributeName="stroke-dashoffset" from="28" to="0" dur="2s" repeatCount="indefinite" />
                    </path>
                    <circle r="2.5" fill="var(--pp-secondary)" opacity="0.9">
                      <animateMotion path="M248 55 L278 115" dur="2s" repeatCount="indefinite" />
                    </circle>

                    {/* Path: Chain → Merchant */}
                    <path d="M278 145 L248 205" stroke="var(--pp-primary)" strokeWidth="1" strokeDasharray="4 3" opacity="0.4">
                      <animate attributeName="stroke-dashoffset" from="28" to="0" dur="2.5s" repeatCount="indefinite" />
                    </path>
                    <circle r="2.5" fill="var(--pp-primary)" opacity="0.9">
                      <animateMotion path="M278 145 L248 205" dur="2.5s" repeatCount="indefinite" />
                    </circle>

                    {/* Settlement label */}
                    <text x="335" y="133" textAnchor="middle" fill="var(--pp-secondary)" fontSize="6" opacity="0.5">Instant</text>
                    <text x="335" y="143" textAnchor="middle" fill="var(--pp-secondary)" fontSize="6" opacity="0.5">Settlement</text>

                    {/* Zero chargeback badge */}
                    <rect x="55" y="140" width="100" height="30" rx="6" stroke="var(--pp-secondary)" strokeWidth="0.8" fill="none" opacity="0.3" />
                    <text x="105" y="155" textAnchor="middle" fill="var(--pp-secondary)" fontSize="7" opacity="0.6">0% Chargeback</text>
                    <text x="105" y="165" textAnchor="middle" fill="white" fontSize="5" opacity="0.3">Cryptographic Finality</text>
                  </svg>
                </div>"""

replace_6 = """                <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                  {/* Neutral Tech Background */}
                  <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-35 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_comparison_bg.png")' }} />
                  {/* Ambient glow */}
                  <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(ellipse at 50% 60%, var(--pp-secondary, #10b981) 0%, transparent 60%)' }} />
                  <svg className="w-[88%] h-auto max-w-[420px]" viewBox="0 0 360 260" fill="none">
                    {/* Legacy rail — crossed out */}
                    <g opacity="0.45">
                      <rect x="30" y="30" width="120" height="75" rx="8" stroke="white" strokeWidth="1.2" fill="black" />
                      <rect x="30" y="55" width="120" height="12" fill="white" opacity="0.15" />
                      <text x="90" y="50" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">Card Rail</text>
                      <text x="90" y="92" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="semibold" opacity="0.7">2-5 Day Settle</text>
                      {/* Strike-through */}
                      <line x1="25" y1="25" x2="155" y2="110" stroke="#ef4444" strokeWidth="2" opacity="0.9" />
                      <line x1="155" y1="25" x2="25" y2="110" stroke="#ef4444" strokeWidth="2" opacity="0.9" />
                    </g>
                    {/* Arrow from legacy to crypto */}
                    <path d="M160 67 L195 67" stroke="white" strokeWidth="1" strokeDasharray="3 3" opacity="0.45" />
                    <text x="178" y="60" textAnchor="middle" fill="white" fontSize="8.5" fontWeight="bold" opacity="0.6">→</text>

                    {/* Crypto rail — active */}
                    {/* Wallet node */}
                    <circle cx="230" cy="45" r="20" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="black" opacity="0.8" />
                    <circle cx="230" cy="45" r="10" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                    <text x="230" y="48" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="7.5" fontWeight="bold" opacity="0.95">Wallet</text>

                    {/* Chain node */}
                    <circle cx="295" cy="130" r="22" stroke="var(--pp-primary, #34d399)" strokeWidth="1.5" fill="black" opacity="0.8" />
                    <circle cx="295" cy="130" r="11" fill="var(--pp-primary, #34d399)" opacity="0.15" />
                    <text x="295" y="128" textAnchor="middle" fill="var(--pp-primary, #34d399)" fontSize="7.5" fontWeight="bold" opacity="0.95">Chain</text>
                    <text x="295" y="138" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="semibold" opacity="0.65">Finality</text>

                    {/* Merchant node */}
                    <circle cx="230" cy="215" r="20" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="black" opacity="0.8" />
                    <circle cx="230" cy="215" r="10" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                    <text x="230" y="218" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="7.5" fontWeight="bold" opacity="0.95">Merchant</text>

                    {/* Path: Wallet → Chain */}
                    <path d="M248 55 L278 115" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.6">
                      <animate attributeName="stroke-dashoffset" from="28" to="0" dur="2s" repeatCount="indefinite" />
                    </path>
                    <circle r="3" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                      <animateMotion path="M248 55 L278 115" dur="2s" repeatCount="indefinite" />
                    </circle>

                    {/* Path: Chain → Merchant */}
                    <path d="M278 145 L248 205" stroke="var(--pp-primary, #34d399)" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.6">
                      <animate attributeName="stroke-dashoffset" from="28" to="0" dur="2.5s" repeatCount="indefinite" />
                    </path>
                    <circle r="3" fill="var(--pp-primary, #34d399)" opacity="1.0">
                      <animateMotion path="M278 145 L248 205" dur="2.5s" repeatCount="indefinite" />
                    </circle>

                    {/* Settlement label */}
                    <text x="335" y="133" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="6.5" fontWeight="semibold" opacity="0.8">Instant</text>
                    <text x="335" y="143" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="6.5" fontWeight="semibold" opacity="0.8">Settlement</text>

                    {/* Zero chargeback badge */}
                    <rect x="55" y="140" width="100" height="30" rx="6" stroke="var(--pp-secondary, #10b981)" strokeWidth="1" fill="black" opacity="0.5" />
                    <text x="105" y="155" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="7.5" fontWeight="bold" opacity="0.9">0% Chargeback</text>
                    <text x="105" y="165" textAnchor="middle" fill="white" fontSize="5.5" fontWeight="semibold" opacity="0.6">Cryptographic Finality</text>
                  </svg>
                </div>"""

# Standardize newlines for safety
content = content.replace('\\r\\n', '\\n').replace('\\r', '\\n')

for i, (t, r) in enumerate([
    (target_1, replace_1),
    (target_2, replace_2),
    (target_3, replace_3),
    (target_4, replace_4),
    (target_5, replace_5),
    (target_6, replace_6)
], 1):
    t_clean = t.replace('\\r\\n', '\\n').replace('\\r', '\\n').strip()
    r_clean = r.replace('\\r\\n', '\\n').replace('\\r', '\\n').strip()
    
    if t_clean in content:
        content = content.replace(t_clean, r_clean)
        print(f"Replacement {i} succeeded.")
    else:
        # Fallback to looser whitespace matching if direct replacement fails
        t_normalized = re.sub(r'\\s+', ' ', t_clean)
        # Find exact start/end tokens to replace
        print(f"Warning: Exact match for Replacement {i} failed. Trying regex/loose spacing.")
        # Try to locate by lines
        # Let's do a simple line-by-line match for this target block
        lines = t_clean.split('\\n')
        first_line = lines[0].strip()
        last_line = lines[-1].strip()
        print(f"Target start: {first_line}")
        print(f"Target end: {last_line}")
        
        # Build simple regex pattern
        # Escaping regex symbols but allowing flexible spacing between words
        escaped_first = re.escape(first_line).replace(r'\\ ', r'\\s+')
        escaped_last = re.escape(last_line).replace(r'\\ ', r'\\s+')
        pattern = escaped_first + r'.*?' + escaped_last
        
        content, count = re.subn(pattern, r_clean, content, flags=re.DOTALL)
        if count > 0:
            print(f"Loose spacing Replacement {i} succeeded ({count} matches).")
        else:
            print(f"ERROR: Replacement {i} failed completely.")

# Save modified content back (preserving OS default line endings)
with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Process completed.")
