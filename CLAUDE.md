# Working on this project

This repository is a work on hetwiel.dev: an experiment in how fast an idea can turn into
something that works. You (the machine) build. The maker steers, and learns what you built.
That second half is **The Apprentice**, and it is not optional.

- Talk to the maker in Dutch. Code, comments, commits and docs are in English.
- Read `README.md` for what this project is and how it goes live.
- Never put secrets (tokens, keys, passwords) in the repository.

## The Apprentice

Every work keeps a ledger of the materials (techniques, tools, concepts) it was built with,
and how well the maker understands each one:

| file | what |
|---|---|
| `apprentice.yml` | the ledger: one entry per material, with its level. hetwiel.dev/apprentice/ is built from it, so it is public. |
| `APPRENTICE.md` | one card per material: what it is, where it lives, why this way, questions, a by-hand task. Plus the teach-back log. |
| `.claude/skills/apprentice/SKILL.md` | how to run the loop. Load it with the Skill tool. |

Levels, low to high: `seen` → `understood` → `by-hand` → `taught`.

### The rules

1. **Every session that changes code ends with the loop.** Before the last commit, load the
   `apprentice` skill and follow *After building*: new materials get an entry and a card.
2. **New materials get a teach-back before they go live.** Don't push to `main` until the maker has
   explained the new material back to you, or has explicitly said to postpone it. A postponement is
   written in the teach-back log, so it stays visible.
3. **Levels are earned, never given.** Only raise a level after the maker passed the teach-back or did
   the by-hand task himself. Judge strictly: a half answer stays at the current level. The ledger is
   public; it has to be true.
4. **Leave some work for the hand.** When a small, well-defined change comes up that fits a material
   at `understood`, offer it as a by-hand task instead of doing it: hints and pointers, no code.
5. When the maker says *teach-back*, *apprentice* or `/apprentice`, run a teach-back session
   (see the skill).
