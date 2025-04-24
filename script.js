document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://gebeta-z1yt.onrender.com:11142'); // Connect to the backend server
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const resetButton = document.getElementById('reset-button');
    const rulesButton = document.getElementById('rules-button');
    const gameModeModal = document.getElementById('game-mode-modal');
    const pvpModeButton = document.getElementById('pvp-mode');
    const onlinePvpModeButton = document.getElementById('online-pvp-mode');
    const cpuModeButton = document.getElementById('cpu-mode');
    const difficultySelection = document.getElementById('difficulty-selection');
    const difficultyButtons = document.querySelectorAll('.difficulty-button');
    const body = document.body;
    const turnIndicator = document.getElementById('current-turn');
    const rowP1 = document.querySelector('tbody tr:nth-child(1)');
    const rowP2 = document.querySelector('tbody tr:nth-child(2)');
    const scoreP1 = document.getElementById('score-p1');
    const scoreP2 = document.getElementById('score-p2');
    const cellsP1 = document.querySelectorAll('tr:nth-child(1) .cell');
    const cellsP2 = document.querySelectorAll('tr:nth-child(2) .cell');
    const modeSelect = document.querySelector('#selection');
    const playerSelect = document.querySelector('#player_select');
    const p1select = document.querySelector('#p1-mode');
    const p2select = document.querySelector('#p2-mode');

    let currentPlayer = 'P1'; // Start with Player 1
    let thisPlayer = '';
    let isCPU = false; // Flag to determine if the CPU is playing
    let cpuDifficulty = 'easy'; // Default CPU difficulty
    let isOnline = false;
    let roomId = null;
    const loopCoordinates = [
        [0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5],
        [0, 5], [0, 4], [0, 3], [0, 2], [0, 1]
    ];

    // Show the game mode selection modal
    function showGameModeModal() {
        gameModeModal.classList.add('show');
    }

    // Hide the game mode selection modal
    function hideGameModeModal() {
        gameModeModal.classList.remove('show');
    }

    // Initialize cells with value 4 and unmoved state
    function initializeCells() {
        [...cellsP1, ...cellsP2].forEach(cell => {
            cell.textContent = 4;
            cell.classList.remove('moved');
            cell.classList.add('unmoved');
        });
    }

    // CPU makes a move based on difficulty
    function cpuMove() {
        const validCells = [...cellsP2].filter(cell => parseInt(cell.textContent) > 0);

        if (validCells.length > 0) {
            let cell;

            switch (cpuDifficulty) {
                case 'easy':
                    // Easy: Pick a random valid cell
                    cell = validCells[Math.floor(Math.random() * validCells.length)];
                    break;

                case 'medium':
                    // Medium: Basic minimax-like logic (maximize immediate gain)
                    cell = basicMinimax(validCells);
                    break;

                case 'hard':
                    // Hard: Simulate moves and pick the cell with the highest simulated score
                    cell = simulateBestMove(validCells);
                    break;

                case 'extreme':
                    // Extreme: Advanced minimax with depth and opponent consideration
                    cell = advancedMinimax(validCells, 3); // Depth of 3
                    break;
            }

            cell.click(); // Simulate a click on the selected cell
        }
    }

    // Medium: Basic minimax-like logic
    function basicMinimax(validCells) {
        let bestCell = null;
        let bestScore = -Infinity;

        validCells.forEach(cell => {
            const cellValue = parseInt(cell.textContent);
            if (cellValue > bestScore) {
                bestScore = cellValue;
                bestCell = cell;
            }
        });

        return bestCell;
    }

    // Hard: Simulate moves and pick the cell with the highest simulated score
    function simulateBestMove(validCells) {
        let bestCell = null;
        let bestScore = -Infinity;

        validCells.forEach(cell => {
            let simulatedScore = 0;

            // Simulate distributing the value of the cell
            let value = parseInt(cell.textContent);
            let currentIndex = getCellIndex(cell);

            while (value > 0) {
                currentIndex = (currentIndex + 1) % loopCoordinates.length;
                const [row, col] = loopCoordinates[currentIndex];

                if (row === 1) {
                    // Add to simulated score if the cell is in the CPU's row
                    simulatedScore += 1;
                    if(value === 1 && col < 5) {
                        simulatedScore += 2;
                    }
                }

                value--;
            }

            // Compare the simulated score to find the best move
            if (simulatedScore > bestScore) {
                bestScore = simulatedScore;
                bestCell = cell;
            }
        });

        return bestCell;
    }

    // Extreme: Advanced minimax with depth and opponent consideration
    function advancedMinimax(validCells, depth) {
        let bestCell = null;
        let bestScore = -Infinity;

        validCells.forEach(cell => {
            const originalValue = parseInt(cell.textContent);

            // Simulate the move and calculate the score
            const score = minimax(cell, depth, true);

            if (score > bestScore) {
                bestScore = score;
                bestCell = cell;
            }

            // Restore the original value of the cell
            cell.textContent = originalValue;
        });

        return bestCell;
    }

    // Minimax algorithm for extreme difficulty
    function minimax(cell, depth, isMaximizing) {
        if (depth === 0) {
            return evaluateBoard(); // Evaluate the board state
        }

        const originalValue = parseInt(cell.textContent);
        let value = originalValue;
        let currentIndex = getCellIndex(cell);

        while (value > 0) {
            currentIndex = (currentIndex + 1) % loopCoordinates.length;
            const [row, col] = loopCoordinates[currentIndex];
            const targetCell = getCellByCoordinates(row, col);

            targetCell.textContent = parseInt(targetCell.textContent) + 1;
            value--;
            cell.textContent--;
        }

        const validCells = [...cellsP2].filter(cell => parseInt(cell.textContent) > 0);
        let bestScore = isMaximizing ? -Infinity : Infinity;

        validCells.forEach(nextCell => {
            const score = minimax(nextCell, depth - 1, !isMaximizing);
            bestScore = isMaximizing
                ? Math.max(bestScore, score)
                : Math.min(bestScore, score);
        });

        // Restore the original value of the cell
        cell.textContent = originalValue;

        return bestScore;
    }

    // Evaluate the board state for minimax
    function evaluateBoard() {
        let cpuScore = 0;
        let playerScore = 0;

        [...cellsP2].forEach(cell => {
            cpuScore += parseInt(cell.textContent);
        });

        [...cellsP1].forEach(cell => {
            playerScore += parseInt(cell.textContent);
        });

        return cpuScore - playerScore; // Higher score is better for the CPU
    }

    function calculatestones(){
        let tots = 0;
        cellsP1.forEach(cell => {
            tots += parseInt(cell.textContent);
        });
        cellsP2.forEach(cell => {
            tots += parseInt(cell.textContent);
        });
        tots += parseInt(scoreP1.textContent) + parseInt(scoreP2.textContent);
        return tots;
    }

    // Animate the turn
    function handleCellClick(event) {
        const cell = event.target;
        const isPlayer1Row = [...cellsP1].includes(cell);
        const isPlayer2Row = [...cellsP2].includes(cell);

        // console.log(currentPlayer, thisPlayer, currentPlayer == thisPlayer, getCellIndex(cell));

        if (isOnline) {
            if (currentPlayer != thisPlayer) {
                showToast('Invalid move! Wait for your turn!', 'error');
                return;
            }
        }

        // Check if the clicked cell belongs to the current player's row
        if ((currentPlayer === 'P1' && !isPlayer1Row) || (currentPlayer === 'P2' && !isPlayer2Row)) {
            showToast('Invalid move! You cannot play on the other player\'s row.', 'error');
            return; // Prevent the move
        }

        let value = parseInt(cell.textContent);
        cell.textContent = 0;

        if (value === 0) {
            showToast('Invalid move! Cell has no value.', 'error');
            return; // Skip if the cell has no value
        }

        let currentIndex = getCellIndex(cell);

        updateCellAvailability(false);

        function animateMove() {
            if (value > 0) {
                currentIndex = (currentIndex + 1) % loopCoordinates.length;
                const [row, col] = loopCoordinates[currentIndex];
                const targetCell = getCellByCoordinates(row, col);

                // Increment the target cell's value
                targetCell.textContent = parseInt(targetCell.textContent) + 1;

                // Decrement the current cell's value
                value--;

                // Add animation class for visual feedback
                targetCell.classList.add('highlight');
                setTimeout(() => targetCell.classList.remove('highlight'), 300);

                checkAndTransferScore();

                // Continue the animation
                setTimeout(animateMove, 300);
            } else {
                // Set the original cell's value to 0
                // cell.textContent = 0;
                cell.classList.add('moved'); // Mark the cell as moved
                cell.classList.remove('unmoved');

                updateCellAvailability(true);

                // Check for score transfer
                checkAndTransferScore();

                const [lastRow] = loopCoordinates[currentIndex];
                const lastCell = getCellByCoordinates(lastRow, loopCoordinates[currentIndex][1]);

                // Check if the last cell is in the same row as the current player
                if ((currentPlayer === 'P1' && lastRow === 0 && lastCell.textContent > 1) || 
                    (currentPlayer === 'P2' && lastRow === 1 && lastCell.textContent > 1)) {
                    lastCell.click(); // Take another turn on the last cell
                } else {
                    // End turn and switch players
                    currentPlayer = currentPlayer === 'P1' ? 'P2' : 'P1';
                    updateTurnIndicator();
                    updateCellAvailability(true);
                    
                    // Check if a row is empty and handle it
                    checkAndHandleEmptyRow();

                    // If it's the CPU's turn, make a move
                    if (isCPU && currentPlayer === 'P2') {
                        setTimeout(cpuMove, 500); // Add a delay for the CPU's move
                    }

                    if (isOnline) {
                        // // console.warn("Finished moving!");

                        // // console.log(cellsP1);
                        // // console.log(cellsP2);

                        // After updating the game state
                        const gameState = {
                            cellsP1: [...cellsP1].map(cell => parseInt(cell.textContent) + (cell.classList.contains('moved') ? 100 : 0)),
                            cellsP2: [...cellsP2].map(cell => parseInt(cell.textContent) + (cell.classList.contains('moved') ? 100 : 0)),
                            scoreP1: parseInt(scoreP1.textContent),
                            scoreP2: parseInt(scoreP2.textContent),
                            currentPlayer
                        };

                        // // console.log(gameState);
                        sendGameState(gameState); // Send the updated state to the server
                    }
                }

                // // console.log(calculatestones());

            }
        }

        // Start the animation
        animateMove();
    }

    // Get cell index in the loop
    function getCellIndex(cell) {
        const row = cell.parentElement.rowIndex - 1;
        const col = cell.cellIndex - 1;
        return loopCoordinates.findIndex(([r, c]) => r === row && c === col);
    }

    // Get cell by coordinates
    function getCellByCoordinates(row, col) {
        return row === 0 ? cellsP1[col] : cellsP2[col];
    }

    // Check and transfer score
    function checkAndTransferScore() {
        [...cellsP1, ...cellsP2].forEach(cell => {
            if (cell.classList.contains('moved') && parseInt(cell.textContent) === 4) {
                const scoreElement = currentPlayer === 'P1' ? scoreP1 : scoreP2;

                // Add 4 to the current player's score
                scoreElement.textContent = parseInt(scoreElement.textContent) + 4;

                // Trigger the score animation
                scoreElement.classList.add('animate');
                setTimeout(() => scoreElement.classList.remove('animate'), 500); // Remove animation class after 0.5s

                // Show toast notification for scoring
                showToast(`${currentPlayer} scored 4 points!`, 'success');

                // Reset the cell value to 0
                cell.textContent = 0;
            }
        });
    }

    // Check if a row is empty and transfer remaining values to the other player's score
    function checkAndHandleEmptyRow() {
        const isRowP1Empty = [...cellsP1].every(cell => parseInt(cell.textContent) === 0);
        const isRowP2Empty = [...cellsP2].every(cell => parseInt(cell.textContent) === 0);

        if (isRowP1Empty) {
            // Transfer all remaining values in Player 2's row to Player 2's score
            let totalScore = 0;
            cellsP2.forEach(cell => {
                totalScore += parseInt(cell.textContent);
                cell.textContent = 0; // Clear the cell
            });
            scoreP2.textContent = parseInt(scoreP2.textContent) + totalScore;

            // End the game
            endGame();
        } else if (isRowP2Empty) {
            // Transfer all remaining values in Player 1's row to Player 1's score
            let totalScore = 0;
            cellsP1.forEach(cell => {
                totalScore += parseInt(cell.textContent);
                cell.textContent = 0; // Clear the cell
            });
            scoreP1.textContent = parseInt(scoreP1.textContent) + totalScore;

            // End the game
            endGame();
        }
    }

    // End the game and display the winner based on the higher score
    function endGame() {
        const scoreP1Value = parseInt(scoreP1.textContent);
        const scoreP2Value = parseInt(scoreP2.textContent);

        let winner;
        if (scoreP1Value > scoreP2Value) {
            winner = 'Player 1 (P1) wins!';
        } else if (scoreP2Value > scoreP1Value) {
            winner = 'Player 2 (P2) wins!';
        } else {
            winner = 'It\'s a tie!';
        }

        showToast(`${winner}`, 'info', 20000);
        updateCellAvailability(false);
        // resetGame(); // Reset the game after showing the winner
    }

    // Update turn indicator
    function updateTurnIndicator() {
        let thisP1 = thisPlayer == 'P1' ? ' (You)': '';
        let thisP2 = thisPlayer == 'P2' ? ' (You)': '';
        let cpu = isCPU ? ' (CPU)' : '';

        let turnn = `Current Turn: Player ${currentPlayer === 'P1' ? '1 (P1)' + thisP1 : '2 (P2)' + cpu + thisP2}`;

        if(isOnline){
            turnn += ` | Room ID: ${roomId}`;
        }
        turnIndicator.textContent = turnn;
        if (currentPlayer === 'P1') {
            rowP1.classList.add('current-player');
            rowP2.classList.remove('current-player');
        } else {
            rowP2.classList.add('current-player');
            rowP1.classList.remove('current-player');
        }
    }

    // Update cell availability
    function updateCellAvailability(mode) {
        if (mode) {
            cellsP1.forEach(cell => {
                if (parseInt(cell.textContent) > 0) {
                    cell.addEventListener('click', handleCellClick);
                }
            });
            cellsP2.forEach(cell => {
                if (parseInt(cell.textContent) > 0) {
                    cell.addEventListener('click', handleCellClick);
                }
            });
        } else {
            cellsP2.forEach(cell => cell.removeEventListener('click', handleCellClick));
            cellsP1.forEach(cell => cell.removeEventListener('click', handleCellClick));
        }
    }

    // Reset the game
    function resetGame() {
        // Show the game mode modal to ask for the mode again
        showGameModeModal();

        // Reset scores and cells
        currentPlayer = 'P1'; // Reset to Player 1
        scoreP1.textContent = 0; // Reset Player 1's score
        scoreP2.textContent = 0; // Reset Player 2's score
        initializeCells(); // Reset all cells
        updateTurnIndicator(); // Update the turn indicator
        updateCellAvailability(true); // Update cell availability

        if(roomId) socket.emit('playerLeave', roomId);

        showToast('Game has been reset! Please select a mode.', 'success');
    }

    // Function to show toast notifications
    function showToast(message, type = 'success', duration = 3500) {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = message;

        // Set custom properties for animation duration and delay
        const fadeOutDuration = 1000; // Fade-out duration in milliseconds (1 second)
        const delayBeforeFadeOut = duration - fadeOutDuration; // Delay before fade-out starts
        toast.style.setProperty('--toast-duration', `${fadeOutDuration / 1000}s`);
        toast.style.setProperty('--toast-delay', `${delayBeforeFadeOut / 1000}s`);

        // Create the close button
        const closeButton = document.createElement('button');
        closeButton.className = 'close-btn';
        closeButton.innerHTML = '&times;'; // Close icon
        closeButton.addEventListener('click', () => {
            toast.remove(); // Remove the toast when the button is clicked
        });

        // Append the close button to the toast
        toast.appendChild(closeButton);

        // Append the toast to the container
        toastContainer.appendChild(toast);

        // Automatically remove the toast after the specified duration
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, duration);
    }

    // Show rules when the rules button is clicked
    rulesButton.addEventListener('click', () => {
        const rulesMessage = `
            Rules of the Game:<br>
            1. Each cell starts with a value of 4.<br>
            2. Players can only play on their own row.<br>
            3. Clicking a cell distributes its value in a loop.<br>
            4. If the last cell is in the same row, the player gets another turn.<br>
            5. If the last cell is in the opponent's row, the turn ends.<br>
            6. If a cell with a value of 4 is moved, its value is added to the player's score.<br>
            7. The game ends when one row is empty, and the other player collects all remaining values.<br>
            8. The player with the higher score wins!
        `;
        showToast(rulesMessage, 'info', 15000); // Show the rules toast for 15 seconds
    });

    // Event listeners for game mode selection
    pvpModeButton.addEventListener('click', () => {
        isCPU = false; // Player vs Player mode
        isOnline = false;
        hideGameModeModal();
        updateTurnIndicator(); // Update the turn indicator
        updateCellAvailability(true); // Update cell availability
        // resetGame();
    });

    onlinePvpModeButton.addEventListener('click', () => {
        isOnline = true;
        roomId = prompt('Enter a room ID to join or create a new one:');
        if(!roomId) {
            alert("Invalid room ID.");
            showGameModeModal();
            return;
        }
        socket.emit('joinGame', roomId); // Join the room on the server
    });

    [p1select, p2select].forEach((button) => button.addEventListener('click', (e) => {
        thisPlayer = e.target.dataset.player;
        // console.log(`Selected: ${thisPlayer}`);
        socket.emit('select', { roomId , selection: thisPlayer });
        modeSelect.classList.remove('hidden');
        playerSelect.classList.add('hidden');
        showToast(`You are Player: ${thisPlayer}!`, 'info', 10000);
        hideGameModeModal();
    }));

    // 
    socket.on('playerSelected', (selection) => {
        if(!thisPlayer) {
            // thisPlayer = selection == 'P1' ? 'P2' : 'P1';
            // console.log(`Selection: ${selection}`);
            if (selection == 'P1') thisPlayer = 'P2';
            else thisPlayer = 'P1';
            modeSelect.classList.remove('hidden');
            playerSelect.classList.add('hidden');
            showToast(`You are Player: ${thisPlayer}!`, 'info', 10000);
            hideGameModeModal();
        }
        // console.log(thisPlayer);
        showToast('Game started! It\'s Player 1\'s turn.', 'success');
        updateCellAvailability(true);
        updateTurnIndicator();
    });

    cpuModeButton.addEventListener('click', () => {
        isCPU = true; // Player vs CPU mode
        isOnline = false;
        difficultySelection.classList.remove('hidden'); // Show difficulty options
    });

    difficultyButtons.forEach(button => {
        button.addEventListener('click', () => {
            cpuDifficulty = button.dataset.difficulty; // Set the selected difficulty
            hideGameModeModal();
            updateTurnIndicator(); // Update the turn indicator
            updateCellAvailability(true); // Update cell availability
            // resetGame();
        });
    });

    // Listen for game state updates from the server
    socket.on('updateGame', (gameState) => {
        updateGameBoard(gameState);
    });

    socket.on("playerLeft", () => {
        showToast("Competitor left! Wait until a new player has joined the room or reset the game.", 'error', 10000);
        updateCellAvailability(false);
    });

    // Listen for player joining
    socket.on('playerJoined', (players) => {
        if (players.length === 2) {
            // alert('Both players are connected. The game will start!');
            showToast("Both players are connected! The game will start!", 'info', 5000);
            thisPlayer = null;
            // socket.emit('selectplayer');
            // alert(`You are Player ${thisPlayer[1]}`);
            updateCellAvailability(true);
            updateTurnIndicator();
        } else {
            // alert('Waiting for another player to join...');
            showToast("Waiting for another player to join...", 'info', 5000);
            thisPlayer = null;
            updateCellAvailability(false);
            updateTurnIndicator();
            hideGameModeModal();
        }
    });

    // Listen for game start (when both players are connected)
    socket.on('startGame', ({ state }) => {
        // Initialize the game
        initializeCells();
        
        // Set the starting player
        currentPlayer = 'P1';
        
        // Update UI elements
        updateTurnIndicator();
        updateCellAvailability(true);
        
        // If there's an existing game state, apply it
        if (state) {
            updateGameBoard(state);
        }
        showGameModeModal();
        modeSelect.classList.add('hidden');
        playerSelect.classList.remove('hidden');
    });

    socket.on('roomFull', () => {
        alert("Room is already full!");
        // onlinePvpModeButton.click();
        isOnline = false;
        roomId = '';
        showGameModeModal();
    });

    // Send the game state to the server
    function sendGameState(gameState) {
        if (isOnline) {
            socket.emit('makeMove', { roomId, gameState });
        }
    }

    // Update the game board with the received state
    function updateGameBoard(gameState) {
        gameState.cellsP1.forEach((value, index) => {
            if (value > 99) {
                cellsP1[index].textContent = value - 100;
                cellsP1[index].classList.add('moved');
                cellsP1[index].classList.remove('unmoved');
            } else {
                cellsP1[index].textContent = value;
            }
        });
        gameState.cellsP2.forEach((value, index) => {
            if (value > 99) {
                cellsP2[index].textContent = value - 100;
                cellsP2[index].classList.add('moved');
                cellsP2[index].classList.remove('unmoved');
            } else {
                cellsP2[index].textContent = value;
            }
        });
        scoreP1.textContent = gameState.scoreP1;
        scoreP2.textContent = gameState.scoreP2;
        currentPlayer = gameState.currentPlayer;
        updateTurnIndicator();
        updateCellAvailability(true);
        checkAndHandleEmptyRow();
    }

    function roomIdGenerator(){
        
    }

    // Initialize the game
    showGameModeModal();

    // Dark mode toggle
    darkModeToggle.addEventListener('click', () => {
        body.classList.toggle('dark-mode');
    });

    // Reset button functionality
    resetButton.addEventListener('click', resetGame);

    resetGame();
});