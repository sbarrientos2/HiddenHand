use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, Table, TableStatus};

/// Request VRF randomness for card shuffling
/// This instruction initiates the shuffle process - the actual shuffle
/// happens in the callback_shuffle instruction when VRF responds
#[vrf]
#[derive(Accounts)]
pub struct RequestShuffle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
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

    /// CHECK: The VRF oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

/// Request VRF randomness for shuffling
/// This is the first step of dealing - VRF will callback with randomness
pub fn handler(ctx: Context<RequestShuffle>) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &ctx.accounts.hand_state;
    let deck_state = &ctx.accounts.deck_state;

    // Validate we're in the right phase
    require!(
        hand_state.phase == GamePhase::Dealing,
        HiddenHandError::InvalidPhase
    );

    require!(
        !deck_state.is_shuffled,
        HiddenHandError::DeckAlreadyShuffled
    );

    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // Use table_id + hand_number as unique seed for this shuffle
    let mut client_seed = [0u8; 32];
    client_seed[0..8].copy_from_slice(&table.hand_number.to_le_bytes());
    client_seed[8..16].copy_from_slice(&Clock::get()?.slot.to_le_bytes());

    // Create VRF request - callback will go to callback_shuffle instruction
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.authority.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackShuffle::DISCRIMINATOR.to_vec(),
        caller_seed: client_seed,
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: ctx.accounts.table.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.hand_state.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.deck_state.key(),
                is_signer: false,
                is_writable: true,
            },
        ]),
        ..Default::default()
    });

    // Invoke VRF request
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.authority.to_account_info(), &ix)?;

    msg!("VRF shuffle request sent for hand #{}", table.hand_number);
    Ok(())
}
