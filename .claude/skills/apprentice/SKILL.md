---
name: apprentice
description: Run The Apprentice learning loop for this work. Use at the end of every session that changed code (record new materials and gate them with a teach-back), when the maker asks for a teach-back, apprentice or /apprentice session, or when a small change could be done by the maker by hand.
---

# The Apprentice

The machine builds; the maker must keep up. This skill keeps the ledger (`apprentice.yml`)
and the cards (`APPRENTICE.md`) of this work honest and up to date, and runs the teach-backs.
Talk to the maker in Dutch; write the files in English.

## Levels

| level | earned when |
|---|---|
| `seen` | the material is in the work and has a card. The starting level of everything. |
| `understood` | the maker explained it in his own words, without looking, and answered the card's questions well. |
| `by-hand` | the maker made a real change with it himself. You may point and hint; you may not type the code. |
| `taught` | the maker explained it from scratch to someone new: to you playing a newcomer who asks naive follow-up questions, or he reports having taught a person. |

A material moves at most one level per session. A level never goes down silently: if the maker
clearly no longer understands something, say so and ask whether to lower it.

## 1. After building

At the end of every session that changed code, before the last commit:

1. List the materials this session used. A material is a technique, tool or concept the maker would
   need to understand to maintain this himself (e.g. "reverse proxy", "refresh tokens", "a queue on disk").
   Not every library call; aim for the level of the existing entries.
2. For each material that is **not** in `apprentice.yml` yet:
   - add an entry: `id`, `name` (short, plain words), `note` (one sentence, under 110 characters,
     for a curious outsider), `level: seen`, `since: <today>`;
   - add a card to `APPRENTICE.md` in the existing format: *What it is*, *Where it lives*,
     *Why this way*, three *Questions*, one *By hand* task.
3. For a material that **is** there but changed meaningfully, update its card (not its level).
4. Gate: if any material is new, run a short teach-back on just those (section 2) before pushing.
   If the maker wants to postpone, push, and write a line in the teach-back log:
   `<date> · postponed: <ids>`.

## 2. A teach-back session

Pick 3 to 5 materials, lowest level first (or the ones the maker names). For each, one at a time:

1. Ask the maker to explain it in his own words: what it is, and what it does in this work.
   He doesn't look at the card first. Wait for the answer.
2. Ask the card's questions, **one at a time**. Follow up on vague answers.
3. Judge out loud, briefly and honestly: **understood**, **half** or **not yet**.
   - *understood*: correct, in his own words, and he could apply it to a new situation.
   - *half*: the gist is there, but a question was missed or the answer was borrowed wording.
     Explain what was missing. The level stays.
   - *not yet*: explain the material properly, with this work's own files as the example.
     The level stays.
4. Only on *understood*: set the level to `understood` and `since` to today.

Explaining is fine and encouraged *after* the maker has tried. Never feed the answer before he tries.

Afterwards, add a line at the top of the teach-back log in `APPRENTICE.md`:
`<date> · <id>: understood · <id>: half · …` and commit with a message like
`Apprentice: teach-back on <ids>`.

## 3. By hand

When the maker wants to move a material to `by-hand`, or a small change comes up that fits one:

1. Give the card's *By hand* task, or a real task from the current work.
2. Help with pointers: which file, which concept, what to look up. No code, no exact lines.
3. When it works and the maker made the change himself, set the level to `by-hand`, log it,
   and commit (the maker's own commit is the proof).

## 4. Taught

Play a newcomer: no background, curious, asks naive and slightly annoying follow-up questions.
The maker explains the material from scratch. Pass only if the explanation is correct, complete
enough for the newcomer to act on, and survives three follow-ups. Or: the maker reports he taught
a real person; ask what questions they asked and how he answered.

## Files

- `apprentice.yml`: the ledger. Keep the header comment. hetwiel.dev/apprentice/ is built from it,
  so it is public: no secrets, no personal details, plain words.
- `APPRENTICE.md`: the cards and the teach-back log (newest at the top).

hetwiel.dev picks up changes to the ledger on its next deploy (every morning, or on a push to the
hetwiel repo).
