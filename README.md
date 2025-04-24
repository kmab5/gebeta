# Gebe'ta - Ethiopian Traditional Game

Hey there! 👋 This is my take on the ancient Ethiopian game Gebe'ta (also known as Mancala). I built this as a fun weekend project to learn more about game development and try my hand at implementing some basic AI.

## What's this game about?

Gebe'ta is a "count and capture" game that's been played for centuries across Africa. It's super intuitive once you get the hang of it!

### Quick Rules

- Each pit starts with 4 stones
- On your turn, grab all stones from one of your pits and drop them one-by-one counterclockwise
- If your last stone lands in a pit that now has exactly 4 stones, you capture them all!
- If your last stone lands in your own row and that pit has more than one stone now, you get another turn!
- Game ends when someone's row is empty - then the other player gets all the stones left in their row
- Most stones wins!

## Cool Features

- **Play against a friend** on the same device
- **Play online** with someone else (share a room code!)
- **Challenge the CPU** with different difficulty levels:
  - 😌 Easy - Makes random moves
  - 😐 Medium - Tries its best to make decent moves
  - 😡 Hard - Actually thinks about its moves
  - 🤯 Extreme - Will absolutely destroy you (probably)

- **Dark mode** for late-night gaming sessions
- **Helpful toasts** that tell you what's happening

## How to Play

1. Just open the game and pick a mode!
2. For online play, enter any room code (your friend needs the same code)
3. Click on your pits to move
4. Have fun!

## Setting Up Online Play

If you want to play with a friend online:

1. Go to the `server` folder
2. Run `npm install`
3. Start it with `node server.js`
4. Select "Online PvP" in the game
5. Share the room code with your friend

## About This Project

I built this to learn more about:

- Game state management in JavaScript
- Socket.IO for real-time communication
- Basic AI algorithms (the Extreme CPU uses a simplified minimax!)

Feel free to fork it, break it, fix it, or improve it! This is just a hobby project so don't expect perfection 😉

## Credits

Shoutout to Ethiopian culture for this awesome game that's been around for centuries! All the code is written by me with lots of ☕ and 🍕.

Enjoy!

- kmab
