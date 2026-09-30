// frontend/js/tictactoe.js
//
// A quick game of tic-tac-toe on the queue screen, so the wait passes
// faster. Two levels:
//
//   Hard — the opponent searches the whole game tree (minimax with
//          alpha-beta pruning) and never loses; the best a guest can do is
//          draw.
//   Easy — the same search, cut off one move ahead: it takes a win and
//          blocks an obvious threat, but can't see a fork coming, and picks
//          randomly between equally good moves so games vary.
//
// Search details: the computer (O) is MAX, the guest (X) is MIN. A finished
// game scores +10 / −10 / 0, adjusted by depth so it prefers quick wins and
// slow losses. Positions past the Easy cut-off score 0 ("don't know yet").
// minimax() is the unpruned reference search; alphaBeta() returns the same
// value while skipping branches that can't change the decision — the tests
// check both claims.
//
// Works in the browser (window.TicTacToe) and in Node (module.exports).

(function (root) {
    const AI = 'O';
    const HUMAN = 'X';
    const LINES = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    const LEVELS = { easy: 2, hard: Infinity }; // search depth per level

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

    function alphaBeta(board, depth, isMax, alpha, beta, stats, maxDepth = Infinity) {
        stats.nodes++;
        const u = utility(board, depth);
        if (u !== null) return u;
        if (depth >= maxDepth) return 0; // beyond the look-ahead: unknown

        if (isMax) {
            let best = -Infinity;
            for (const i of emptyCells(board)) {
                board[i] = AI;
                best = Math.max(best, alphaBeta(board, depth + 1, false, alpha, beta, stats, maxDepth));
                board[i] = null;
                alpha = Math.max(alpha, best);
                if (alpha >= beta) { stats.prunes++; break; } // MIN would never allow this line
            }
            return best;
        }

        let best = Infinity;
        for (const i of emptyCells(board)) {
            board[i] = HUMAN;
            best = Math.min(best, alphaBeta(board, depth + 1, true, alpha, beta, stats, maxDepth));
            board[i] = null;
            beta = Math.min(beta, best);
            if (alpha >= beta) { stats.prunes++; break; } // MAX would never allow this line
        }
        return best;
    }

    /**
     * Best move for the computer.
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

    /**
     * The move the game actually plays at a given level. Every candidate is
     * scored exactly (no pruning at the root) so that equally good moves can
     * be told apart and one picked at random.
     */
    function chooseMove(board, level = 'hard', rand = Math.random) {
        if (level === 'hard') return bestMove(board).move;
        const maxDepth = LEVELS[level] ?? LEVELS.hard;
        const work = [...board];
        const scored = emptyCells(work).map((i) => {
            work[i] = AI;
            const v = alphaBeta(work, 1, false, -Infinity, Infinity, { nodes: 0, prunes: 0 }, maxDepth);
            work[i] = null;
            return { i, v };
        });
        const top = Math.max(...scored.map((s) => s.v));
        const options = scored.filter((s) => s.v === top);
        return options[Math.floor(rand() * options.length)].i;
    }

    // ── Browser widget ───────────────────────────────────────────────
    function mount(container) {
        const doc = container.ownerDocument;
        let board = Array(9).fill(null);
        let over = false;
        const score = { you: 0, ai: 0, draw: 0 };

        container.innerHTML = `
            <div class="ttt">
                <div class="ttt-head">
                    <strong>Play while you wait</strong>
                    <div class="ttt-levels" role="group" aria-label="Difficulty">
                        <button type="button" data-level="easy" aria-pressed="true">Easy</button>
                        <button type="button" data-level="hard" aria-pressed="false">Hard</button>
                    </div>
                </div>
                <div class="ttt-board" data-ttt="board" role="grid" aria-label="Tic-tac-toe board"></div>
                <div class="ttt-status" data-ttt="status" aria-live="polite">You're X. Your move.</div>
                <div class="ttt-foot">
                    <span data-ttt="score"></span>
                    <button type="button" data-ttt="reset">New game</button>
                </div>
            </div>`;

        const boardEl = container.querySelector('[data-ttt="board"]');
        const statusEl = container.querySelector('[data-ttt="status"]');
        const scoreEl = container.querySelector('[data-ttt="score"]');
        const levelButtons = [...container.querySelectorAll('[data-level]')];
        let level = 'easy';

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
            scoreEl.textContent = `You ${score.you} · Q-Sense ${score.ai} · Draws ${score.draw}`;
        }

        function finish() {
            const w = winner(board);
            if (w) {
                over = true;
                if (w.player === HUMAN) { score.you++; statusEl.textContent = level === 'easy' ? 'You won! Try Hard mode.' : 'You won!'; }
                else { score.ai++; statusEl.textContent = 'Q-Sense wins this one.'; }
                render(w.line);
                return true;
            }
            if (emptyCells(board).length === 0) {
                over = true;
                score.draw++;
                statusEl.textContent = level === 'hard' ? "Draw — that's the best anyone can do on Hard." : 'Draw!';
                render();
                return true;
            }
            return false;
        }

        function play(i) {
            if (over || board[i]) return;
            board[i] = HUMAN;
            if (finish()) return;
            board[chooseMove(board, level)] = AI;
            if (!finish()) {
                statusEl.textContent = 'Your move.';
                render();
            }
        }

        function reset() {
            board = Array(9).fill(null);
            over = false;
            statusEl.textContent = "You're X. Your move.";
            render();
        }

        levelButtons.forEach((btn) => btn.addEventListener('click', () => {
            level = btn.dataset.level;
            levelButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
            reset();
        }));
        container.querySelector('[data-ttt="reset"]').addEventListener('click', reset);

        render();
    }

    const api = { AI, HUMAN, LEVELS, winner, emptyCells, utility, minimax, alphaBeta, bestMove, chooseMove, mount };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TicTacToe = api;
})(typeof window !== 'undefined' ? window : globalThis);
