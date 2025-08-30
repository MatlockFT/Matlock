---
layout: default
title: MMA Judging Scorecard
permalink: /scorecard
---

<div id="scorecard-box" class="scorecard-container">
    <div class="content">
        <div class="fighter-hashtag">
            <div class="fighter-red">
                <label for="red-fighter">Red Corner Fighter:</label>
                <input type="text" id="red-fighter" placeholder="Red Corner" value="Red Corner">
            </div>
            <div class="event-hashtag">
                <label for="event-hashtag">Event Hashtag:</label>
                <input type="text" id="event-hashtag" placeholder="#UFC300" value="#UFC300">
            </div>
            <div class="fighter-blue">
                <label for="blue-fighter">Blue Corner Fighter:</label>
                <input type="text" id="blue-fighter" placeholder="Blue Corner" value="Blue Corner">
            </div>
        </div>
        <select id="round-select">
            <option value="1">Round 1</option>
            <option value="2">Round 2</option>
            <option value="3">Round 3</option>
            <option value="4">Round 4</option>
            <option value="5">Round 5</option>
        </select>
        <select id="duration-select" onchange="updateTimerFromDuration()">
            <option value="300">5 Minutes</option>
            <option value="180">3 Minutes</option>
        </select>
        <div class="buttons">
            <button id="start-button" onclick="startRound()">Start Round</button>
            <button id="pause-button" onclick="pauseResumeRound()" disabled>Pause</button>
            <button id="reset-button" onclick="resetRound()" disabled>Reset Round Timer</button>
            <button id="fight-over-button" onclick="fightOver()">Fight Over (Tally Final)</button>
            <button id="tally-button" onclick="tallyScores()">Tally Scores (Copy to Clipboard)</button>
        </div>
        <div class="timer" id="timer" aria-live="polite">5:00</div>
        <div class="progress-bar">
            <div class="progress" id="progress"></div>
        </div>
        <div class="scores">
            <div class="score" id="red-score" aria-live="polite">Red Score: 0</div>
            <div class="score" id="blue-score" aria-live="polite">Blue Score: 0</div>
        </div>
        <div id="round-winner" aria-live="assertive"></div>
        <div class="history" id="history" aria-live="polite"></div>
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
        updateHistoryDisplay();
        updateTimerFromDuration(); // Initial timer display from default duration
    });

    function updateHistoryDisplay() {
        document.getElementById('history').textContent = history.join('\n');
    }
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
            isScoringActive = true;
            document.getElementById('start-button').disabled = true;
            document.getElementById('pause-button').disabled = false;
            document.getElementById('reset-button').disabled = false;
            timerInterval = setInterval(() => {
                if (!isPaused) {
                    timeLeft--;
                    updateProgress();
                    updateTimerDisplay();
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
    function endRound() {
        clearInterval(timerInterval);
        isScoringActive = false;
        isPaused = false;
        document.getElementById('start-button').disabled = false;
        document.getElementById('pause-button').disabled = true;
        document.getElementById('pause-button').textContent = 'Pause';
        document.getElementById('reset-button').disabled = true;
        let scoreDiff = Math.abs(redScore - blueScore);
        let score = '';
        if (scoreDiff >= 30) {
            score = '10-7';
        } else if (scoreDiff >= 15) {
            score = '10-8';
        } else {
            score = '10-9';
        }
        let winner = '';
        if (redScore > blueScore) {
            winner = document.getElementById('red-fighter').value + ' wins the round ' + score;
        } else if (blueScore > redScore) {
            winner = document.getElementById('blue-fighter').value + ' wins the round ' + score;
        } else {
            winner = 'Round is a draw';
        }
        document.getElementById('round-winner').textContent = winner;
        const roundEntry = `Round ${document.getElementById('round-select').value}: ${winner}`;
        history.push(roundEntry);
        updateHistoryDisplay();
        saveHistory();
        // Auto-increment round
        const roundSelect = document.getElementById('round-select');
        const nextRound = parseInt(roundSelect.value) + 1;
        if (nextRound <= 5) {
            roundSelect.value = nextRound;
        }
    }
    function fightOver() {
        if (isScoringActive) {
            endRound(); // End current round if active
        }
        let redTotal = 0;
        let blueTotal = 0;
        history.forEach(entry => {
            if (entry.includes('10-9') && entry.includes(document.getElementById('red-fighter').value)) redTotal += 10, blueTotal += 9;
            else if (entry.includes('10-9') && entry.includes(document.getElementById('blue-fighter').value)) blueTotal += 10, redTotal += 9;
            else if (entry.includes('10-8') && entry.includes(document.getElementById('red-fighter').value)) redTotal += 10, blueTotal += 8;
            else if (entry.includes('10-8') && entry.includes(document.getElementById('blue-fighter').value)) blueTotal += 10, redTotal += 8;
            else if (entry.includes('10-7') && entry.includes(document.getElementById('red-fighter').value)) redTotal += 10, blueTotal += 7;
            else if (entry.includes('10-7') && entry.includes(document.getElementById('blue-fighter').value)) blueTotal += 10, redTotal += 7;
            else if (entry.includes('draw')) redTotal += 10, blueTotal += 10;
        });
        const finalEntry = `Final: ${document.getElementById('red-fighter').value} ${redTotal} - ${blueTotal} ${document.getElementById('blue-fighter').value}`;
        history.push(finalEntry);
        updateHistoryDisplay();
        saveHistory();
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
        updateHistoryDisplay();
    }
    function tallyScores() {
        let tallyText = `Fight: ${document.getElementById('red-fighter').value} vs ${document.getElementById('blue-fighter').value}\nEvent: ${document.getElementById('event-hashtag').value}\n`;
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
                endRound('Round is a draw');
            }
        }
    });
</script>
<style>
    #scorecard-box.scorecard-container { max-width: 800px; margin: 20px auto; padding: 20px; background-color: #121212 !important; background-image: none !important; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.5); color: #e0e0e0; font-family: 'Helvetica Neue', Arial, sans-serif; font-weight: bold; }
    #scorecard-box .content { display: flex; flex-direction: column; gap: 15px; }
    #scorecard-box .fighter-hashtag { display: flex; gap: 20px; justify-content: space-between; align-items: flex-end; }
    #scorecard-box .fighter-red, #scorecard-box .fighter-blue, #scorecard-box .event-hashtag { flex: 1; min-width: 150px; }
    #scorecard-box select, #scorecard-box input { width: 100%; padding: 8px; border: 1px solid #333; border-radius: 4px; background: #1e1e1e !important; color: #e0e0e0; font-family: 'Helvetica Neue', Arial, sans-serif; }
    #scorecard-box label { font-weight: bold; color: #e0e0e0; }
    #scorecard-box .buttons { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
    #scorecard-box button { padding: 10px 15px; background: #333 !important; color: #e0e0e0; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s; font-family: 'Helvetica Neue', Arial, sans-serif; font-weight: bold; }
    #scorecard-box button:hover { background: #444 !important; }
    #scorecard-box button.disabled { opacity: 0.5; cursor: not-allowed; }
    #scorecard-box .timer { font-size: 48px; text-align: center; color: #e0e0e0; }
    #scorecard-box .progress-bar { height: 8px; background: #333 !important; border-radius: 4px; overflow: hidden; }
    #scorecard-box .progress { height: 100%; background: linear-gradient(90deg, #4caf50, #2196f3) !important; transition: width 0.5s; }
    #scorecard-box .scoring-area { display: flex; gap: 20px; justify-content: center; }
    #scorecard-box .scores { display: flex; gap: 20px; justify-content: center; font-size: 18px; color: #e0e0e0; }
    #scorecard-box .round-winner { text-align: center; font-weight: bold; color: #e0e0e0; margin: 10px 0; }
    #scorecard-box .history { white-space: pre-line; background: #1e1e1e !important; padding: 10px; border-radius: 4px; max-height: 200px; overflow-y: auto; color: #e0e0e0; font-family: 'Helvetica Neue', Arial, sans-serif; }
    #scorecard-box .popout-button { margin-top: 20px; width: 100%; }
    #scorecard-box .red.corner { background: #f44336 !important; }
    #scorecard-box .blue.corner { background: #2196f3 !important; }
    #scorecard-box .neutral { background: #9e9e9e !important; }
    #scorecard-box .small { font-size: 14px; padding: 5px 10px; }
    #scorecard-box .direct-score { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
</style>
