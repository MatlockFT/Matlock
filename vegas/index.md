---
title: Vegas Slots
---
<center>
    <h2>MMA Knockout Slots!</h2>
    <p><font color="#FFFFFF">Spin for a TKO! Match fists, gloves, or cages to win!</font></p>
</center>

<div class="slot-machine">
    <div class="reels" id="reels">
        <div class="reel" id="reel1">👊</div>
        <div class="reel" id="reel2">🥊</div>
        <div class="reel" id="reel3">🏟️</div>
    </div>
    <button class="slot-button" id="spinButton">SPIN</button>
    <div id="result"></div>
</div>

<script>
    const symbols = ['👊', '🥊', '🏟️', '🥋', '🏆', '🩸', '💪'];
    const reels = document.querySelectorAll('.reel');
    const reelsContainer = document.getElementById('reels');
    const spinButton = document.getElementById('spinButton');
    const resultDisplay = document.getElementById('result');
    // const spinSound = new Audio('/assets/spin.mp3'); // Uncomment and upload spin.mp3 for sound
    function getRandomInt(max) {
        if (window.crypto && window.crypto.getRandomValues) {
            const array = new Uint32Array(1);
            window.crypto.getRandomValues(array);
            return array[0] % max;
        }
        return Math.floor(Math.random() * max);
    }
    function spinReels() {
        spinButton.disabled = true;
        resultDisplay.textContent = '';
        reelsContainer.classList.add('spinning');
        // spinSound.play(); // Uncomment to play sound
        let spinCount = 0;
        const maxSpins = 20;
        const spinInterval = setInterval(() => {
            reels.forEach(reel => {
                const randomIndex = getRandomInt(symbols.length);
                reel.textContent = symbols[randomIndex];
            });
            spinCount++;
            if (spinCount >= maxSpins) {
                clearInterval(spinInterval);
                endSpin();
            }
        }, 100);
    }
    function endSpin() {
        reelsContainer.classList.remove('spinning');
        const finalSymbols = Array.from(reels).map(reel => reel.textContent);
        const isWin = finalSymbols.every(symbol => symbol === finalSymbols[0]);
        resultDisplay.textContent = isWin ? '💥 TKO WIN!' : 'No Knockout... Spin Again!';
        spinButton.disabled = false;
    }
    spinButton.addEventListener('click', spinReels);
</script>
