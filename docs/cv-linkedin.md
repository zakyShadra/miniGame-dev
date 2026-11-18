# CV bullets + LinkedIn draft (puzzleGame)

Draf faktual, tanpa angka yang tidak terverifikasi. Link demo sudah
live; link repo di draf LinkedIn memakai repo kerja puzzleGame-dev,
ganti ke https://github.com/zakyShadra/puzzleGame setelah repo display
terisi history bertahap.

## CV bullets (Bahasa Inggris)

### Varian 1 (satu bullet lengkap)

Built puzzleGame, a real-time multiplayer jigsaw puzzle web app
(Vue 3, TypeScript, Cloudflare Workers). Two players solve the same
puzzle over WebSocket with live cursors, drag locks, in-room chat,
and server-authoritative state persisted in Durable Objects (SQLite).

### Varian 2 (dua bullet)

- Built and deployed puzzleGame, a real-time multiplayer jigsaw
  puzzle web app: Vue 3 + Canvas 2D frontend, PartyServer on
  Cloudflare Workers, Durable Objects for server-authoritative room
  state, WebSocket sync with drag locks and live cursors.
- Implemented the jigsaw engine from scratch: seeded bezier-cut piece
  generator, Canvas 2D renderer, snap detection, and piece grouping
  (correctly adjacent pieces stick together and move as one).

### Varian 3 (satu baris, hemat tempat)

puzzleGame: real-time multiplayer jigsaw puzzle web app (Vue 3,
PartyServer, Cloudflare Workers + Durable Objects, WebSocket).

## LinkedIn draft

Small side project, shipped: puzzleGame, a multiplayer jigsaw puzzle
you play in the browser with someone else, in real time.

One board, two cursors. You pick a photo (or upload your own), pick
how many pieces (12-500), share a room link, and solve it together.
Pieces snap in place, correctly adjacent pieces stick into groups you
can move as one, and the server keeps the state, so a refresh never
loses progress.

Stack: Vue 3 + TypeScript + Canvas 2D on the front, PartyServer on
Cloudflare Workers with Durable Objects for the room state, everything
on free tiers.

Try it: https://puzzle-game-avl.pages.dev/
Code: https://github.com/zakyShadra/puzzleGame-dev

Built it to play with my girlfriend. She picks the photos.
