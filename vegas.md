---
layout: default
title: Vegas Slots
permalink: /vegas
---

<section class="slot-page-header intro-container">
    <h2>Vegas Slots!</h2>
    <p>Spin the reels. Feel the fight.</p>
</section>

<section class="slot-rules-panel intro-container">
    <div class="panel-title">Payout Board</div>
    <ul class="slot-rules-list">
        <li><strong>3 Dana Whites</strong> — 15x bet + jackpot mode energy</li>
        <li><strong>3 Chuck Liddells</strong> — 5x bet</li>
        <li><strong>3 BJ Penns</strong> — 3x bet</li>
        <li><strong>2 matching symbols</strong> — bet refunded</li>
        <li><strong>Wild symbol</strong> — substitutes for any fighter</li>
        <li><strong>Daily bonus</strong> — +50 cash once every 24 hours</li>
        <li><strong>Double or Nothing</strong> — gamble your latest win</li>
    </ul>
</section>

<div class="slot-machine-container">
    <div class="vegas-sign">SPIN KICK!</div>

    <div class="slot-status-bar">
        <div id="cash">Cash: 100</div>
        <div id="high-score">High Score: 0</div>
        <div id="jackpot-display">Progressive Jackpot: 0</div>
    </div>

    <div class="reels">
        <div class="reel" id="reel1"><img src="/assets/symbol1.png" alt="Dana White"></div>
        <div class="reel" id="reel2"><img src="/assets/symbol2.png" alt="Chuck Liddell"></div>
        <div class="reel" id="reel3"><img src="/assets/symbol3.png" alt="BJ Penn"></div>
    </div>

    <div class="slot-controls">
        <label for="bet-amount" class="control-label">Bet Amount</label>
        <select id="bet-amount">
            <option value="10">Bet 10 Cash</option>
            <option value="20">Bet 20 Cash</option>
            <option value="50">Bet 50 Cash</option>
        </select>

        <div class="slot-button-row">
            <button class="slot-button" id="spin-button">Spin</button>
            <button id="gamble-button" class="slot-button hidden">Double or Nothing?</button>
            <button id="auto-spin" class="slot-button">Auto-Spin (10)</button>
            <button id="sound-toggle" class="slot-button">Toggle Sound</button>
        </div>
    </div>

    <div id="result" class="slot-result"></div>
    <marquee id="jackpot-marquee" style="display: none;">YOU WIN BIG!</marquee>

    <audio id="spin-sound1">
        <source src="/assets/slotpull1.m4a" type="audio/mp4">
        <source src="/assets/slotpull1.mp3" type="audio/mpeg">
    </audio>
    <audio id="spin-sound2">
        <source src="/assets/slotpull2.m4a" type="audio/mp4">
        <source src="/assets/slotpull2.mp3" type="audio/mpeg">
    </audio>
    <audio id="reel-stop">
        <source src="/assets/reel_stop.mp3" type="audio/mpeg">
    </audio>
    <audio id="win-sound">
        <source src="/assets/win.m4a" type="audio/mp4">
        <source src="/assets/win.mp3" type="audio/mpeg">
    </audio>
    <audio id="jackpot-sound">
        <source src="/assets/jackpot.m4a" type="audio/mp4">
        <source src="/assets/jackpot.mp3" type="audio/mpeg">
    </audio>
    <audio id="upgrade-sound">
        <source src="/assets/upgrade.mp3" type="audio/mpeg">
    </audio>
    <audio id="bonus-sound">
        <source src="/assets/bonus.mp3" type="audio/mpeg">
    </audio>

    <div class="victory-pose" id="victory-pose"></div>
</div>

<div id="confetti"></div>

<script>
document.addEventListener('DOMContentLoaded', () => {
    const reelIds = ['reel1', 'reel2', 'reel3'];
    const reels = reelIds.map(id => document.getElementById(id));
    const spinButton = document.getElementById('spin-button');
    const betAmount = document.getElementById('bet-amount');
    const cashDisplay = document.getElementById('cash');
    const highScoreDisplay = document.getElementById('high-score');
    const resultDisplay = document.getElementById('result');
    const jackpotDisplay = document.getElementById('jackpot-display');
    const jackpotMarquee = document.getElementById('jackpot-marquee');
    const confettiContainer = document.getElementById('confetti');
    const gambleButton = document.getElementById('gamble-button');
    const autoSpinButton = document.getElementById('auto-spin');
    const victoryPose = document.getElementById('victory-pose');
    const slotMachine = document.querySelector('.slot-machine-container');

    const sounds = {
        spin1: document.getElementById('spin-sound1'),
        spin2: document.getElementById('spin-sound2'),
        reelStop: document.getElementById('reel-stop'),
        win: document.getElementById('win-sound'),
        jackpot: document.getElementById('jackpot-sound'),
        upgrade: document.getElementById('upgrade-sound'),
        bonus: document.getElementById('bonus-sound')
    };

    const soundToggle = document.getElementById('sound-toggle');

    const SYMBOLS = [
        { key: 'dana', src: '/assets/symbol1.png', alt: 'Dana White', multiplier: 15 },
        { key: 'chuck', src: '/assets/symbol2.png', alt: 'Chuck Liddell', multiplier: 5 },
        { key: 'bj', src: '/assets/symbol3.png', alt: 'BJ Penn', multiplier: 3 },
        { key: 'wild', src: '/assets/wild.png', alt: 'Wild', multiplier: 0 }
    ];

    let cash = parseInt(localStorage.getItem('slotsCash') || '100', 10);
    let highScore = parseInt(localStorage.getItem('slotsHighScore') || '0', 10);
    let progressiveJackpot = parseInt(localStorage.getItem('slotsJackpot') || '250', 10);
    let autoSpinCount = 0;
    let lastBonusTime = parseInt(localStorage.getItem('lastBonusTime') || '0', 10);
    let isMuted = localStorage.getItem('slotsMuted') === 'true';
    let currentWinnings = 0;
    let spinning = false;

    Object.values(sounds).forEach(sound => {
        sound.muted = isMuted;
    });
    soundToggle.textContent = isMuted ? 'Unmute Sound' : 'Toggle Sound';

    function saveState() {
        localStorage.setItem('slotsCash', String(cash));
        localStorage.setItem('slotsHighScore', String(highScore));
        localStorage.setItem('slotsJackpot', String(Math.round(progressiveJackpot)));
        localStorage.setItem('slotsMuted', String(isMuted));
    }

    function playSound(sound) {
        if (isMuted || !sound) return;
        sound.currentTime = 0;
        sound.play();
    }

    function updateCash() {
        cashDisplay.textContent = `Cash: ${cash}`;
    }

    function updateHighScore() {
        highScoreDisplay.textContent = `High Score: ${highScore}`;
    }

    function updateJackpot() {
        jackpotDisplay.textContent = `Progressive Jackpot: ${Math.round(progressiveJackpot)}`;
    }

    function setResult(message, type = '') {
        resultDisplay.className = 'slot-result';
        if (type) resultDisplay.classList.add(type);
        resultDisplay.textContent = message;
    }

    function getRandomSymbol(includeWild = true) {
        const pool = includeWild ? SYMBOLS : SYMBOLS.slice(0, 3);
        return pool[Math.floor(Math.random() * pool.length)];
    }

    async function spinReel(reel) {
        reel.classList.add('spinning');

        const spinCount = 16 + Math.floor(Math.random() * 5);
        let finalSymbol = getRandomSymbol(true);

        for (let i = 0; i < spinCount; i++) {
            const tempSymbol = getRandomSymbol(false);
            const img = reel.querySelector('img');
            img.src = tempSymbol.src;
            img.alt = tempSymbol.alt;
            await new Promise(resolve => setTimeout(resolve, 90));
        }

        const img = reel.querySelector('img');
        img.src = finalSymbol.src;
        img.alt = finalSymbol.alt;
        reel.dataset.symbol = finalSymbol.key;

        reel.classList.remove('spinning');
        playSound(sounds.reelStop);
        return finalSymbol.key;
    }

    function createConfetti() {
        confettiContainer.innerHTML = '';
        for (let i = 0; i < 50; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = `${Math.random() * 100}%`;
            confetti.style.top = `-${Math.random() * 10}%`;
            confetti.style.animationDuration = `${Math.random() * 2 + 1}s`;
            confetti.style.backgroundColor = ['#FF4040', '#FF00FF', '#A00000'][Math.floor(Math.random() * 3)];
            confettiContainer.appendChild(confetti);
        }
        setTimeout(() => {
            confettiContainer.innerHTML = '';
        }, 3000);
    }

    function showVictoryPose() {
        const poses = ['/assets/pose1.png', '/assets/pose2.png', '/assets/pose3.png'];
        victoryPose.innerHTML = `<img src="${poses[Math.floor(Math.random() * poses.length)]}" alt="Victory Pose">`;
        victoryPose.classList.add('visible');
        setTimeout(() => {
            victoryPose.classList.remove('visible');
        }, 4000);
    }

    function toggleSound() {
        isMuted = !isMuted;
        Object.values(sounds).forEach(sound => {
            sound.muted = isMuted;
        });
        soundToggle.textContent = isMuted ? 'Unmute Sound' : 'Toggle Sound';
        saveState();
    }

    function normalizeForMatch(symbols) {
        const nonWild = symbols.filter(s => s !== 'wild');
        if (nonWild.length === 0) return 'wild';
        const first = nonWild[0];
        return nonWild.every(s => s === first) ? first : null;
    }

    function countMatchingBaseSymbols(symbols) {
        const baseSymbols = ['dana', 'chuck', 'bj'];
        let best = 0;

        for (const base of baseSymbols) {
            const count = symbols.filter(s => s === base || s === 'wild').length;
            best = Math.max(best, count);
        }

        return best;
    }

    function getMultiplierForSymbol(symbolKey) {
        const symbol = SYMBOLS.find(s => s.key === symbolKey);
        return symbol ? symbol.multiplier : 0;
    }

    function resetSpinState() {
        jackpotMarquee.style.display = 'none';
        slotMachine.classList.remove('win', 'jackpot');
        reels.forEach(reel => reel.classList.remove('win'));
        gambleButton.classList.add('hidden');
        gambleButton.classList.remove('visible');
        gambleButton.disabled = true;
        currentWinnings = 0;
    }

    function gamble() {
        if (currentWinnings <= 0) return;

        if (Math.random() < 0.5) {
            cash += currentWinnings;
            setResult(`Gamble Won! +${currentWinnings} Cash!`, 'win');
        } else {
            cash -= currentWinnings;
            if (cash < 0) cash = 0;
            setResult('Gamble Lost! Better luck next time!', 'loss');
        }

        updateCash();
        saveState();

        gambleButton.classList.add('hidden');
        gambleButton.classList.remove('visible');
        gambleButton.disabled = true;
        currentWinnings = 0;
    }

    async function autoSpin() {
        if (autoSpinCount < 10 && cash > 0) {
            autoSpinCount++;
            autoSpinButton.textContent = `Auto-Spin (${10 - autoSpinCount})`;
            spinButton.click();
            await new Promise(resolve => setTimeout(resolve, 2200));
            if (autoSpinCount < 10 && cash > 0) {
                autoSpin();
            } else {
                autoSpinCount = 0;
                autoSpinButton.textContent = 'Auto-Spin (10)';
                autoSpinButton.disabled = false;
            }
        } else {
            autoSpinCount = 0;
            autoSpinButton.textContent = 'Auto-Spin (10)';
            autoSpinButton.disabled = false;
        }
    }

    spinButton.addEventListener('click', async () => {
        const bet = parseInt(betAmount.value, 10);

        if (spinning) return;

        if (cash < bet) {
            setResult('Not enough cash!', 'loss');
            return;
        }

        spinning = true;
        spinButton.classList.add('disabled');
        resetSpinState();
        setResult('');

        cash -= bet;
        progressiveJackpot += bet * 0.1;

        if (Date.now() - lastBonusTime > 24 * 60 * 60 * 1000) {
            cash += 50;
            lastBonusTime = Date.now();
            localStorage.setItem('lastBonusTime', String(lastBonusTime));
            playSound(sounds.bonus);
            setResult('Daily Bonus! +50 Cash!', 'win');
        }

        updateCash();
        updateJackpot();
        saveState();

        playSound(sounds.spin1);
        setTimeout(() => playSound(sounds.spin2), 400);

        const results = await Promise.all(reels.map(spinReel));
        const matchedSymbol = normalizeForMatch(results);
        const matchCount = countMatchingBaseSymbols(results);

        if (matchedSymbol && matchedSymbol !== 'wild') {
            const baseMultiplier = getMultiplierForSymbol(matchedSymbol);
            currentWinnings = bet * baseMultiplier;
            cash += currentWinnings;
            highScore = Math.max(highScore, currentWinnings);

            reels.forEach(reel => reel.classList.add('win'));
            slotMachine.classList.add(baseMultiplier === 15 ? 'jackpot' : 'win');

            if (baseMultiplier === 15) {
                jackpotMarquee.style.display = 'block';
                createConfetti();
                showVictoryPose();
                playSound(sounds.jackpot);
                setResult(`JACKPOT LINE HIT! +${currentWinnings} Cash!`, 'win');
            } else {
                playSound(sounds.win);
                setResult(`WIN! +${currentWinnings} Cash!`, 'win');
            }

            gambleButton.classList.remove('hidden');
            gambleButton.classList.add('visible');
            gambleButton.disabled = false;
        } else if (matchCount === 2) {
            cash += bet;
            playSound(sounds.upgrade);
            setResult(`Close enough. Bet refunded: +${bet} Cash.`, 'win');
        } else if (Math.random() < 0.01) {
            const jackpotWin = Math.round(progressiveJackpot);
            cash += jackpotWin;
            progressiveJackpot = 250;
            highScore = Math.max(highScore, jackpotWin);
            jackpotMarquee.style.display = 'block';
            slotMachine.classList.add('jackpot');
            createConfetti();
            showVictoryPose();
            playSound(sounds.jackpot);
            setResult(`PROGRESSIVE JACKPOT! +${jackpotWin} Cash!`, 'win');
        } else {
            setResult('Try again!', 'loss');
        }

        updateCash();
        updateHighScore();
        updateJackpot();
        saveState();

        spinButton.classList.remove('disabled');
        spinning = false;
    });

    gambleButton.addEventListener('click', gamble);

    autoSpinButton.addEventListener('click', () => {
        if (!autoSpinButton.disabled && cash > 0 && !spinning) {
            autoSpinButton.disabled = true;
            autoSpin();
        }
    });

    soundToggle.addEventListener('click', toggleSound);

    updateCash();
    updateHighScore();
    updateJackpot();
});
</script>
