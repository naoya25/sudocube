<!-- translated from README.md — keep in sync when the Japanese version changes -->
English | [日本語](README.md)

<div align="center">

# 🧊 Sudocube

### Sudoku, wrapped onto a cube.

**Sudocube** is a browser puzzle that unfolds Sudoku onto the six faces of a cube.<br/>
Each face is a valid 9×9 Sudoku, and **adjacent faces share the digits along their common edge**.<br/>
Rotate the cube and fill all six faces so that everything is consistent at once.

🎮 **[Play Now — naoya25.github.io/sudocube](https://naoya25.github.io/sudocube/)**

<img src="docs/images/start-screen.png" alt="Start screen — Continue / New Game / History" width="49%" />
<img src="docs/images/gameplay.png" alt="Gameplay — glowing 3D cube board with number pad" width="49%" />

</div>

---

## Overview

|  | Classic Sudoku | Sudocube |
|---|---|---|
| Board | one 9×9 grid | **six** 9×9 faces (486 cells) |
| Cross-face constraints | none | shared across **12 edges & 8 corners** |
| Constraints per cell | row, column, block | + row/column/block of the **shared face** |

- Each face is ordinary Sudoku (1–9 once per row, column, and 3×3 block)
- Two adjacent faces share the nine cells along their edge with **equal values** (it's the same physical edge of the cube)
- At a **corner**, three faces meet and their three cells hold the same value

Cells joined along an edge must satisfy the rules of both faces at once. A single digit ripples across multiple faces — the source of Sudocube's unique "reasoning across faces."

→ Full rules: [docs/rules.md](docs/rules.md) · geometry proof: [docs/geometry.md](docs/geometry.md)

## Features

- **3D cube board** — drag to rotate (axis-locked, no accidental twisting), strong flicks spin the cube with inertia before it settles onto the nearest pose. At rest the cube always snaps to one of 24 orientations, and the digits stay upright on screen in every pose
- **Intro spin** — each game opens with a tumbling rotation from an oblique pose that lands facing front
- **Pencil notes** — toggle candidate digits in note mode. Notes stay in sync across twin cells on edges and corners, and entering a correct digit automatically removes that candidate from all peers (row, column, block, and cross-face twins). Same-number highlighting applies to note candidates too
- **Multi-save + history page** — games auto-save into multiple slots. The history page lets you resume or delete (two-tap confirm) any in-progress save, and lists cleared games with your BEST time
- **On-the-fly unique-solution generation** — a seed-deterministic generator builds a solved board, digs out cells, and only serves puzzles with exactly one solution
- **Ethereal design** — glass and soft glow on a fixed dark theme, with mobile support (touch controls, portrait HUD)

## Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Rotate cube | drag / flick outside the board | — |
| Select cell | tap / click a cell | arrow keys (moves within the front face) |
| Enter digit | number pad | `1`–`9` |
| Erase | eraser key | `⌫` / `Delete` / `0` |
| Toggle note mode | ✎ key on the pad | `M` |
| Toggle a note candidate | number pad while in note mode | `Shift` + `1`–`9` |

## Tech

- **Vite 8 + React 19 + TypeScript**, 3D via **three.js + @react-three/fiber**, linted with oxlint, tested with Vitest
- **React-free core logic** (`src/core/`) — geometry (automatic edge/corner correspondence), board, solver, generator (seed-deterministic, uniqueness-guaranteed), session (input, mistakes, score), notes, and persistence (multi-slot saves) are plain TypeScript backed by unit tests
- **Rendering** — one CanvasTexture per face (six total), with a precomputed "24 poses × 6 faces → upright glyph angle" table so digits are always drawn upright

→ Design notes: [docs/overview.md](docs/overview.md) / [docs/data-structure.md](docs/data-structure.md) / [docs/generation.md](docs/generation.md)

## Development

```bash
git clone https://github.com/naoya25/sudocube.git
cd sudocube
npm install
npm run dev      # dev server
npm run test     # Vitest (unit tests for core logic)
npm run lint     # oxlint
npm run build    # tsc -b && vite build
```

Deployment: pushing to main triggers GitHub Actions, which builds and publishes to GitHub Pages ([deploy.yml](.github/workflows/deploy.yml)).

→ History and next steps: [docs/roadmap.md](docs/roadmap.md)

## License

MIT License (planned; `LICENSE` file to be added).
