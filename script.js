let currentRound = 1;
let totalRounds = 0;

document.getElementById('lock-in-btn').addEventListener('click', function() {
  const fighter1Name = document.getElementById('fighter1-name').value;
  const fighter2Name = document.getElementById('fighter2-name').value;
  totalRounds = parseInt(document.getElementById('rounds-selection').value);

  document.getElementById('fighter1-display').innerText = fighter1Name;
  document.getElementById('fighter2-display').innerText = fighter2Name;

  document.getElementById('fighter1-name').disabled = true;
  document.getElementById('fighter2-name').disabled = true;
  document.getElementById('rounds-selection').disabled = true;
  document.getElementById('lock-in-btn').disabled = true;

  document.getElementById('scorecard').style.display = 'block';
  document.getElementById('next-round-btn').style.display = 'block';

  setupRounds();
});

function setupRounds() {
  for (let i = 1; i <= totalRounds; i++) {
    const f1RoundInput = document.createElement('input');
    f1RoundInput.type = 'number';
    f1RoundInput.className = 'round-input';
    f1RoundInput.id = `f1r${i}`;
    f1RoundInput.min = 0;
    f1RoundInput.max = 10;
    f1RoundInput.style.display = 'none';
    document.getElementById('fighter1-rounds').appendChild(f1RoundInput);

    const f2RoundInput = document.createElement('input');
    f2RoundInput.type = 'number';
    f2RoundInput.className = 'round-input';
    f2RoundInput.id = `f2r${i}`;
    f2RoundInput.min = 0;
    f2RoundInput.max = 10;
    f2RoundInput.style.display = 'none';
    document.getElementById('fighter2-rounds').appendChild(f2RoundInput);
  }

  document.getElementById(`f1r${currentRound}`).style.display = 'block';
  document.getElementById(`f2r${currentRound}`).style.display = 'block';
}

document.getElementById('next-round-btn').addEventListener('click', function() {
  const f1RoundScore = parseInt(document.getElementById(`f1r${currentRound}`).value) || 0;
  const f2RoundScore = parseInt(document.getElementById(`f2r${currentRound}`).value) || 0;

  document.getElementById(`f1r${currentRound}`).disabled = true;
  document.getElementById(`f2r${currentRound}`).disabled = true;

  const f1Total = parseInt(document.getElementById('f1-total').innerText) + f1RoundScore;
  const f2Total = parseInt(document.getElementById('f2-total').innerText) + f2RoundScore;

  document.getElementById('f1-total').innerText = f1Total;
  document.getElementById('f2-total').innerText = f2Total;

  currentRound++;
  if (currentRound <= totalRounds) {
    document.getElementById(`f1r${currentRound}`).style.display = 'block';
    document.getElementById(`f2r${currentRound}`).style.display = 'block';
  } else {
    document.getElementById('next-round-btn').style.display = 'none';
    document.getElementById('winner-display').style.display = 'block';
  }
});

const calculateBtn = document.getElementById("calculate-btn");
const winnerDisplay = document.getElementById("winner");

calculateBtn.addEventListener("click", () => {
  const f1Total = parseInt(document.getElementById('f1-total').innerText);
  const f2Total = parseInt(document.getElementById('f2-total').innerText);

  const fighter1Name = document.getElementById("fighter1-display").innerText;
  const fighter2Name = document.getElementById("fighter2-display").innerText;

  if (f1Total > f2Total) {
    winnerDisplay.textContent = "Winner: " + fighter1Name;
  } else if (f2Total > f1Total) {
    winnerDisplay.textContent = "Winner: " + fighter2Name;
  } else {
    winnerDisplay.textContent = "Winner: Draw!";
  }
});
