<!-- translated from README.md — keep in sync when the Japanese version changes -->
English | [日本語](README.md)

<div align="center">

# 🧊 Sudocube

### Sudoku, wrapped onto a cube.

**Sudocube** is a browser puzzle that unfolds Sudoku onto the six faces of a cube.<br/>
Each face is a valid 9×9 Sudoku, and **adjacent faces share the digits along their shared edge**.<br/>
Rotate the cube and fill all six faces so that everything is consistent at once.

🎮 **[Play Now](https://naoya25.github.io/sudocube/)** &nbsp;·&nbsp; Vite + React + TypeScript

</div>

---

## 🧩 Demo

> 🚧 **Work in progress** — a clip of rotating the cube and filling cells will go here once the UI is built.

## ✨ Features

|  | Classic Sudoku | Sudocube |
|---|---|---|
| Board | one 9×9 grid | **six** 9×9 faces (486 cells) |
| Cross-face constraints | none | shared across **12 edges & 8 corners** |
| Constraints per cell | row, column, block | + row/column/block of the **shared face** |

Cells joined along an edge must satisfy the rules of both faces at once. A single digit ripples across multiple faces — the source of Sudocube's unique "reasoning across faces."

## 🎮 Rules

- Each face is ordinary Sudoku (1–9 once per row, column, and 3×3 block)
- Two adjacent faces share the nine cells along their edge with **equal values** (it's the same physical edge of the cube)
- At a **corner**, three faces meet and their three cells hold the same value

→ See [docs/rules.md](docs/rules.md)

## 💡 Why

> Classic Sudoku lives on a single flat grid. Wrap it onto a cube and share digits along the edges, and you get a brand-new kind of Sudoku — one that forces you to reason across faces. I'm building Sudocube to see whether that board actually holds together.
>
> <sub>(to be replaced with the author's own words)</sub>

The biggest worry — "maybe the constraints are so tight that no solution exists" — has already been settled experimentally: a complete solved board provably exists (→ [docs/geometry.md](docs/geometry.md)).

## 🛠 Tech Stack

- **Vite** + **React** + **TypeScript**
- Lint: oxlint
- 3D rendering (cube rotation + snap-to-front) will use three.js / react-three-fiber

## 🚀 Run Locally

```bash
git clone https://github.com/naoya25/sudocube.git
cd sudocube
npm install
npm run dev
```

## 🗺 Roadmap

Feasibility is verified. Currently building the generation logic (solved board → dig out cells → unique-solution puzzle). The 3D snap-rotation UI comes next.

→ See [docs/roadmap.md](docs/roadmap.md)

## 📄 License

MIT License (planned; `LICENSE` file to be added).
