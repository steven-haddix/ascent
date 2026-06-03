
# Ascent
**Learn anything by growing it, not memorizing it.**

<img width="1801" height="1153" alt="Screenshot 2026-06-03 at 11 15 55 AM" src="https://github.com/user-attachments/assets/896a0470-88ec-41b6-85d4-d16ed74d412d" />


Ascent is a desktop app for learning hard things deeply. Instead of handing you a fixed
course, it grows a living **tree of concepts** around whatever you want to understand —
writing each lesson on demand, letting you branch into any term that puzzles you, and then
making you **prove you actually get it** by explaining it back in your own words.

It works for *anything*: machine learning, music theory, tax law, organic chemistry,
the French Revolution. The app ships with Machine Learning as a sample topic, but it knows
nothing about any subject — you bring the curiosity, it builds the path.

Ascent runs entirely on your own machine, has no accounts, and uses **your own AI API key**.
Your learning is yours.

---

## How it works in 30 seconds

1. **Name something you want to learn** — a topic, a question, a curiosity.
2. Ascent sketches a **tree of concepts** to climb, from foundations upward.
3. Click any concept and it **writes the lesson live**, tuned to where it sits in your tree.
4. Hit a term you don't know? **Click it to branch** — it becomes its own concept with its own lesson.
5. **Ask the built-in tutor** anything about what you're reading, without leaving the page.
6. **Prove you understand it:** explain the concept back in plain words. Ascent grades your
   explanation, shows you exactly where it was strong, fuzzy, or wrong — and turns your gaps
   into fresh branches to go study.

That last step is the whole point. Re-reading feels like learning; *explaining* is learning.
Ascent is built around that loop.

---

## What you can do today

- **Grow a concept tree** for any subject and navigate it like a map of your understanding.
- **Read lessons that are written for you**, streamed in as they generate, with the
  surrounding concepts as context so they connect instead of repeating.
- **Branch on any term** — every lesson is full of clickable terms you can fork into their
  own lessons, so you follow your own curiosity instead of a syllabus.
- **Chat with a tutor** grounded in the exact concept you're on, in the style you prefer —
  **Mentor**, **Socratic**, or **Encyclopedic**.
- **Take notes** and **quiz yourself** on any concept, right alongside the lesson.
- **Read and run code in lessons** — for programming and ML topics, lessons include real,
  syntax-highlighted code inline, and the Code tab on the right lets you **edit and Run**
  any Python snippet right there. No setup needed. *(The first Run downloads Python in the
  background — a one-time ~10MB, then it's instant.)*
- **Teach it back (the Feynman loop):** explain a concept to a 12-year-old, a peer, or an
  expert; get a graded breakdown (clarity, accuracy, completeness, mental model), see your
  own words annotated, and watch your weak spots automatically become new branches to learn.
- **Regenerate any lesson** if you want a fresh take.
- **Three calm themes** — warm cream, clean paper, and dark — for long reading sessions.

## What's coming

- A ⌘K command palette and a graph view of your whole tree
- More model providers (and the option to run fully local)
- Optional, opt-in sync across your devices
- Windows and Linux builds

---

## Your data & your privacy

Ascent is **local-first and private by design**:

- Everything you create — your trees, lessons, notes, quizzes, and teach-back history —
  lives in a plain database **on your computer**. Nothing is uploaded.
- There are **no accounts, no sign-up, and no tracking**.
- Your AI API key is stored in the **macOS Keychain**, never in the app's files. When Ascent
  generates a lesson it talks **directly to your AI provider** — there is no Ascent server in
  the middle, ever.

Because you bring your own key, **Ascent itself is free** — you simply pay your AI provider
(currently [Anthropic](https://console.anthropic.com/)) for the usage you choose to make.

---

## Getting started

> Ascent is **macOS-first** and still early, so for now you run it by building it from source.
> Packaged downloads will come later. The steps below are copy-paste friendly.

**1. Get an Anthropic API key.** Create one at
[console.anthropic.com](https://console.anthropic.com/) (you'll add a little credit to your
account; Ascent uses Claude models). You'll paste this key the first time you open the app.

**2. Install the prerequisites** (one-time):

```bash
# Xcode command line tools (for the macOS build)
xcode-select --install

# Rust (press Enter to accept defaults)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Bun (the package manager / runtime Ascent uses)
curl -fsSL https://bun.sh/install | bash
```

**3. Get Ascent and run it:**

```bash
git clone https://github.com/steven-haddix/ascent.git
cd ascent
bun install
bun tauri dev
```

The first launch compiles the native shell, so it can take a few minutes — after that it's
fast. To produce a standalone `.app` instead, run `bun tauri build`.

**4. On first run**, paste your Anthropic API key (it goes straight to the Keychain), pick a
topic, and start climbing.

---

## Contributing

Ascent is early and evolving fast. Bug reports, ideas, and feedback are very welcome —
please open an [issue](https://github.com/steven-haddix/ascent/issues). If you're thinking
about a larger contribution, open an issue first so we can talk it through.

## License

Not licensed yet — a proper open-source license is coming. Until then the code is
source-available: you're welcome to read, build, and run it locally, but please open an issue
before redistributing or building on it. (This note will be replaced with a real license soon.)

---

## Under the hood

For the curious: Ascent is a [Tauri](https://tauri.app/) app (a small Rust shell around a web
UI), built with React and TypeScript, storing data in a local SQLite database, and generating
content through the [Vercel AI SDK](https://sdk.vercel.ai/). The AI provider is abstracted, so
adding more models later is a small change.
