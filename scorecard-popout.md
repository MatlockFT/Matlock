---
layout: null
title: MMA Judging Scorecard Popout
permalink: /scorecard-popout
---

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MMA Judging Scorecard Popout</title>
    <style>
        body { background: #121212; margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; color: #e0e0e0; }
        .scorecard-container { max-width: 600px; margin: 20px auto; padding: 20px; background: #121212; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
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
        .red.corner { background: #f44336; }
        .blue.corner { background: #2196f3; }
        .neutral { background: #9e9e9e; }
        .small { font-size: 14px; padding: 5px 10px; }
        .direct-score { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    </style>
</head>
<body>
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
    </div>
    <script>
        // [Same JS as before - omitted for brevity in this response, but copy from previous full code]
    </script>
</body>
</html>
