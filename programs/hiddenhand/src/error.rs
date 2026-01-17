use anchor_lang::prelude::*;

#[error_code]
pub enum HiddenHandError {
    #[msg("Table is full")]
    TableFull,

    #[msg("Table is not full enough to start")]
    NotEnoughPlayers,

    #[msg("Player is not at this table")]
    PlayerNotAtTable,

    #[msg("Player is already at this table")]
    PlayerAlreadyAtTable,

    #[msg("Invalid seat index")]
    InvalidSeatIndex,

    #[msg("Seat is already occupied")]
    SeatOccupied,

    #[msg("Seat is empty")]
    SeatEmpty,

    #[msg("Not player's turn")]
    NotPlayersTurn,

    #[msg("Invalid action for current game state")]
    InvalidAction,

    #[msg("Insufficient chips")]
    InsufficientChips,

    #[msg("Buy-in amount out of range")]
    InvalidBuyIn,

    #[msg("Hand is not in progress")]
    HandNotInProgress,

    #[msg("Hand is already in progress")]
    HandAlreadyInProgress,

    #[msg("Cannot fold - no bet to fold from")]
    CannotFold,

    #[msg("Cannot check - must call or raise")]
    CannotCheck,

    #[msg("Raise amount too small")]
    RaiseTooSmall,

    #[msg("Betting round not complete")]
    BettingRoundNotComplete,

    #[msg("Invalid phase for this action")]
    InvalidPhase,

    #[msg("Player action timeout")]
    ActionTimeout,

    #[msg("Player has not timed out yet - must wait 60 seconds")]
    ActionNotTimedOut,

    #[msg("Only table authority can perform this action")]
    UnauthorizedAuthority,

    #[msg("Showdown requires at least 2 active players")]
    ShowdownRequiresPlayers,

    #[msg("Invalid card index")]
    InvalidCardIndex,

    #[msg("Deck already shuffled for this hand")]
    DeckAlreadyShuffled,

    #[msg("Deck not yet shuffled - request VRF shuffle first")]
    DeckNotShuffled,

    #[msg("Cards not yet dealt")]
    CardsNotDealt,

    #[msg("All community cards already revealed")]
    AllCardsRevealed,

    #[msg("Player has already folded")]
    PlayerFolded,

    #[msg("Player is already all-in")]
    PlayerAlreadyAllIn,

    #[msg("Table is not in waiting state")]
    TableNotWaiting,

    #[msg("Cannot leave during active hand")]
    CannotLeaveDuringHand,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Duplicate accounts provided")]
    DuplicateAccount,

    #[msg("Invalid remaining accounts")]
    InvalidRemainingAccounts,

    #[msg("Invalid account count - expected multiple of 3 for encryption")]
    InvalidAccountCount,

    #[msg("Cards have already been revealed")]
    CardsAlreadyRevealed,

    #[msg("Player is not active (folded or not playing)")]
    PlayerNotActive,

    #[msg("Invalid card value - must be 0-51")]
    InvalidCard,

    #[msg("Ed25519 signature verification failed")]
    Ed25519VerificationFailed,

    #[msg("All active players must reveal before showdown can complete")]
    PlayersNotRevealed,
}
