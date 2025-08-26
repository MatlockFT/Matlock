---
layout: default
title: MMA Judging Scorecard
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
            <button id="undo-button" onclick="undoScore()" disabled>Undo Last Score</button>
        </div>

        <div class="timer" id="timer">5:00</div>
        <div class="progress-bar">
            <div class="progress" id="progress"></div>
        </div>

        <div id="scoring-area" class="hidden">
            <button onclick="scoreRed()" class="red corner">Left - Red</button>
            <button onclick="scoreBlue()" class="blue corner">Right - Blue</button>
        </div>

        <div class="scores">
            <div class="score" id="red-score">Red Score: 0</div>
            <div class="score" id="blue-score">Blue Score: 0</div>
        </div>
        <div id="round-winner"></div>
        <div class="history" id="history"></div>
    </div>
</div>

<button onclick="popOutScorecard()">Pop Out Scorecard</button>

<script>
    let redScore = 0;
    let blueScore = 0;
    let timerInterval;
    let isScoringActive = false;
    let timeLeft = 300; // 5 minutes in seconds
    let isPaused = false;
    let history = [];
    let lastScore = null;

    function startRound() {
        if (!isScoringActive) {
            redScore = 0;
            blueScore = 0;
            timeLeft = 300;
            lastScore = null;
            updateScores();
            updateProgress();
            document.getElementById('round-winner').textContent = '';
            document.getElementById('scoring-area').classList.remove('hidden');
            isScoringActive = true;
            document.getElementById('start-button').disabled = true;
            document.getElementById('pause-button').disabled = false;
            document.getElementById('reset-button').disabled = false;
            document.getElementById('undo-button').disabled = false;
            document.getElementById('round-select').disabled = true;
            timerInterval = setInterval(() => {
                if (!isPaused) {
                    timeLeft--;
                    updateProgress();
                    let minutes = Math.floor(timeLeft / 60);
                    let seconds = time
