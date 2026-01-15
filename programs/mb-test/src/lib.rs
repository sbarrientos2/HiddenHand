//! Minimal test program to verify MagicBlock delegation works

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

declare_id!("9h6kf5BhG7nfKFJhtkxJzMdKGRRwgomp5cVYTG8AUYpT");

pub const COUNTER_SEED: &[u8] = b"counter";

#[program]
pub mod mb_test {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.value = 0;
        counter.bump = ctx.bumps.counter;
        msg!("Counter initialized");
        Ok(())
    }

    pub fn delegate(ctx: Context<DelegateInput>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[COUNTER_SEED],
            DelegateConfig::default(),
        )?;
        msg!("Counter delegated to ER");
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.value = counter.value.saturating_add(1);
        msg!("Counter incremented to {}", counter.value);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Counter::SIZE,
        seeds = [COUNTER_SEED],
        bump
    )]
    pub counter: Account<'info, Counter>,

    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateInput<'info> {
    pub payer: Signer<'info>,
    /// CHECK: The counter PDA to delegate
    #[account(mut, del)]
    pub counter: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [COUNTER_SEED],
        bump = counter.bump
    )]
    pub counter: Account<'info, Counter>,
}

#[account]
pub struct Counter {
    pub value: u64,
    pub bump: u8,
}

impl Counter {
    pub const SIZE: usize = 8 + 8 + 1; // discriminator + value + bump
}
