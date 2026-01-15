use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

/// Timeout a player who hasn't acted within the time limit
/// Anyone can call this - not just the authority
/// This prevents games from getting stuck when a player goes AFK
#[derive(Accounts)]
pub struct TimeoutPlayer<'info> {
    /// Anyone can trigger a timeout (doesn't need to be authority or the timed-out player)
    pub caller: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        mut,
        seeds = [HAND_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = hand_state.bump
    )]
    pub hand_state: Account<'info, HandState>,

    #[account(
        seeds = [DECK_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = deck_state.bump
    )]
    pub deck_state: Account<'info, DeckState>,

    /// The seat of the player being timed out
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[player_seat.seat_index]],
        bump = player_seat.bump
    )]
    pub player_seat: Account<'info, PlayerSeat>,
}

/// Timeout a player who hasn't acted in time
/// Auto-checks if no bet to call, otherwise auto-folds
pub fn handler(ctx: Context<TimeoutPlayer>) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let deck_state = &ctx.accounts.deck_state;
    let player_seat = &mut ctx.accounts.player_seat;
    let clock = Clock::get()?;

    // Validate game is in progress
    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // Validate we're in a betting phase
    require!(
        matches!(
            hand_state.phase,
            GamePhase::PreFlop | GamePhase::Flop | GamePhase::Turn | GamePhase::River
        ),
        HiddenHandError::InvalidPhase
    );

    // Validate it's this player's turn
    require!(
        hand_state.action_on == player_seat.seat_index,
        HiddenHandError::NotPlayersTurn
    );

    // Validate player is active and can act
    require!(
        hand_state.is_player_active(player_seat.seat_index),
        HiddenHandError::PlayerFolded
    );

    require!(
        player_seat.status == PlayerStatus::Playing,
        HiddenHandError::InvalidAction
    );

    // Check timeout has elapsed (60 seconds)
    let current_time = clock.unix_timestamp;
    let elapsed = current_time - hand_state.last_action_time;

    require!(
        elapsed >= ACTION_TIMEOUT_SECONDS,
        HiddenHandError::ActionNotTimedOut
    );

    msg!(
        "Player at seat {} timed out after {} seconds",
        player_seat.seat_index,
        elapsed
    );

    // Determine action: Check if possible, otherwise Fold
    let can_check = player_seat.current_bet >= hand_state.current_bet;

    if can_check {
        // Auto-CHECK - player doesn't lose anything
        msg!("Auto-CHECK for timed out player");

        // Mark as acted
        hand_state.mark_acted(player_seat.seat_index);
        player_seat.has_acted = true;
    } else {
        // Auto-FOLD - player forfeits hand but keeps remaining chips
        msg!(
            "Auto-FOLD for timed out player (had {} chips, bet was {})",
            player_seat.chips,
            hand_state.current_bet
        );

        // Fold the player
        hand_state.fold_player(player_seat.seat_index);
        player_seat.status = PlayerStatus::Folded;
    }

    // Update timestamp for next action
    hand_state.last_action_time = current_time;

    // Check if only one player remains (winner by default)
    if hand_state.active_count == 1 {
        hand_state.phase = GamePhase::Showdown;
        msg!("Only one player remains - advancing to showdown");
        return Ok(());
    }

    // Find next active player
    let next_player = hand_state.next_active_player(player_seat.seat_index, table.max_players);

    if let Some(next) = next_player {
        // Skip all-in players
        let mut action_seat = next;
        for _ in 0..table.max_players {
            if !hand_state.is_player_all_in(action_seat) {
                break;
            }
            if let Some(n) = hand_state.next_active_player(action_seat, table.max_players) {
                action_seat = n;
            } else {
                break;
            }
        }
        hand_state.action_on = action_seat;
    }

    // Check if betting round is complete
    if hand_state.is_betting_complete() || !hand_state.can_anyone_bet() {
        msg!("Betting round complete, advancing phase");

        // Check if any more betting is possible
        if hand_state.can_anyone_bet() {
            // Normal phase advancement with card reveal
            advance_phase_with_cards(hand_state, deck_state, table.max_players);
        } else {
            // All remaining players are all-in - run out to showdown
            run_out_to_showdown(hand_state, deck_state);
        }
    }

    msg!(
        "Timeout processed. Action now on seat {}. Phase: {:?}",
        hand_state.action_on,
        hand_state.phase
    );

    Ok(())
}

/// Advance to next phase and reveal community cards
fn advance_phase_with_cards(hand_state: &mut HandState, deck_state: &DeckState, max_players: u8) {
    // Find first active player left of dealer for post-flop action
    let first_to_act = get_first_active_left_of_dealer(hand_state, max_players);

    match hand_state.phase {
        GamePhase::PreFlop => {
            hand_state.phase = GamePhase::Flop;
            hand_state.reset_betting_round();
            // Reveal flop (3 cards)
            hand_state.community_cards[0] = (deck_state.cards[0] & 0xFF) as u8;
            hand_state.community_cards[1] = (deck_state.cards[1] & 0xFF) as u8;
            hand_state.community_cards[2] = (deck_state.cards[2] & 0xFF) as u8;
            hand_state.community_revealed = 3;
            hand_state.action_on = first_to_act;
            msg!("Advancing to Flop - cards: {}, {}, {}",
                hand_state.community_cards[0],
                hand_state.community_cards[1],
                hand_state.community_cards[2]);
        }
        GamePhase::Flop => {
            hand_state.phase = GamePhase::Turn;
            hand_state.reset_betting_round();
            // Reveal turn (4th card)
            hand_state.community_cards[3] = (deck_state.cards[3] & 0xFF) as u8;
            hand_state.community_revealed = 4;
            hand_state.action_on = first_to_act;
            msg!("Advancing to Turn - card: {}", hand_state.community_cards[3]);
        }
        GamePhase::Turn => {
            hand_state.phase = GamePhase::River;
            hand_state.reset_betting_round();
            // Reveal river (5th card)
            hand_state.community_cards[4] = (deck_state.cards[4] & 0xFF) as u8;
            hand_state.community_revealed = 5;
            hand_state.action_on = first_to_act;
            msg!("Advancing to River - card: {}", hand_state.community_cards[4]);
        }
        GamePhase::River => {
            hand_state.phase = GamePhase::Showdown;
            msg!("Advancing to Showdown");
        }
        _ => {}
    }
}

/// Find first active player to the left of dealer (for post-flop betting order)
fn get_first_active_left_of_dealer(hand_state: &HandState, max_players: u8) -> u8 {
    let dealer = hand_state.dealer_position;
    let mut pos = (dealer + 1) % max_players;

    for _ in 0..max_players {
        if hand_state.is_player_active(pos) && !hand_state.is_player_all_in(pos) {
            return pos;
        }
        pos = (pos + 1) % max_players;
    }

    // Fallback: return first active player even if all-in
    pos = (dealer + 1) % max_players;
    for _ in 0..max_players {
        if hand_state.is_player_active(pos) {
            return pos;
        }
        pos = (pos + 1) % max_players;
    }

    // Fallback (shouldn't happen with 2+ active players)
    dealer
}

/// Run out all remaining community cards and advance to showdown
fn run_out_to_showdown(hand_state: &mut HandState, deck_state: &DeckState) {
    // Reveal all remaining community cards
    match hand_state.phase {
        GamePhase::PreFlop => {
            // Reveal flop + turn + river
            hand_state.community_cards[0] = (deck_state.cards[0] & 0xFF) as u8;
            hand_state.community_cards[1] = (deck_state.cards[1] & 0xFF) as u8;
            hand_state.community_cards[2] = (deck_state.cards[2] & 0xFF) as u8;
            hand_state.community_cards[3] = (deck_state.cards[3] & 0xFF) as u8;
            hand_state.community_cards[4] = (deck_state.cards[4] & 0xFF) as u8;
            hand_state.community_revealed = 5;
            msg!("Running out: Flop {}, {}, {} | Turn {} | River {}",
                hand_state.community_cards[0],
                hand_state.community_cards[1],
                hand_state.community_cards[2],
                hand_state.community_cards[3],
                hand_state.community_cards[4]);
        }
        GamePhase::Flop => {
            // Reveal turn + river
            hand_state.community_cards[3] = (deck_state.cards[3] & 0xFF) as u8;
            hand_state.community_cards[4] = (deck_state.cards[4] & 0xFF) as u8;
            hand_state.community_revealed = 5;
            msg!("Running out: Turn {} | River {}",
                hand_state.community_cards[3],
                hand_state.community_cards[4]);
        }
        GamePhase::Turn => {
            // Reveal river
            hand_state.community_cards[4] = (deck_state.cards[4] & 0xFF) as u8;
            hand_state.community_revealed = 5;
            msg!("Running out: River {}", hand_state.community_cards[4]);
        }
        GamePhase::River => {
            // Already all revealed
        }
        _ => {}
    }

    hand_state.phase = GamePhase::Showdown;
    msg!("Advancing to Showdown - all players all-in or one active");
}
