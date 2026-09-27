// frontend/js/tictactoe.js
//
// Tic-Tac-Toe vs. an AI, for the "waiting in queue" screen.
//
// Adversarial search: the AI (O) is MAX, the guest (X) is MIN. Terminal
// utility is +10 for an AI win, −10 for a guest win, 0 for a draw, with
// depth subtracted/added so the AI prefers faster wins and slower losses.
//
//   minimax()   — plain exhaustive minimax.
//   alphaBeta() — the same search with alpha-beta pruning: branches that
//                 provably can't change the decision are skipped. It always
//                 picks a move with the SAME value as minimax, but visits far
//                 fewer nodes — both counts are shown in the UI.
//
// Works in the browser (window.TicTacToe) and in Node (module.exports) so
// the search itself is unit-tested.

(function (root) {
    const AI = 'O';
    const HUMAN = 'X';
    const LINES = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    function winner(board) {
        for (const [a, b, c] of LINES) {
            if (board[a] && board[a] === board[b] && board[a] === board[c]) return { player: board[a], line: [a, b, c] };
        }
        return null;
    }

    const emptyCells = (board) => board.reduce((acc, v, i) => (v ? acc : acc.concat(i)), []);

    function utility(board, depth) {
        const w = winner(board);
        if (w) return w.player === AI ? 10 - depth : depth - 10;
        if (emptyCells(board).length === 0) return 0;
        return null; // not terminal
    }

    function minimax(board, depth, isMax, stats) {
        stats.nodes++;
        const u = utility(board, depth);
        if (u !== null) return u;

        let best = isMax ? -Infinity : Infinity;
        for (const i of emptyCells(board)) {
            board[i] = isMax ? AI : HUMAN;
            const v = minimax(board, depth + 1, !isMax, stats);
            board[i] = null;
            best = isMax ? Math.max(best, v) : Math.min(best, v);
        }
        return best;
    }

    function alphaBeta(board, depth, isMax, alpha, beta, stats) {
        stats.nodes++;
        const u = utility(board, depth);
        if (u !== null) return u;

        if (isMax) {
            let best = -Infinity;
            for (const i of emptyCells(board)) {
                board[i] = AI;
                best = Math.max(best, alphaBeta(board, depth + 1, false, alpha, beta, stats));
                board[i] = null;
                alpha = Math.max(alpha, best);
                if (alpha >= beta) { stats.prunes++; break; } // β-cutoff: MIN will never allow this
            }
            return best;
        }

        let best = Infinity;
        for (const i of emptyCells(board)) {
            board[i] = HUMAN;
            best = Math.min(best, alphaBeta(board, depth + 1, true, alpha, beta, stats));
            board[i] = null;
            beta = Math.min(beta, best);
            if (alpha >= beta) { stats.prunes++; break; } // α-cutoff: MAX will never allow this
        }
        return best;
    }

    /**
     * Picks the AI's move.
     * @param {Array<'X'|'O'|null>} board 9 cells
     * @param {'minimax'|'alphabeta'} algorithm
     * @returns {{ move, value, nodes, prunes }}
     */
    function bestMove(board, algorithm = 'alphabeta') {
        const work = [...board];
        const stats = { nodes: 0, prunes: 0 };
        let move = null;
        let value = -Infinity;

        for (const i of emptyCells(work)) {
            work[i] = AI;
            const v = algorithm === 'minimax'
                ? minimax(work, 1, false, stats)
                : alphaBeta(work, 1, false, value, Infinity, stats);
            work[i] = null;
            if (v > value) { value = v; move = i; }
        }
        return { move, value, nodes: stats.nodes, prunes: stats.prunes };
    }

    // ── Browser widget ───────────────────────────────────────────────
    // mount(container) renders a self-contained game into `container`.
    function mount(container) {
        const doc = container.ownerDocument;
        let board = Array(9).fill(null);
        let over = false;
        let score = { you: 0, ai: 0, draw: 0 };

        container.innerHTML = `
            <div class="ttt">
                <div class="ttt-head">
                    <strong>Pass the wait: beat the AI</strong>
                    <label class="ttt-algo">AI search:
                        <select data-ttt="algo">
                            <option value="alphabeta" selected>Alpha-beta</option>
                            <option value="minimax">Minimax</option>
                        </select>
                    </label>
                </div>
                <div class="ttt-board" data-ttt="board" role="grid" aria-label="Tic-tac-toe board"></div>
                <div class="ttt-status" data-ttt="status" aria-live="polite">You are X. Your move.</div>
                <div class="ttt-stats" data-ttt="stats"></div>
                <div class="ttt-foot">
                    <span data-ttt="score"></span>
                    <button type="button" data-ttt="reset">New game</button>
                </div>
            </div>`;

        const boardEl = container.querySelector('[data-ttt="board"]');
        const statusEl = container.querySelector('[data-ttt="status"]');
        const statsEl = container.querySelector('[data-ttt="stats"]');
        const scoreEl = container.querySelector('[data-ttt="score"]');
        const algoEl = container.querySelector('[data-ttt="algo"]');

        const cells = Array.from({ length: 9 }, (_, i) => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'ttt-cell';
            b.setAttribute('aria-label', `Cell ${i + 1}`);
            b.addEventListener('click', () => play(i));
            boardEl.appendChild(b);
            return b;
        });

        function render(winLine) {
            cells.forEach((c, i) => {
                c.textContent = board[i] || '';
                c.disabled = over || Boolean(board[i]);
                c.classList.toggle('ttt-win', Boolean(winLine && winLine.includes(i)));
            });
            scoreEl.textContent = `You ${score.you} · AI ${score.ai} · Draws ${score.draw}`;
        }

        function finish() {
            const w = winner(board);
            if (w) {
                over = true;
                if (w.player === HUMAN) { score.you++; statusEl.textContent = 'You won! (That should be impossible…)'; }
                else { score.ai++; statusEl.textContent = 'The AI wins this round.'; }
                render(w.line);
                return true;
            }
            if (emptyCells(board).length === 0) {
                over = true;
                score.draw++;
                statusEl.textContent = 'Draw — perfect play on both sides.';
                render();
                return true;
            }
            return false;
        }

        function play(i) {
            if (over || board[i]) return;
            board[i] = HUMAN;
            if (finish()) return;

            const algorithm = algoEl.value;
            const t0 = (root.performance || Date).now();
            const result = bestMove(board, algorithm);
            const ms = ((root.performance || Date).now() - t0).toFixed(1);
            board[result.move] = AI;

            // Run the other algorithm on the same position purely to show
            // the node-count difference — it picks an equally good move.
            const other = bestMove(board.map((v, k) => (k === result.move ? null : v)), algorithm === 'minimax' ? 'alphabeta' : 'minimax');
            const mm = algorithm === 'minimax' ? result : other;
            const ab = algorithm === 'minimax' ? other : result;
            statsEl.textContent = `AI searched ${result.nodes.toLocaleString()} positions in ${ms} ms · ` +
                `minimax ${mm.nodes.toLocaleString()} vs alpha-beta ${ab.nodes.toLocaleString()} ` +
                `(${Math.round((1 - ab.nodes / mm.nodes) * 100)}% pruned)`;

            if (!finish()) {
                statusEl.textContent = 'Your move.';
                render();
            }
        }

        container.querySelector('[data-ttt="reset"]').addEventListener('click', () => {
            board = Array(9).fill(null);
            over = false;
            statsEl.textContent = '';
            statusEl.textContent = 'You are X. Your move.';
            render();
        });

        render();
    }

    const api = { AI, HUMAN, winner, emptyCells, utility, minimax, alphaBeta, bestMove, mount };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TicTacToe = api;
})(typeof window !== 'undefined' ? window : globalThis);
