use anchor_lang::prelude::*;

// VRF imports
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

// Ephemeral Rollups imports
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("9h6kf5BhG7nfKFJhtkxJzMdKGRRwgomp5cVYTG8AUYpT");

pub const GAME_SEED: &[u8] = b"game";
pub const PLAYER_SEED: &[u8] = b"player";

/// Simple test program to learn MagicBlock VRF and Ephemeral Rollups
#[ephemeral]
#[program]
pub mod mb_test {
    use super::*;

    // ============================================================
    // PART 1: VRF (Verifiable Random Function)
    // ============================================================

    /// Initialize a game state account
    pub fn initialize_game(ctx: Context<InitializeGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.authority = ctx.accounts.authority.key();
        game.random_value = 0;
        game.shuffle_complete = false;
        msg!("Game initialized: {}", game.key());
        Ok(())
    }

    /// Request random number from VRF oracle
    pub fn request_random(ctx: Context<RequestRandom>, client_seed: u8) -> Result<()> {
        msg!("Requesting randomness with seed: {}", client_seed);

        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackRandom::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.game.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });

        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

        msg!("VRF request sent!");
        Ok(())
    }

    /// Callback from VRF oracle with randomness
    pub fn callback_random(ctx: Context<CallbackRandom>, randomness: [u8; 32]) -> Result<()> {
        let game = &mut ctx.accounts.game;

        // Convert first 8 bytes to u64 for demonstration
        let random_u64 = u64::from_le_bytes(randomness[0..8].try_into().unwrap());

        game.random_value = random_u64;
        game.shuffle_complete = true;

        msg!("Received randomness! First u64: {}", random_u64);
        msg!("Full randomness: {:?}", randomness);

        Ok(())
    }

    // ============================================================
    // PART 2: Ephemeral Rollups (Delegation)
    // ============================================================

    /// Initialize a player account with some private data
    pub fn initialize_player(ctx: Context<InitializePlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.owner = ctx.accounts.owner.key();
        player.public_score = 0;
        player.private_hand = [0, 0]; // Two cards, initially empty
        msg!("Player initialized: {}", player.key());
        Ok(())
    }

    /// Set player's private hand (simulating card deal)
    pub fn set_hand(ctx: Context<SetHand>, card1: u8, card2: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.private_hand = [card1, card2];
        msg!("Hand set: [{}, {}]", card1, card2);
        Ok(())
    }

    /// Increment the public score
    pub fn increment_score(ctx: Context<IncrementScore>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.public_score += 1;
        msg!("Score incremented to: {}", player.public_score);
        Ok(())
    }

    /// Delegate player account to Ephemeral Rollup
    pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
        let owner = ctx.accounts.owner.key();

        ctx.accounts.delegate_player(
            &ctx.accounts.payer,
            &[PLAYER_SEED, owner.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;

        msg!("Player account delegated to ER");
        Ok(())
    }

    /// Commit and undelegate player account back to base layer
    pub fn undelegate_player(ctx: Context<UndelegatePlayer>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.player.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        msg!("Player account undelegated from ER");
        Ok(())
    }
}

// ============================================================
// ACCOUNTS STRUCTURES
// ============================================================

/// Game state - demonstrates VRF randomness
#[account]
#[derive(InitSpace)]
pub struct Game {
    pub authority: Pubkey,
    pub random_value: u64,
    pub shuffle_complete: bool,
}

/// Player state - demonstrates private data
#[account]
#[derive(InitSpace)]
pub struct Player {
    pub owner: Pubkey,
    pub public_score: u64,
    pub private_hand: [u8; 2], // Two cards (would be private in PER)
}

// ============================================================
// INSTRUCTION CONTEXTS
// ============================================================

// --- VRF Contexts ---

#[derive(Accounts)]
pub struct InitializeGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Game::INIT_SPACE,
        seeds = [GAME_SEED],
        bump
    )]
    pub game: Account<'info, Game>,

    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestRandom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED],
        bump
    )]
    pub game: Account<'info, Game>,

    /// CHECK: The oracle queue for VRF
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CallbackRandom<'info> {
    /// CHECK: VRF program identity - ensures callback is from VRF program
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

    #[account(mut, seeds = [GAME_SEED], bump)]
    pub game: Account<'info, Game>,
}

// --- Ephemeral Rollup Contexts ---

#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub owner: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Player::INIT_SPACE,
        seeds = [PLAYER_SEED, owner.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetHand<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub player: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct IncrementScore<'info> {
    #[account(mut, seeds = [PLAYER_SEED, player.owner.as_ref()], bump)]
    pub player: Account<'info, Player>,
}

/// Delegate player account to Ephemeral Rollup
#[delegate]
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub owner: Signer<'info>,

    /// CHECK: The player account to delegate
    #[account(
        mut,
        del,
        seeds = [PLAYER_SEED, owner.key().as_ref()],
        bump
    )]
    pub player: AccountInfo<'info>,
}

/// Undelegate player account from Ephemeral Rollup
#[commit]
#[derive(Accounts)]
pub struct UndelegatePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, player.owner.as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,
}
