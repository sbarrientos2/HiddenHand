'use client';

import { useSounds } from '../lib/sounds';

export function SoundToggle() {
  const { soundsEnabled, toggleSounds, initSounds } = useSounds();

  const handleClick = async () => {
    // Initialize sounds on first interaction (browser requirement)
    await initSounds();
    toggleSounds();
  };

  return (
    <button
      onClick={handleClick}
      className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
      title={soundsEnabled ? 'Mute sounds' : 'Enable sounds'}
    >
      {soundsEnabled ? (
        // Sound on icon
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-green-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      ) : (
        // Sound off icon
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      )}
    </button>
  );
}
