use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::inco_cpi::{self, INCO_PROGRAM_ID};
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

/// Deal cards after VRF seed has been received
/// This instruction SHUFFLES the deck using the VRF seed and distributes hole cards
/// IMPORTANT: The shuffle happens HERE (on ER after delegation), NOT in callback_shuffle
/// This ensures the card order is never visible on the base layer
#[derive(Accounts)]
pub struct DealCardsVrf<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump,
        constraint = table.authority == authority.key() @ HiddenHandError::UnauthorizedAuthority
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

    /// Small blind player seat
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[sb_seat.seat_index]],
        bump = sb_seat.bump
    )]
    pub sb_seat: Account<'info, PlayerSeat>,

    /// Big blind player seat
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[bb_seat.seat_index]],
        bump = bb_seat.bump
    )]
    pub bb_seat: Account<'info, PlayerSeat>,

    /// The Inco Lightning program for encryption
    /// CHECK: Verified by address constraint
    #[account(address = INCO_PROGRAM_ID)]
    pub inco_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Deal hole cards to all players and post blinds (after VRF shuffle)
/// remaining_accounts should contain all OTHER player seats (not SB/BB)
pub fn handler(ctx: Context<DealCardsVrf>) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let deck_state = &mut ctx.accounts.deck_state;
    let sb_seat = &mut ctx.accounts.sb_seat;
    let bb_seat = &mut ctx.accounts.bb_seat;
    let clock = Clock::get()?;

    // Security: Check SB and BB are different accounts
    require!(
        sb_seat.key() != bb_seat.key(),
        HiddenHandError::DuplicateAccount
    );

    // Security: Check for duplicate accounts in remaining_accounts
    let mut seen_keys: BTreeSet<Pubkey> = BTreeSet::new();
    seen_keys.insert(sb_seat.key());
    seen_keys.insert(bb_seat.key());
    for account in ctx.remaining_accounts.iter() {
        if !seen_keys.insert(*account.key) {
            return Err(HiddenHandError::DuplicateAccount.into());
        }
    }

    // Validate phase
    require!(
        hand_state.phase == GamePhase::Dealing,
        HiddenHandError::InvalidPhase
    );

    // REQUIRE VRF seed has been received (but NOT shuffled yet)
    require!(
        deck_state.seed_received,
        HiddenHandError::DeckNotShuffled
    );

    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // ============================================================
    // SHUFFLE THE DECK HERE (on ER, not on base layer!)
    // This ensures the card order is NEVER visible on the base layer
    // ============================================================
    let randomness = deck_state.vrf_seed;
    msg!("Shuffling deck using VRF seed (first 8 bytes): {:?}", &randomness[0..8]);

    // Initialize deck with cards 0-51
    let mut deck: [u8; 52] = core::array::from_fn(|i| i as u8);

    // Convert randomness to u64 seed for Fisher-Yates shuffle
    let mut seed = u64::from_le_bytes(randomness[0..8].try_into().unwrap());

    // Fisher-Yates shuffle using VRF randomness
    for i in (1..52).rev() {
        // Use different parts of randomness for each iteration
        if i % 4 == 0 && i < 28 {
            // Mix in more randomness periodically
            let offset = (i / 4) * 8;
            if offset + 8 <= 32 {
                seed ^= u64::from_le_bytes(randomness[offset..offset + 8].try_into().unwrap());
            }
        }

        // LCG step with VRF-seeded state
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let j = (seed % (i as u64 + 1)) as usize;
        deck.swap(i, j);
    }

    // Store shuffled deck
    for i in 0..52 {
        deck_state.cards[i] = deck[i] as u128;
    }
    deck_state.is_shuffled = true;

    // Reserve first 5 cards for community cards (indices 0-4)
    deck_state.deal_index = 5;

    msg!("Deck shuffled with VRF randomness. Now encrypting cards via Inco FHE...");

    // Get caller info for Inco CPI
    let caller_info = ctx.accounts.authority.to_account_info();

    // Convert to Vec for dealing
    let deck: Vec<u8> = deck_state.cards.iter().map(|c| *c as u8).collect();

    // Track seat indices and active player count
    let sb_index = sb_seat.seat_index;
    let bb_index = bb_seat.seat_index;
    let mut active_players = hand_state.active_players;
    let mut active_count = 0u8;
    let mut deal_idx = deck_state.deal_index as usize;

    // Deal to SB if they have chips
    if sb_seat.chips > 0 {
        // Reset bet tracking for new hand before posting blind
        sb_seat.current_bet = 0;
        sb_seat.total_bet_this_hand = 0;
        sb_seat.has_acted = false;
        sb_seat.cards_revealed = false;
        sb_seat.revealed_card_1 = 255;
        sb_seat.revealed_card_2 = 255;

        let sb_amount = sb_seat.place_bet(table.small_blind);
        hand_state.pot = hand_state.pot.saturating_add(sb_amount);
        sb_seat.status = PlayerStatus::Playing;

        // ATOMIC ENCRYPTION: Encrypt cards via Inco FHE
        msg!("Encrypting cards for SB (seat {})...", sb_index);
        let encrypted1 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx])?;
        let encrypted2 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx + 1])?;
        sb_seat.hole_card_1 = encrypted1.unwrap();
        sb_seat.hole_card_2 = encrypted2.unwrap();

        // Store encrypted in deck for consistency
        deck_state.cards[deal_idx] = encrypted1.unwrap();
        deck_state.cards[deal_idx + 1] = encrypted2.unwrap();

        deal_idx += 2;
        active_count += 1;
        msg!("SB (seat {}) posts {} and receives encrypted cards", sb_index, sb_amount);
    } else {
        // Remove from active players - no chips
        active_players &= !(1 << sb_index);
        sb_seat.status = PlayerStatus::Sitting;
        msg!("SB (seat {}) has no chips - sitting out", sb_index);
    }

    // Deal to BB if they have chips
    if bb_seat.chips > 0 {
        // Reset bet tracking for new hand before posting blind
        bb_seat.current_bet = 0;
        bb_seat.total_bet_this_hand = 0;
        bb_seat.has_acted = false;
        bb_seat.cards_revealed = false;
        bb_seat.revealed_card_1 = 255;
        bb_seat.revealed_card_2 = 255;

        let bb_amount = bb_seat.place_bet(table.big_blind);
        hand_state.pot = hand_state.pot.saturating_add(bb_amount);
        bb_seat.status = PlayerStatus::Playing;

        // ATOMIC ENCRYPTION: Encrypt cards via Inco FHE
        msg!("Encrypting cards for BB (seat {})...", bb_index);
        let encrypted1 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx])?;
        let encrypted2 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx + 1])?;
        bb_seat.hole_card_1 = encrypted1.unwrap();
        bb_seat.hole_card_2 = encrypted2.unwrap();

        // Store encrypted in deck for consistency
        deck_state.cards[deal_idx] = encrypted1.unwrap();
        deck_state.cards[deal_idx + 1] = encrypted2.unwrap();

        deal_idx += 2;
        active_count += 1;
        msg!("BB (seat {}) posts {} and receives encrypted cards", bb_index, bb_amount);
    } else {
        // Remove from active players - no chips
        active_players &= !(1 << bb_index);
        bb_seat.status = PlayerStatus::Sitting;
        msg!("BB (seat {}) has no chips - sitting out", bb_index);
    }

    // Deal to other players via remaining_accounts
    for account_info in ctx.remaining_accounts.iter() {
        let data = account_info.try_borrow_data()?;
        if data.len() >= 8 {
            let seat = PlayerSeat::try_deserialize(&mut &data[..])?;

            // Skip SB and BB (already handled)
            if seat.table == table.key() &&
               seat.seat_index != sb_index &&
               seat.seat_index != bb_index {
                let seat_index = seat.seat_index;
                let has_chips = seat.chips > 0;
                drop(data);

                let mut data = account_info.try_borrow_mut_data()?;
                let mut seat = PlayerSeat::try_deserialize(&mut &data[..])?;

                if has_chips {
                    // ATOMIC ENCRYPTION: Encrypt cards via Inco FHE
                    msg!("Encrypting cards for seat {}...", seat_index);
                    let encrypted1 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx])?;
                    let encrypted2 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx + 1])?;

                    seat.hole_card_1 = encrypted1.unwrap();
                    seat.hole_card_2 = encrypted2.unwrap();
                    seat.status = PlayerStatus::Playing;
                    seat.current_bet = 0;
                    seat.total_bet_this_hand = 0;
                    seat.has_acted = false;
                    seat.cards_revealed = false;
                    seat.revealed_card_1 = 255;
                    seat.revealed_card_2 = 255;

                    // Store encrypted in deck for consistency
                    deck_state.cards[deal_idx] = encrypted1.unwrap();
                    deck_state.cards[deal_idx + 1] = encrypted2.unwrap();

                    deal_idx += 2;
                    active_count += 1;
                    msg!("Dealt encrypted hole cards to seat {}", seat_index);
                } else {
                    // Player has no chips - sit them out
                    active_players &= !(1 << seat_index);
                    seat.status = PlayerStatus::Sitting;
                    msg!("Seat {} has no chips - sitting out", seat_index);
                }

                seat.try_serialize(&mut *data)?;
            }
        }
    }

    // Update hand state with actual active players
    hand_state.active_players = active_players;
    hand_state.active_count = active_count;
    deck_state.deal_index = deal_idx as u8;

    // Verify we have enough active players
    require!(
        active_count >= 2,
        HiddenHandError::NotEnoughPlayers
    );

    // Find first active player to act (may need to skip players with no chips)
    let mut action_pos = hand_state.action_on;
    for _ in 0..table.max_players {
        if (active_players & (1 << action_pos)) != 0 {
            break;
        }
        action_pos = (action_pos + 1) % table.max_players;
    }
    hand_state.action_on = action_pos;

    // Advance to PreFlop
    hand_state.phase = GamePhase::PreFlop;
    hand_state.last_action_time = clock.unix_timestamp;
    hand_state.all_in_players = 0; // No one is all-in yet

    msg!(
        "VRF-shuffled + Inco-encrypted cards dealt. Pot: {}. Phase: PreFlop. Action on seat {}. Active players: {}",
        hand_state.pot,
        hand_state.action_on,
        active_count
    );
    msg!("IMPORTANT: Call grant_card_allowance for each player to enable decryption");

    Ok(())
}
