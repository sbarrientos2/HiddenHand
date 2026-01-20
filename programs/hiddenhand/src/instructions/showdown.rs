use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::events::{HandCompleted, PlayerHandResult};
use crate::state::{evaluate_hand, find_winners, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

/// Helper to validate a seat account from remaining_accounts
/// Returns Some(seat) if valid, None if should be skipped
fn validate_seat_account(
    account_info: &AccountInfo,
    table_key: &Pubkey,
    program_id: &Pubkey,
) -> Option<PlayerSeat> {
    // Security check 1: Verify account is owned by our program
    if account_info.owner != program_id {
        return None;
    }

    // Try to borrow and deserialize
    let data = account_info.try_borrow_data().ok()?;
    if data.len() < 8 {
        return None;
    }

    // Try to deserialize as PlayerSeat
    let seat = PlayerSeat::try_deserialize(&mut &data[..]).ok()?;

    // Security check 2: Verify table matches
    if seat.table != *table_key {
        return None;
    }

    // Security check 3: Verify PDA derivation
    let (expected_pda, _) = Pubkey::find_program_address(
        &[SEAT_SEED, table_key.as_ref(), &[seat.seat_index]],
        program_id,
    );
    if *account_info.key != expected_pda {
        return None;
    }

    Some(seat)
}

#[derive(Accounts)]
pub struct Showdown<'info> {
    /// Anyone can call showdown, but non-authority must wait for timeout
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
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

    /// Vault holding player chips
    #[account(
        mut,
        seeds = [VAULT_SEED, table.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
}

pub fn handler(ctx: Context<Showdown>) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let caller = &ctx.accounts.caller;
    let clock = Clock::get()?;

    // Authorization check:
    // - Authority can call showdown immediately
    // - Anyone else can call after timeout (prevents authority from abandoning game)
    let is_authority = table.authority == caller.key();

    if !is_authority {
        let elapsed = clock.unix_timestamp - hand_state.last_action_time;
        require!(
            elapsed >= ACTION_TIMEOUT_SECONDS,
            HiddenHandError::UnauthorizedAuthority
        );
        msg!("Non-authority calling showdown after {} seconds timeout", elapsed);
    }

    // Security: Check for duplicate accounts in remaining_accounts
    // This prevents an attacker from passing the same account twice to manipulate state
    let mut seen_keys: BTreeSet<Pubkey> = BTreeSet::new();
    for account in ctx.remaining_accounts.iter() {
        if !seen_keys.insert(*account.key) {
            return Err(HiddenHandError::DuplicateAccount.into());
        }
    }

    // Validate game phase
    require!(
        hand_state.phase == GamePhase::Showdown ||
        (hand_state.phase == GamePhase::Settled && hand_state.active_count == 1),
        HiddenHandError::InvalidPhase
    );

    // Get community cards
    let community_cards: Vec<u8> = hand_state.community_cards
        .iter()
        .filter(|&&c| c != 255)
        .copied()
        .collect();

    require!(
        community_cards.len() == 5 || hand_state.active_count == 1,
        HiddenHandError::InvalidPhase
    );

    // Collect player seats from remaining accounts
    // Store seat index and account index for later updates
    let mut active_seats: Vec<(u8, usize)> = Vec::new();
    let program_id = crate::ID;

    // === EARLY: Collect ALL player data for event emission BEFORE any modifications ===
    // This must happen first because modifying accounts can cause borrow issues
    let mut event_results: [PlayerHandResult; 6] = Default::default();
    let mut results_count: u8 = 0;

    for (idx, account_info) in ctx.remaining_accounts.iter().enumerate() {
        if results_count >= 6 {
            break;
        }
        if let Some(seat) = validate_seat_account(account_info, &table.key(), &program_id) {
            // Track active seats for later processing
            if seat.status == PlayerStatus::Playing || seat.status == PlayerStatus::AllIn {
                active_seats.push((seat.seat_index, idx));
            }

            // Collect event data for ALL seats (including folded)
            let hole_1 = if seat.cards_revealed {
                seat.revealed_card_1
            } else if seat.status == PlayerStatus::Folded {
                255 // Don't show folded player's cards
            } else {
                (seat.hole_card_1 & 0xFF) as u8
            };
            let hole_2 = if seat.cards_revealed {
                seat.revealed_card_2
            } else if seat.status == PlayerStatus::Folded {
                255
            } else {
                (seat.hole_card_2 & 0xFF) as u8
            };

            // Calculate hand rank if cards are shown and we have community cards
            let hand_rank = if hole_1 != 255 && hole_2 != 255 && community_cards.len() == 5 {
                let eval = evaluate_hand(&[
                    hole_1, hole_2,
                    community_cards[0], community_cards[1], community_cards[2],
                    community_cards[3], community_cards[4],
                ]);
                eval.rank as u8
            } else {
                255 // Not evaluated
            };

            let chips_bet = seat.total_bet_this_hand;

            event_results[results_count as usize] = PlayerHandResult {
                player: seat.player,
                seat_index: seat.seat_index,
                hole_card_1: hole_1,
                hole_card_2: hole_2,
                hand_rank,
                chips_won: 0,
                chips_bet,
                folded: seat.status == PlayerStatus::Folded,
                all_in: seat.status == PlayerStatus::AllIn,
            };
            results_count += 1;
        }
    }

    let mut pot = hand_state.pot;

    // Collect total bets from all active players to calculate side pots
    let mut player_bets: Vec<(u8, usize, u64)> = Vec::new(); // (seat_idx, acc_idx, total_bet)

    for (seat_idx, acc_idx) in active_seats.iter() {
        if hand_state.is_player_active(*seat_idx) {
            let account_info = &ctx.remaining_accounts[*acc_idx];
            let data = account_info.try_borrow_data()?;
            if let Ok(seat) = PlayerSeat::try_deserialize(&mut &data[..]) {
                player_bets.push((*seat_idx, *acc_idx, seat.total_bet_this_hand));
            }
        }
    }

    // Calculate effective pot and return excess to over-bettors
    // The effective pot each player can win is limited by what others can match
    if player_bets.len() >= 2 {
        // Find minimum bet among active players
        let min_bet = player_bets.iter().map(|(_, _, bet)| *bet).min().unwrap_or(0);

        // Return excess to players who bet more than the minimum
        for (seat_idx, acc_idx, total_bet) in player_bets.iter() {
            if *total_bet > min_bet {
                let excess = total_bet - min_bet;
                let account_info = &ctx.remaining_accounts[*acc_idx];
                let mut data = account_info.try_borrow_mut_data()?;
                if let Ok(mut seat) = PlayerSeat::try_deserialize(&mut &data[..]) {
                    seat.award_chips(excess);
                    seat.try_serialize(&mut *data)?;
                    pot = pot.saturating_sub(excess);
                    msg!("Returning {} excess chips to seat {} (uncallable bet)", excess, seat_idx);
                }
            }
        }
    }

    // Check that all active players have revealed their cards (required for secure showdown)
    // Skip this check if only one player remains (they win by default)
    if hand_state.active_count > 1 {
        for (seat_idx, acc_idx) in active_seats.iter() {
            if hand_state.is_player_active(*seat_idx) {
                let account_info = &ctx.remaining_accounts[*acc_idx];
                let data = account_info.try_borrow_data()?;
                if let Ok(seat) = PlayerSeat::try_deserialize(&mut &data[..]) {
                    if !seat.cards_revealed {
                        msg!("Seat {} has not revealed cards yet", seat_idx);
                        return Err(HiddenHandError::PlayersNotRevealed.into());
                    }
                }
            }
        }
    }

    // Handle single winner (everyone else folded)
    if hand_state.active_count == 1 {
        // Find the single remaining player
        for (seat_idx, acc_idx) in active_seats.iter() {
            if hand_state.is_player_active(*seat_idx) {
                // Award entire pot to winner
                let account_info = &ctx.remaining_accounts[*acc_idx];
                let mut data = account_info.try_borrow_mut_data()?;
                if let Ok(mut seat) = PlayerSeat::try_deserialize(&mut &data[..]) {
                    seat.award_chips(pot);
                    seat.try_serialize(&mut *data)?;
                    msg!("Player at seat {} wins {} (all others folded)", seat_idx, pot);
                }
                break;
            }
        }
    } else {
        // Showdown - evaluate hands and find winners
        let mut player_hands: Vec<(u8, [u8; 7])> = Vec::new();

        for (seat_idx, acc_idx) in active_seats.iter() {
            if hand_state.is_player_active(*seat_idx) {
                let account_info = &ctx.remaining_accounts[*acc_idx];
                let data = account_info.try_borrow_data()?;
                if let Ok(seat) = PlayerSeat::try_deserialize(&mut &data[..]) {
                    // Build 7-card hand (2 hole cards + 5 community)
                    // Use revealed_card_1/2 from secure Ed25519-verified reveal
                    // Falls back to hole_card lower bits for non-encrypted games
                    let hole_card_1 = if seat.cards_revealed {
                        seat.revealed_card_1
                    } else {
                        (seat.hole_card_1 & 0xFF) as u8
                    };
                    let hole_card_2 = if seat.cards_revealed {
                        seat.revealed_card_2
                    } else {
                        (seat.hole_card_2 & 0xFF) as u8
                    };

                    let seven_cards: [u8; 7] = [
                        hole_card_1,
                        hole_card_2,
                        community_cards.get(0).copied().unwrap_or(0),
                        community_cards.get(1).copied().unwrap_or(0),
                        community_cards.get(2).copied().unwrap_or(0),
                        community_cards.get(3).copied().unwrap_or(0),
                        community_cards.get(4).copied().unwrap_or(0),
                    ];

                    player_hands.push((*seat_idx, seven_cards));
                }
            }
        }

        // Find winners
        let winners = find_winners(&player_hands);
        let winner_count = winners.len() as u64;

        require!(winner_count > 0, HiddenHandError::InvalidPhase);

        // Calculate split (handle remainder)
        let share = pot / winner_count;
        let remainder = pot % winner_count;

        msg!("Showdown - {} winner(s), pot: {}, share: {}", winner_count, pot, share);

        // Distribute winnings
        for (i, winner_seat_idx) in winners.iter().enumerate() {
            // Find the winner's account
            for (seat_idx, acc_idx) in active_seats.iter() {
                if seat_idx == winner_seat_idx {
                    let account_info = &ctx.remaining_accounts[*acc_idx];
                    let mut data = account_info.try_borrow_mut_data()?;
                    if let Ok(mut seat) = PlayerSeat::try_deserialize(&mut &data[..]) {
                        // First winner gets any remainder
                        let winnings = if i == 0 { share + remainder } else { share };
                        seat.award_chips(winnings);
                        seat.try_serialize(&mut *data)?;

                        // Log the hand
                        let hole_1 = if seat.cards_revealed {
                            seat.revealed_card_1
                        } else {
                            (seat.hole_card_1 & 0xFF) as u8
                        };
                        let hole_2 = if seat.cards_revealed {
                            seat.revealed_card_2
                        } else {
                            (seat.hole_card_2 & 0xFF) as u8
                        };
                        let hand_eval = evaluate_hand(&[
                            hole_1, hole_2,
                            community_cards[0], community_cards[1], community_cards[2],
                            community_cards[3], community_cards[4],
                        ]);

                        msg!(
                            "Seat {} wins {} with {:?}",
                            seat_idx,
                            winnings,
                            hand_eval.rank
                        );
                    }
                    break;
                }
            }
        }
    }

    // Emit the hand completed event for audit trail (using pre-collected data)
    emit!(HandCompleted {
        table_id: table.table_id,
        hand_number: hand_state.hand_number,
        timestamp: clock.unix_timestamp,
        community_cards: [
            community_cards.get(0).copied().unwrap_or(255),
            community_cards.get(1).copied().unwrap_or(255),
            community_cards.get(2).copied().unwrap_or(255),
            community_cards.get(3).copied().unwrap_or(255),
            community_cards.get(4).copied().unwrap_or(255),
        ],
        total_pot: pot,
        player_count: results_count,
        results: event_results,
        results_count,
    });

    msg!("HandCompleted event emitted for hand #{}", hand_state.hand_number);

    // Reset all player states for next hand (including folded players)
    for account_info in ctx.remaining_accounts.iter() {
        // Validate seat account (owner check + PDA verification)
        if let Some(_seat) = validate_seat_account(account_info, &table.key(), &program_id) {
            // Reset the seat state
            let mut data = account_info.try_borrow_mut_data()?;
            if let Ok(mut seat) = PlayerSeat::try_deserialize(&mut &data[..]) {
                seat.status = PlayerStatus::Sitting;
                seat.current_bet = 0;
                seat.total_bet_this_hand = 0;
                seat.hole_card_1 = 255; // Sentinel: not dealt
                seat.hole_card_2 = 255; // Sentinel: not dealt
                seat.revealed_card_1 = 255; // Not revealed
                seat.revealed_card_2 = 255; // Not revealed
                seat.cards_revealed = false;
                seat.has_acted = false;
                seat.try_serialize(&mut *data)?;
            }
        }
    }

    // Mark hand as settled
    hand_state.phase = GamePhase::Settled;
    hand_state.pot = 0;

    // Return table to waiting state and record time (for timeout fallback)
    table.status = TableStatus::Waiting;
    table.last_ready_time = clock.unix_timestamp;

    msg!("Hand #{} complete", hand_state.hand_number);

    Ok(())
}
