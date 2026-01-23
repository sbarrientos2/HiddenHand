use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, Table, TableStatus};

#[derive(Accounts)]
pub struct StartHand<'info> {
    /// Anyone can call, but non-authority must wait for timeout
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        init,
        payer = caller,
        space = HandState::SIZE,
        seeds = [HAND_SEED, table.key().as_ref(), &(table.hand_number + 1).to_le_bytes()],
        bump
    )]
    pub hand_state: Account<'info, HandState>,

    #[account(
        init,
        payer = caller,
        space = DeckState::SIZE,
        seeds = [DECK_SEED, table.key().as_ref(), &(table.hand_number + 1).to_le_bytes()],
        bump
    )]
    pub deck_state: Account<'info, DeckState>,

    pub system_program: Program<'info, System>,
}

/// Start a new hand
/// Authority can call immediately, anyone else must wait for timeout
pub fn handler(ctx: Context<StartHand>) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let caller = &ctx.accounts.caller;
    let clock = Clock::get()?;

    // Authorization check: authority can call immediately, others must wait for timeout
    let is_authority = table.authority == caller.key();
    if !is_authority {
        let elapsed = clock.unix_timestamp - table.last_ready_time;
        require!(
            elapsed >= ACTION_TIMEOUT_SECONDS,
            HiddenHandError::UnauthorizedAuthority
        );
        msg!("Non-authority starting hand after {} seconds timeout", elapsed);
    }

    // Validate enough players
    require!(
        table.current_players >= MIN_PLAYERS,
        HiddenHandError::NotEnoughPlayers
    );

    require!(
        table.status == TableStatus::Waiting,
        HiddenHandError::HandAlreadyInProgress
    );

    // Increment hand number
    table.hand_number += 1;
    table.status = TableStatus::Playing;

    // Advance dealer button
    table.advance_dealer();

    // Calculate positions
    let dealer_pos = table.dealer_position;
    let max_players = table.max_players;
    let is_heads_up = table.current_players == 2;

    // Find small blind and big blind positions
    // In heads-up (2 players): dealer = SB, other player = BB
    // In 3+ players: SB is left of dealer, BB is left of SB
    let (sb_pos, bb_pos, action_pos) = if is_heads_up {
        // Heads-up: dealer is SB
        let sb = dealer_pos;
        let mut bb = (dealer_pos + 1) % max_players;
        while !table.is_seat_occupied(bb) {
            bb = (bb + 1) % max_players;
        }
        // In heads-up, SB (dealer) acts first preflop
        (sb, bb, sb)
    } else {
        // Standard: SB is left of dealer
        let mut sb = (dealer_pos + 1) % max_players;
        while !table.is_seat_occupied(sb) {
            sb = (sb + 1) % max_players;
        }

        let mut bb = (sb + 1) % max_players;
        while !table.is_seat_occupied(bb) {
            bb = (bb + 1) % max_players;
        }

        // First to act preflop is after big blind (UTG)
        let mut action = (bb + 1) % max_players;
        while !table.is_seat_occupied(action) {
            action = (action + 1) % max_players;
        }
        (sb, bb, action)
    };

    // Initialize hand state
    let hand_state = &mut ctx.accounts.hand_state;
    hand_state.table = table.key();
    hand_state.hand_number = table.hand_number;
    hand_state.phase = GamePhase::Dealing;
    hand_state.pot = 0;
    hand_state.current_bet = table.big_blind;
    hand_state.min_raise = table.big_blind;
    hand_state.dealer_position = dealer_pos;
    hand_state.action_on = action_pos;
    hand_state.community_cards = vec![255, 255, 255, 255, 255]; // 255 = not revealed
    hand_state.community_revealed = 0;
    hand_state.active_players = table.occupied_seats;
    hand_state.acted_this_round = 0;
    hand_state.active_count = table.current_players;
    hand_state.all_in_players = 0; // No one is all-in at start
    hand_state.last_action_time = clock.unix_timestamp;
    hand_state.hand_start_time = clock.unix_timestamp;
    hand_state.awaiting_community_reveal = false;
    hand_state.bump = ctx.bumps.hand_state;

    // Initialize deck state
    // NOTE: With Modified Option B, VRF seed is NEVER stored!
    // Shuffle + encrypt happens atomically in callback_shuffle
    let deck_state = &mut ctx.accounts.deck_state;
    deck_state.hand = hand_state.key();
    deck_state.cards = [0u128; DECK_SIZE]; // Will be shuffled in callback
    deck_state.deal_index = 0;
    deck_state.is_shuffled = false;
    deck_state.bump = ctx.bumps.deck_state;
    deck_state._reserved = [0u8; 33]; // Reserved for future use

    msg!(
        "Hand #{} started. Dealer: seat {}, SB: seat {}, BB: seat {}, Action: seat {}",
        table.hand_number,
        dealer_pos,
        sb_pos,
        bb_pos,
        action_pos
    );

    Ok(())
}
