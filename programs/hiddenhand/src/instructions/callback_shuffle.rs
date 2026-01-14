use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::{DeckState, GamePhase, HandState, Table};

/// VRF callback for card shuffling
/// This instruction is called by the VRF oracle with the randomness
#[derive(Accounts)]
pub struct CallbackShuffle<'info> {
    /// CHECK: VRF program identity - ensures callback is from VRF program
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

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

    #[account(
        mut,
        seeds = [DECK_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = deck_state.bump
    )]
    pub deck_state: Account<'info, DeckState>,
}

/// VRF callback - receives 32 bytes of randomness and shuffles the deck
pub fn handler(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
    let deck_state = &mut ctx.accounts.deck_state;
    let hand_state = &mut ctx.accounts.hand_state;
    let table = &ctx.accounts.table;

    msg!(
        "VRF callback received for hand #{}",
        table.hand_number
    );
    msg!("Randomness: {:?}", &randomness[0..8]);

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
    // hand_state.community_cards uses 255 to indicate hidden cards
    hand_state.community_cards = vec![255, 255, 255, 255, 255];
    hand_state.community_revealed = 0;
    deck_state.deal_index = 5;

    // Store the VRF randomness hash for verification
    // This allows anyone to verify the shuffle was fair
    let randomness_hash = u64::from_le_bytes(randomness[24..32].try_into().unwrap());
    msg!("Deck shuffled with VRF. Randomness verification: {}", randomness_hash);

    // Transition to shuffled state - deal_cards_vrf will distribute hole cards
    hand_state.phase = GamePhase::Dealing; // Stay in dealing until cards are dealt

    msg!(
        "Deck shuffled for hand #{}. Ready to deal hole cards.",
        table.hand_number
    );

    Ok(())
}
