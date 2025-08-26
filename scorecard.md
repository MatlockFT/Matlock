---
layout: default
title: MMA Judging Scorecard
---
<div class="scorecard-container">
    <div class="header">
        <h2>MMA Judging Scorecard</h2>
    </div>
    <div class="content">
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

        <div>
            <button id="start-button" onclick="startRound()">Start Round</button>
            <button id="pause-button" onclick="pauseResumeRound()" disabled>Pause</button>
        </div>

        <div class="timer" id="timer">5:00</div>

        <div id="scoring-area" class="hidden">
            <button onclick="scoreRed()" class="red corner">Left - Red</button>
            <button onclick="scoreBlue()" class="blue corner">Right - Blue</button>
        </div>

        <div class="score" id="red-score">Red Score: 0</div>
        <div class="score" id="blue-score">Blue Score: 0</div>
        <div id="round-winner"></div>
    </div>
    <div class="footer">
        <p>Judging powered by Matlock Fight Talk</p>
    </div>
</div>

<script>
    let redScore = 0;
    let blueScore = 0;
    let timerInterval;
    let isScoringActive = false;
    let timeLeft = 300; // 5 minutes in seconds
    let isPaused = false;

    function startRound() {
        if (!isScoringActive) {
            redScore = 0;
            blueScore = 0;
            timeLeft = 300;
            updateScores();
            document.getElementById('round-winner').textContent = '';
            document.getElementById('scoring-area').classList.remove('hidden');
            isScoringActive = true;
            document.getElementById('start-button').disabled = true;
            document.getElementById('pause-button').disabled = false;
            timerInterval = setInterval(() => {
                if (!isPaused) {
                    timeLeft--;
                    let minutes = Math.floor(timeLeft / 60);
                    let seconds = timeLeft % 60;
                    document.getElementById('timer').textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                    if (timeLeft <= 0) {
                        endRound();
                    }
                }
            }, 1000);
        }
    }

    function pauseResumeRound() {
        isPaused = !isPaused;
        document.getElementById('pause-button').textContent = isPaused ? 'Resume' : 'Pause';
        if (isPaused) {
            clearInterval(timerInterval);
        } else if (isScoringActive) {
            timerInterval = setInterval(() => {
                timeLeft--;
                let minutes = Math.floor(timeLeft / 60);
                let seconds = timeLeft % 60;
                document.getElementById('timer').textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                if (timeLeft <= 0) {
                    endRound();
                }
            }, 1000);
        }
    }

    function endRound() {
        clearInterval(timerInterval);
        document.getElementById('scoring-area').classList.add('hidden');
        isScoringActive = false;
        isPaused = false;
        document.getElementById('start-button').disabled = false;
        document.getElementById('pause-button').disabled = true;
        document.getElementById('pause-button').textContent = 'Pause';
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
        if (isScoringActive && !isPaused) {
            if (e.key === 'ArrowLeft') {
                scoreRed();
            } else if (e.key === 'ArrowRight') {
                scoreBlue();
            }
        }
    });
</script>
