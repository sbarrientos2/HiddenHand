Where Each Technology Is Used

MagicBlock ER (Ephemeral Rollup)

Purpose: Fast gameplay execution in a TEE

Used for:
┌───────────────────────┬──────────────────────────────────────┐
│ Action │ Why MagicBlock │
├───────────────────────┼──────────────────────────────────────┤
│ Shuffle the deck │ TEE protects shuffle from being seen │
├───────────────────────┼──────────────────────────────────────┤
│ Deal cards to players │ Fast, private execution │
├───────────────────────┼──────────────────────────────────────┤
│ All betting rounds │ 120ms latency instead of 400ms │
├───────────────────────┼──────────────────────────────────────┤
│ Pot calculations │ Fast state updates │
├───────────────────────┼──────────────────────────────────────┤
│ Action rotation │ Real-time gameplay feel │
└───────────────────────┴──────────────────────────────────────┘
When: The entire game loop runs on ER

---

Inco (FHE Encryption)

Purpose: Cryptographic encryption + selective decryption

Used for:
┌───────────────────────────────────────────────┬───────────────────────────────────┐
│ Action │ Why Inco │
├───────────────────────────────────────────────┼───────────────────────────────────┤
│ Encrypt each card after shuffle │ Creates unreadable handle │
├───────────────────────────────────────────────┼───────────────────────────────────┤
│ Grant allowance to player │ Only card owner can decrypt │
├───────────────────────────────────────────────┼───────────────────────────────────┤
│ Grant allowance to everyone (community cards) │ Flop/turn/river reveals │
├───────────────────────────────────────────────┼───────────────────────────────────┤
│ Player decrypts their hole cards │ Client-side with wallet signature │
├───────────────────────────────────────────────┼───────────────────────────────────┤
│ Verify showdown reveals │ Prove cards match handles │
└───────────────────────────────────────────────┴───────────────────────────────────┘
When:

- During deal (encrypt cards)
- During reveals (grant allowances)
- Client-side (decrypt to view cards)

---

Simple Timeline

START HAND
│
├─► VRF generates seed (base layer)
│
▼
DELEGATE TO ER
│
├─► MagicBlock: Shuffle deck using seed
├─► MagicBlock: Deal cards
├─► Inco: Encrypt each card → handles
├─► Inco: Grant allowance to each player
│
▼
GAMEPLAY (all on MagicBlock ER)
│
├─► Player bets → MagicBlock (fast)
├─► Player folds → MagicBlock (fast)
├─► Reveal flop → Inco grants allowance
├─► More betting → MagicBlock (fast)
│
▼
SHOWDOWN
│
├─► Players reveal cards → Inco verifies
├─► Winner calculated → MagicBlock
│
▼
COMMIT TO BASE LAYER
│
└─► Final chip counts saved (only encrypted handles on-chain)

---

One Sentence Each

- MagicBlock: Runs the game fast and keeps execution private
- Inco: Encrypts cards so only the owner can see them
