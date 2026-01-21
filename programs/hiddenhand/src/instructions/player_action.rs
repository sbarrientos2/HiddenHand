use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, Table, TableStatus};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    Fold,
    Check,
    Call,
    Raise { amount: u64 },
    AllIn,
}

#[derive(Accounts)]
pub struct PlayerAction<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

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
        mut,
        seeds = [DECK_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = deck_state.bump
    )]
    pub deck_state: Account<'info, DeckState>,

    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[player_seat.seat_index]],
        bump = player_seat.bump,
        has_one = player @ HiddenHandError::PlayerNotAtTable
    )]
    pub player_seat: Account<'info, PlayerSeat>,
}

pub fn handler(ctx: Context<PlayerAction>, action: Action) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let deck_state = &ctx.accounts.deck_state;
    let player_seat = &mut ctx.accounts.player_seat;
    let clock = Clock::get()?;

    // Validate game state
    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    require!(
        matches!(
            hand_state.phase,
            GamePhase::PreFlop | GamePhase::Flop | GamePhase::Turn | GamePhase::River
        ),
        HiddenHandError::InvalidPhase
    );

    // Cannot act while waiting for community cards to be revealed
    require!(
        !hand_state.awaiting_community_reveal,
        HiddenHandError::AwaitingCommunityReveal
    );

    require!(
        hand_state.action_on == player_seat.seat_index,
        HiddenHandError::NotPlayersTurn
    );

    require!(
        player_seat.can_act(),
        HiddenHandError::PlayerFolded
    );

    // Calculate amount to call
    let to_call = hand_state
        .current_bet
        .saturating_sub(player_seat.current_bet);

    match action {
        Action::Fold => {
            player_seat.fold();
            hand_state.fold_player(player_seat.seat_index);

            msg!("Player at seat {} folds", player_seat.seat_index);

            // Check if only one player remains
            if hand_state.active_count == 1 {
                // Hand ends, winner takes pot
                hand_state.phase = GamePhase::Settled;
                msg!("Hand ends - only one player remaining");
            }
        }

        Action::Check => {
            require!(to_call == 0, HiddenHandError::CannotCheck);
            msg!("Player at seat {} checks", player_seat.seat_index);
        }

        Action::Call => {
            require!(to_call > 0, HiddenHandError::InvalidAction);

            let actual_bet = player_seat.place_bet(to_call);
            hand_state.pot = hand_state.pot.saturating_add(actual_bet);

            msg!(
                "Player at seat {} calls {} (pot: {})",
                player_seat.seat_index,
                actual_bet,
                hand_state.pot
            );
        }

        Action::Raise { amount } => {
            // Raise must be at least min_raise above current bet
            let total_bet = player_seat.current_bet.saturating_add(amount);
            let raise_amount = total_bet.saturating_sub(hand_state.current_bet);

            require!(
                raise_amount >= hand_state.min_raise,
                HiddenHandError::RaiseTooSmall
            );

            let actual_bet = player_seat.place_bet(amount);
            hand_state.pot = hand_state.pot.saturating_add(actual_bet);

            // Update current bet and min raise
            let new_bet = player_seat.current_bet;
            if new_bet > hand_state.current_bet {
                hand_state.min_raise = new_bet.saturating_sub(hand_state.current_bet);
                hand_state.current_bet = new_bet;
                // Reset acted flags since there's a new bet to respond to
                hand_state.acted_this_round = 0;
            }

            msg!(
                "Player at seat {} raises to {} (pot: {})",
                player_seat.seat_index,
                new_bet,
                hand_state.pot
            );
        }

        Action::AllIn => {
            let all_in_amount = player_seat.chips;
            let actual_bet = player_seat.place_bet(all_in_amount);
            hand_state.pot = hand_state.pot.saturating_add(actual_bet);

            let new_bet = player_seat.current_bet;
            if new_bet > hand_state.current_bet {
                hand_state.min_raise = new_bet.saturating_sub(hand_state.current_bet);
                hand_state.current_bet = new_bet;
                hand_state.acted_this_round = 0;
            }

            // Mark player as all-in in hand state
            hand_state.mark_all_in(player_seat.seat_index);

            msg!(
                "Player at seat {} goes all-in for {} (pot: {})",
                player_seat.seat_index,
                actual_bet,
                hand_state.pot
            );
        }
    }

    // Check if player went all-in from Call/Raise (chips depleted)
    if player_seat.chips == 0 && !hand_state.is_player_all_in(player_seat.seat_index) {
        hand_state.mark_all_in(player_seat.seat_index);
    }

    // Mark player as acted and update timeout timestamp
    hand_state.mark_acted(player_seat.seat_index);
    player_seat.has_acted = true;
    hand_state.last_action_time = clock.unix_timestamp;

    // Find next player who needs to act in this betting round
    // (active, not all-in, hasn't acted yet or needs to respond to a raise)
    if let Some(next_player) = find_next_player_who_can_act(hand_state, player_seat.seat_index, table.max_players) {
        // Another player still needs to act - give them the action
        hand_state.action_on = next_player;
        msg!("Action moves to seat {}", next_player);
    } else {
        // No one else needs to act in this betting round
        // Check if there's any more betting possible in the hand
        if hand_state.can_anyone_bet() {
            // At least 2 players can still bet - advance to next phase
            advance_to_next_phase(hand_state, deck_state, table.max_players)?;
        } else {
            // No more betting possible (all remaining players are all-in,
            // or only 1 player has chips and they've completed their action)
            // Run out remaining community cards and go to showdown
            msg!("No more betting possible - running out to showdown");
            run_out_to_showdown(hand_state, deck_state)?;
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn advance_to_next_phase(hand_state: &mut HandState, _deck_state: &DeckState, _max_players: u8) -> Result<()> {
    // Community cards are now ENCRYPTED in deck_state
    // We can't reveal them directly - authority must call reveal_community
    // Set the flag to signal that we're waiting for community card reveal

    match hand_state.phase {
        GamePhase::PreFlop | GamePhase::Flop | GamePhase::Turn => {
            // Signal that we need community cards revealed before advancing
            hand_state.awaiting_community_reveal = true;
            msg!("Betting round complete - awaiting community card reveal from authority");
            msg!("Authority must call reveal_community instruction");
        }
        GamePhase::River => {
            // No community cards to reveal - go directly to showdown
            hand_state.phase = GamePhase::Showdown;
            msg!("Advancing to Showdown");
        }
        _ => {}
    }

    Ok(())
}

/// Find next player who needs to act (not folded, not all-in, hasn't acted this round)
fn find_next_player_who_can_act(hand_state: &HandState, after_seat: u8, max_players: u8) -> Option<u8> {
    let mut next = (after_seat + 1) % max_players;
    for _ in 0..max_players {
        if hand_state.is_player_active(next)
            && !hand_state.is_player_all_in(next)
            && !hand_state.has_player_acted(next) {
            return Some(next);
        }
        next = (next + 1) % max_players;
    }
    None
}

/// Signal that we need to run out all remaining community cards to showdown
/// This happens when all remaining players are all-in (no more betting possible)
fn run_out_to_showdown(hand_state: &mut HandState, _deck_state: &DeckState) -> Result<()> {
    // Community cards are ENCRYPTED - authority must reveal them
    // Set the awaiting flag. The reveal_community instruction will detect
    // that all players are all-in and reveal all remaining cards at once.

    if hand_state.phase == GamePhase::River {
        // All community cards already revealed, go to showdown
        hand_state.phase = GamePhase::Showdown;
        msg!("Advancing to Showdown - all players all-in");
    } else {
        // Need to reveal remaining community cards
        hand_state.awaiting_community_reveal = true;
        msg!("All players all-in - awaiting community card reveal to run out to showdown");
        msg!("Authority must call reveal_community instruction to reveal remaining cards");
    }

    Ok(())
}
