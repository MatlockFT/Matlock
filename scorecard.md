---
layout: default
title: MMA Judging Scorecard
---
<div class="scorecard-container">
    <h2>MMA Judging Scorecard</h2>

    <div>
        <label for="red-fighter">Red Corner Fighter:</label>
        <input type="text" id="red-fighter" placeholder="Red Corner" value="Red Corner">
    </div>
    <div>
        <label for="blue-fighter">Blue Corner Fighter:</label>
        <input type="text" id="blue-fighter" placeholder="Blue Corner" value="Blue Corner">
    </div>

    <select id="round-select">
        <option value="1">Round 1</option>
        <option value="2">Round 2</option>
        <option value="3">Round 3</option>
        <option value="4">Round 4</option>
        <option value="5">Round 5</option>
    </select>

    <button onclick="startRound()">Start Round</button>

    <div class="timer" id="timer">5:00</div>

    <div id="scoring-area" class="hidden">
        <button onclick="scoreRed()" class="red corner">Left - Red</button>
        <button onclick="scoreBlue()" class="blue corner">Right - Blue</button>
    </div>

    <div class="score" id="red-score">Red Score: 0</div>
    <div class="score" id="blue-score">Blue Score: 0</div>
    <div id="round-winner"></div>
</div>

<script>
    let redScore = 0;
    let blueScore = 0;
    let timerInterval;
    let isScoringActive = false;

    function startRound() {
        redScore = 0;
        blueScore = 0;
        updateScores();
        document.getElementById('round-winner').textContent = '';
        document.getElementById('scoring-area').classList.remove('hidden');
        isScoringActive = true;
        let time = 300; // 5 minutes in seconds
        timerInterval = setInterval(() => {
            time--;
            let minutes = Math.floor(time / 60);
            let seconds = time % 60;
            document.getElementById('timer').textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
            if (time <= 0) {
                endRound();
            }
        }, 1000);
    }

    function endRound() {
        clearInterval(timerInterval);
        document.getElementById('scoring-area').classList.add('hidden');
        isScoringActive = false;
        let winner = '';
        if (redScore > blueScore) {
            winner = document.getElementById('red-fighter').value + ' wins the round!';
        } else if (blueScore > redScore) {
            winner = document.getElementById('blue-fighter').value + ' wins the round!';
        } else {
            winner = 'Round is a draw!';
        }
        document.getElementById('round-winner').textContent = winner;
    }

    function scoreRed() {
        redScore++;
        updateScores();
    }

    function scoreBlue() {
        blueScore++;
        updateScores();
    }

    function updateScores() {
        document.getElementById('red-score').textContent = `${document.getElementById('red-fighter').value} Score: ${redScore}`;
        document.getElementById('blue-score').textContent = `${document.getElementById('blue-fighter').value} Score: ${blueScore}`;
    }

    document.addEventListener('keydown', (e) => {
        if (isScoringActive) {
            if (e.key === 'ArrowLeft') {
                scoreRed();
            } else if (e.key === 'ArrowRight') {
                scoreBlue();
            }
        }
    });
</script>
