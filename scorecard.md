---
layout: default
title: MMA Judging Scorecard
permalink: /scorecard
---

<div class="scorecard-container">
    <div class="content">
        <div class="fighter-inputs">
            <div class="fighter-red">
                <label for="red-fighter">Red Corner Fighter:</label>
                <input type="text" id="red-fighter" placeholder="Red Corner" value="Red Corner">
            </div>
            <div class="fighter-blue">
                <label for="blue-fighter">Blue Corner Fighter:</label>
                <input type="text" id="blue-fighter" placeholder="Blue Corner" value="Blue Corner">
            </div>
        </div>
        <select id="duration-select" onchange="updateTimerFromDuration()">
            <option value="300">5 Minutes</option>
            <option value="180">3 Minutes</option>
        </select>
        <select id="round-select">
            <option value="1">Round 1</option>
            <option value="2">Round 2</option>
            <option value="3">Round 3</option>
            <option value="4">Round 4</option>
            <option value="5">Round 5</option>
        </select>
        <div class="buttons">
            <button id="start-button" onclick="startRound()">Start Round</button>
            <button id="pause-button" onclick="pauseResumeRound()" disabled>Pause</button>
            <button id="reset-button" onclick="resetRound()" disabled>Reset Round</button>
            <button id="undo-button" onclick="undoScore()" disabled>Undo Last</button>
            <button id="end-button" onclick="endRound()" disabled>End Round Early</button>
            <button id="clear-history" onclick="clearHistory()">Clear History</button>
        </div>
        <div class="timer" id="timer" aria-live="polite">5:00</div>
        <div class="progress-bar">
            <div class="progress" id="progress"></div>
        </div>
        <div id="scoring-area" class="hidden">
            <button onclick="scoreRed()" class="red corner" aria-label="Score for Red (Left Arrow)">Left - Red</button>
            <button onclick="scoreBlue()" class="blue corner" aria-label="Score for Blue (Right Arrow)">Right - Blue</button>
        </div>
        <div class="direct-score">
            <button onclick="lockScore('10-9 Red')" class="red corner small" disabled>10-9 Red</button>
            <button onclick="lockScore('10-8 Red')" class="red corner small" disabled>10-8 Red</button>
            <button onclick="lockScore('Draw')" class="neutral small" disabled>Draw</button>
            <button onclick="lockScore('10-8 Blue')" class="blue corner small" disabled>10-8 Blue</button>
            <button onclick="lockScore('10-9 Blue')" class="blue corner small" disabled>10-9 Blue</button>
        </div>
        <div class="scores">
            <div class="score" id="red-score" aria-live="polite">Red Score: 0</div>
            <div class="score" id="blue-score" aria-live="polite">Blue Score: 0</div>
        </div>
        <div id="round-winner" aria-live="assertive"></div>
        <div class="history" id="history" aria-live="polite"></div>
        <button id="tally-button" onclick="tallyScores()">Tally Scores (Copy to Clipboard)</button>
    </div>
    <button class="popout-button" onclick="popOutScorecard()">Pop Out Scorecard</button>
</div>
<script>
    let redScore = 0;
    let blueScore = 0;
    let timerInterval;
    let isScoringActive = false;
    let timeLeft = 300; // Default to 5 minutes in seconds
    let maxTime = 300; // Track the max for progress calculation
    let isPaused = false;
    let history = [];
    let lastScore = null;
    const STORAGE_KEY = 'mma_scorecard_history';

    document.addEventListener('DOMContentLoaded', () => {
        history = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        document.getElementById('history').textContent = history.join('\n');
        updateTimerFromDuration(); // Initial timer display from default duration
    });

    function updateTimerFromDuration() {
        if (!isScoringActive) {
            maxTime = parseInt(document.getElementById('duration-select').value);
            timeLeft = maxTime;
            updateTimerDisplay();
        }
    }
    function startRound() {
        if (!isScoringActive) {
            redScore = 0;
            blueScore = 0;
            maxTime = parseInt(document.getElementById('duration-select').value);
            timeLeft = maxTime;
            lastScore = null;
            updateScores();
            updateProgress();
            updateTimerDisplay();
            document.getElementById('round-winner').textContent = '';
            document.getElementById('scoring-area').classList.remove('hidden');
            enableDirectScoreButtons(true);
            isScoringActive = true;
            document.getElementById('start-button').disabled = true;
            document.getElementById('pause-button').disabled = false;
            document.getElementById('reset-button').disabled = false;
            document.getElementById('undo-button').disabled = false;
            document.getElementById('end-button').disabled = false;
            timerInterval = setInterval(() => {
                if (!isPaused) {
                    timeLeft--;
                    updateProgress();
                    updateTimerDisplay();
                    if (timeLeft <= 30) flashTimer();
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
                if (!isPaused) {
                    timeLeft--;
                    updateProgress();
                    updateTimerDisplay();
                    if (timeLeft <= 30) flashTimer();
                    if (timeLeft <= 0) {
                        endRound();
                    }
                }
            }, 1000);
        }
    }
    function resetRound() {
        if (isScoringActive) {
            redScore = 0;
            blueScore = 0;
            timeLeft = maxTime;
            lastScore = null;
            updateScores();
            updateProgress();
            updateTimerDisplay();
            document.getElementById('round-winner').textContent = '';
        }
    }
    function undoScore() {
        if (lastScore === 'red' && redScore > 0) {
            redScore--;
        } else if (lastScore === 'blue' && blueScore > 0) {
            blueScore--;
        }
        lastScore = null;
        updateScores();
        document.getElementById('undo-button').disabled = (redScore + blueScore === 0);
    }
    function lockScore(scoreType) {
        if (isScoringActive && !isPaused) {
            let forcedWinner = '';
            switch (scoreType) {
                case '10-9 Red':
                    forcedWinner = document.getElementById('red-fighter').value + ' wins the round 10-9';
                    break;
                case '10-8 Red':
                    forcedWinner = document.getElementById('red-fighter').value + ' wins the round 10-8';
                    break;
                case 'Draw':
                    forcedWinner = 'Round is a draw';
                    break;
                case '10-8 Blue':
                    forcedWinner = document.getElementById('blue-fighter').value + ' wins the round 10-8';
                    break;
                case '10-9 Blue':
                    forcedWinner = document.getElementById('blue-fighter').value + ' wins the round 10-9';
                    break;
            }
            endRound(forcedWinner); // Pass forced winner to override
        }
    }
    function endRound(forcedWinner = null) {
        clearInterval(timerInterval);
        document.getElementById('scoring-area').classList.add('hidden');
        enableDirectScoreButtons(false);
        isScoringActive = false;
        isPaused = false;
        document.getElementById('start-button').disabled = false;
        document.getElementById('pause-button').disabled = true;
        document.getElementById('pause-button').textContent = 'Pause';
        document.getElementById('reset-button').disabled = true;
        document.getElementById('undo-button').disabled = true;
        document.getElementById('end-button').disabled = true;
        let winner = forcedWinner;
        if (!winner) {
            let scoreDiff = Math.abs(redScore - blueScore);
            let score = '';
            if (scoreDiff >= 30) {
                score = '10-7';
            } else if (scoreDiff >= 15) {
                score = '10-8';
            } else {
                score = '10-9';
            }
            if (redScore > blueScore) {
                winner = document.getElementById('red-fighter').value + ' wins the round ' + score;
            } else if (blueScore > redScore) {
                winner = document.getElementById('blue-fighter').value + ' wins the round ' + score;
            } else {
                winner = 'Round is a draw';
            }
        }
        const roundEntry = `Round ${document.getElementById('round-select').value}: ${winner}`;
        history.push(roundEntry);
        document.getElementById('round-winner').textContent = winner;
        document.getElementById('history').textContent = history.join('\n');
        saveHistory();
        // Auto-increment round
        const roundSelect = document.getElementById('round-select');
        const nextRound = parseInt(roundSelect.value) + 1;
        if (nextRound <= 5) {
            roundSelect.value = nextRound;
        }
    }
    function scoreRed() {
        if (isScoringActive && !isPaused) {
            redScore++;
            lastScore = 'red';
            updateScores();
            flashButton('red');
            document.getElementById('undo-button').disabled = false;
        }
    }
    function scoreBlue() {
        if (isScoringActive && !isPaused) {
            blueScore++;
            lastScore = 'blue';
            updateScores();
            flashButton('blue');
            document.getElementById('undo-button').disabled = false;
        }
    }
    function updateScores() {
        document.getElementById('red-score').textContent = `${document.getElementById('red-fighter').value} Score: ${redScore}`;
        document.getElementById('blue-score').textContent = `${document.getElementById('blue-fighter').value} Score: ${blueScore}`;
    }
    function updateProgress() {
        const progress = document.getElementById('progress');
        const percentage = (timeLeft / maxTime) * 100;
        progress.style.width = `${percentage}%`;
    }
    function updateTimerDisplay() {
        let minutes = Math.floor(timeLeft / 60);
        let seconds = timeLeft % 60;
        document.getElementById('timer').textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }
    function flashButton(color) {
        const button = document.querySelector(`.corner.${color}`);
        if (button) {
            button.style.backgroundColor = '#FF0000';
            setTimeout(() => button.style.backgroundColor = '', 200);
        }
    }
    function flashTimer() {
        const timer = document.getElementById('timer');
        timer.style.color = '#FFFFFF';
        setTimeout(() => timer.style.color = '#FF4040', 500);
    }
    function enableDirectScoreButtons(enable) {
        document.querySelectorAll('.direct-score button').forEach(btn => btn.disabled = !enable);
    }
    function saveHistory() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
    function clearHistory() {
        history = [];
        localStorage.removeItem(STORAGE_KEY);
        document.getElementById('history').textContent = '';
    }
    function tallyScores() {
        let tallyText = `Fight: ${document.getElementById('red-fighter').value} vs ${document.getElementById('blue-fighter').value}\n`;
        tallyText += history.join('\n');
        navigator.clipboard.writeText(tallyText).then(() => alert('Tally copied to clipboard!')).catch(err => console.error('Clipboard error', err));
    }
    function popOutScorecard() {
        const url = window.location.origin + '/scorecard-popout';
        window.open(url, 'MMA Scorecard', 'width=600,height=800,toolbar=no,menubar=no,scrollbars=yes,resizable=yes');
    }
    document.addEventListener('keydown', (e) => {
        if (isScoringActive && !isPaused) {
            if (e.key === 'ArrowLeft') {
                scoreRed();
            } else if (e.key === 'ArrowRight') {
                scoreBlue();
            } else if (e.key === 'd') {
                lockScore('Draw');
            }
        }
    });
</script>
<style>
    .scorecard-container { max-width: 800px; margin: 20px auto; padding: 20px; background: #121212; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.5); color: #e0e0e0; font-family: 'Helvetica Neue', Arial, sans-serif; font-weight: bold; }
    .content { display: flex; flex-direction: column; gap: 15px; }
    .fighter-inputs { display: flex; gap: 20px; justify-content: space-between; }
    .fighter-red, .fighter-blue { flex: 1; }
    select, input { width: 100%; padding: 8px; border: 1px solid #333; border-radius: 4px; background: #1e1e1e; color: #e0e0e0; font-family: 'Helvetica Neue', Arial, sans-serif; }
    label { font-weight: bold; color: #e0e0e0; }
    .buttons { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
    button { padding: 10px 15px; background: #333; color: #e0e0e0; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s; font-family: 'Helvetica Neue', Arial, sans-serif; font-weight: bold; }
    button:hover { background: #444; }
    button.disabled { opacity: 0.5; cursor: not-allowed; }
    .timer { font-size: 48px; text-align: center; color: #e0e0e0; }
    .progress-bar { height: 8px; background: #333; border-radius: 4px; overflow: hidden; }
    .progress { height: 100%; background: linear-gradient(90deg, #4caf50, #2196f3); transition: width 0.5s; }
    .scoring-area { display: flex; gap: 20px; justify-content: center; }
    .scores { display: flex; gap: 20px; justify-content: center; font-size: 18px; color: #e0e0e0; }
    .round-winner { text-align: center; font-weight: bold; color: #e0e0e0; margin: 10px 0; }
    .history { white-space: pre-line; background: #1e1e1e; padding: 10px; border-radius: 4px; max-height: 200px; overflow-y: auto; color: #e0e0e0; font-family: 'Helvetica Neue', Arial, sans-serif; }
    .popout-button { margin-top: 20px; width: 100%; }
    .red.corner { background: #f44336; }
    .blue.corner { background: #2196f3; }
    .neutral { background: #9e9e9e; }
    .small { font-size: 14px; padding: 5px 10px; }
    .direct-score { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
</style>
