type Props = {
  seed: number;
  size?: number;
  level?: number;
  className?: string;
};

const PALETTES = [
  ["#3b82f6", "#1e3a8a"],
  ["#a855f7", "#581c87"],
  ["#ef4444", "#7f1d1d"],
  ["#10b981", "#064e3b"],
  ["#f59e0b", "#78350f"],
  ["#06b6d4", "#164e63"],
  ["#ec4899", "#831843"],
];

export function SummonerAvatar({ seed, size = 56, level, className = "" }: Props) {
  const [from, to] = PALETTES[seed % PALETTES.length];
  const initial = String.fromCharCode(65 + (seed % 26));
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center rounded-md font-bold text-white ring-2 ring-gold/60"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${from}, ${to})`,
          fontSize: size * 0.45,
        }}
      >
        {initial}
      </div>
      {level !== undefined && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-gold ring-1 ring-gold/60">
          {level}
        </span>
      )}
    </div>
  );
}
