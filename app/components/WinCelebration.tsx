"use client";

import { FC, useEffect, useState, useCallback } from "react";

interface WinCelebrationProps {
  isActive: boolean;
  winAmount?: number; // In lamports
  onComplete?: () => void;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  opacity: number;
  shape: "circle" | "square" | "diamond";
}

const COLORS = [
  "#f4c430", // Gold light
  "#d4a012", // Gold main
  "#8b6914", // Gold dark
  "#2ecc71", // Green
  "#27ae60", // Dark green
  "#ffffff", // White sparkle
];

const SHAPES: Particle["shape"][] = ["circle", "square", "diamond"];

export const WinCelebration: FC<WinCelebrationProps> = ({
  isActive,
  winAmount,
  onComplete,
}) => {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [showBanner, setShowBanner] = useState(false);

  const createParticles = useCallback(() => {
    const newParticles: Particle[] = [];
    const particleCount = 60;

    for (let i = 0; i < particleCount; i++) {
      // Particles originate from center-bottom area and burst upward/outward
      const angle = (Math.random() * Math.PI * 2);
      const speed = 2 + Math.random() * 6;

      newParticles.push({
        id: i,
        x: 50 + (Math.random() - 0.5) * 20, // Center with slight variance
        y: 60 + Math.random() * 10, // Start from lower-middle
        size: 4 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        velocityX: Math.cos(angle) * speed,
        velocityY: -Math.abs(Math.sin(angle) * speed) - 2, // Bias upward
        rotationSpeed: (Math.random() - 0.5) * 10,
        opacity: 1,
        shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      });
    }

    return newParticles;
  }, []);

  useEffect(() => {
    if (!isActive) {
      setParticles([]);
      setShowBanner(false);
      return;
    }

    // Create initial particles
    setParticles(createParticles());
    setShowBanner(true);

    // Animate particles
    const animationInterval = setInterval(() => {
      setParticles((prev) => {
        const updated = prev.map((p) => ({
          ...p,
          x: p.x + p.velocityX * 0.3,
          y: p.y + p.velocityY * 0.3,
          velocityY: p.velocityY + 0.15, // Gravity
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.015),
        }));

        // Remove particles that are invisible or off-screen
        return updated.filter((p) => p.opacity > 0 && p.y < 120);
      });
    }, 16); // ~60fps

    // End celebration after duration
    const timeout = setTimeout(() => {
      setShowBanner(false);
      setTimeout(() => {
        setParticles([]);
        onComplete?.();
      }, 500);
    }, 2000);

    return () => {
      clearInterval(animationInterval);
      clearTimeout(timeout);
    };
  }, [isActive, createParticles, onComplete]);

  if (!isActive && particles.length === 0) return null;

  const winInSol = winAmount ? (winAmount / 1e9).toFixed(2) : null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {/* Particle layer */}
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size,
            opacity: particle.opacity,
            transform: `rotate(${particle.rotation}deg)`,
            transition: "none",
          }}
        >
          {particle.shape === "circle" && (
            <div
              className="w-full h-full rounded-full"
              style={{
                background: particle.color,
                boxShadow: `0 0 ${particle.size}px ${particle.color}`,
              }}
            />
          )}
          {particle.shape === "square" && (
            <div
              className="w-full h-full"
              style={{
                background: particle.color,
                boxShadow: `0 0 ${particle.size / 2}px ${particle.color}`,
              }}
            />
          )}
          {particle.shape === "diamond" && (
            <div
              className="w-full h-full rotate-45"
              style={{
                background: particle.color,
                boxShadow: `0 0 ${particle.size / 2}px ${particle.color}`,
              }}
            />
          )}
        </div>
      ))}

      {/* Winner banner */}
      {showBanner && (
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            animation: "win-banner-enter 0.5s ease-out forwards",
          }}
        >
          {/* Glow backdrop */}
          <div
            className="absolute -inset-8 rounded-3xl"
            style={{
              background: "radial-gradient(ellipse at center, rgba(212, 160, 18, 0.4) 0%, transparent 70%)",
              filter: "blur(20px)",
              animation: "win-glow-pulse 1s ease-in-out infinite",
            }}
          />

          {/* Banner content */}
          <div
            className="relative glass rounded-2xl px-12 py-6 text-center"
            style={{
              border: "2px solid rgba(212, 160, 18, 0.5)",
              boxShadow: "0 0 40px rgba(212, 160, 18, 0.3), inset 0 0 30px rgba(212, 160, 18, 0.1)",
            }}
          >
            {/* Trophy icon */}
            <div className="flex justify-center mb-3">
              <svg
                className="w-12 h-12 text-[var(--gold-light)]"
                fill="currentColor"
                viewBox="0 0 24 24"
                style={{
                  filter: "drop-shadow(0 0 10px rgba(244, 196, 48, 0.6))",
                }}
              >
                <path d="M12 2C13.1 2 14 2.9 14 4V5H16C16.55 5 17 5.45 17 6V8C17 9.66 15.66 11 14 11H13.82C13.4 12.84 11.85 14.22 10 14.83V17H14V19H6V17H10V14.83C8.15 14.22 6.6 12.84 6.18 11H6C4.34 11 3 9.66 3 8V6C3 5.45 3.45 5 4 5H6V4C6 2.9 6.9 2 8 2H12ZM14 7H16V8C16 8.55 15.55 9 15 9H14V7ZM6 7V9H5C4.45 9 4 8.55 4 8V7H6ZM8 4V9C8 10.66 9.34 12 11 12C12.66 12 14 10.66 14 9V4H8ZM10 20V22H14V20H10Z" />
              </svg>
            </div>

            <h2
              className="font-display text-3xl font-bold mb-2 tracking-wide"
              style={{
                background: "linear-gradient(135deg, #f4c430 0%, #d4a012 50%, #f4c430 100%)",
                backgroundSize: "200% 200%",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                animation: "win-text-shimmer 2s ease-in-out infinite",
              }}
            >
              YOU WIN!
            </h2>

            {winInSol && (
              <div className="flex items-center justify-center gap-2 text-[var(--text-primary)]">
                <span className="text-2xl font-bold text-[var(--gold-light)]">
                  +{winInSol}
                </span>
                <span className="text-lg text-[var(--text-secondary)]">SOL</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
