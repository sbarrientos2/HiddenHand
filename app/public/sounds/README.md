# Sound Files for HiddenHand

Place the following MP3 files in this directory:

| File | Description | Suggested Source |
|------|-------------|------------------|
| `card-deal.mp3` | Card sliding/dealing | [Mixkit](https://mixkit.co/free-sound-effects/card/) |
| `card-flip.mp3` | Card flip/reveal | [Mixkit](https://mixkit.co/free-sound-effects/card/) |
| `chip-bet.mp3` | Chips being bet | [Freesound](https://freesound.org/search/?q=poker+chips) |
| `chip-win.mp3` | Winning pot (chip cascade) | [Freesound](https://freesound.org/search/?q=coins+win) |
| `fold.mp3` | Soft card toss | [Mixkit](https://mixkit.co/free-sound-effects/card/) |
| `check.mp3` | Knuckle tap / click | [Freesound](https://freesound.org/search/?q=tap+table) |
| `all-in.mp3` | Dramatic chip push | [Freesound](https://freesound.org/search/?q=poker+all+in) |
| `your-turn.mp3` | Subtle notification chime | [Mixkit](https://mixkit.co/free-sound-effects/notification/) |
| `timer-warning.mp3` | Soft tick/warning | [Freesound](https://freesound.org/search/?q=timer+tick) |
| `shuffle.mp3` | Card shuffling | [Mixkit](https://mixkit.co/free-sound-effects/card/) |

## Free Sound Resources

1. **Mixkit** (https://mixkit.co/free-sound-effects/) - No attribution required
2. **Freesound** (https://freesound.org/) - Check license per sound
3. **Zapsplat** (https://www.zapsplat.com/) - Free with attribution

## Quick Download Script

```bash
# Example using Mixkit (check their terms)
# These URLs are examples - find actual files on the sites above

# Card sounds from Mixkit
curl -o card-deal.mp3 "https://assets.mixkit.co/sfx/download/mixkit-card-slide-240.mp3"
curl -o card-flip.mp3 "https://assets.mixkit.co/sfx/download/mixkit-plastic-card-flip-2621.mp3"
curl -o shuffle.mp3 "https://assets.mixkit.co/sfx/download/mixkit-cards-deck-shuffle-1654.mp3"
```

## Volume Levels

The sound system automatically adjusts volumes:
- Subtle sounds (check, fold): 30-40%
- Normal sounds (bet, deal): 50-60%
- Important sounds (your turn, win, all-in): 60-80%

You can adjust these in `/app/lib/sounds.ts` in the `SOUND_VOLUMES` object.
