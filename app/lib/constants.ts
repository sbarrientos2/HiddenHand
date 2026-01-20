/**
 * Game Constants - Must match Rust program constants in programs/hiddenhand/src/constants.rs
 *
 * IMPORTANT: If you change these values, update the Rust constants too!
 */

// Timeouts (in seconds)
export const ACTION_TIMEOUT_SECONDS = 60; // Time for player to act during their turn
export const DEAL_TIMEOUT_SECONDS = 30; // Time for authority to deal cards
export const ALLOWANCE_TIMEOUT_SECONDS = 60; // Time for authority to grant decryption allowances
export const REVEAL_TIMEOUT_SECONDS = 180; // Time to reveal cards at showdown (3 minutes)
export const TABLE_INACTIVE_TIMEOUT_SECONDS = 3600; // Inactive table auto-close (1 hour)
export const EMERGENCY_TIMEOUT_SECONDS = 86400; // Emergency withdraw (24 hours)

// Game limits
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const DECK_SIZE = 52;
export const HOLE_CARDS = 2;
export const COMMUNITY_CARDS = 5;

// Betting
export const MIN_RAISE_MULTIPLIER = 2;

// Polling intervals (milliseconds)
export const STATE_POLL_INTERVAL_MS = 3000; // How often to refresh game state
export const TIMER_UPDATE_INTERVAL_MS = 1000; // How often to update countdown timers

// Time formatting thresholds (seconds)
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86400;
