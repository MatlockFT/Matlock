let currentRound = 1;
let totalRounds = 0;

// Lock-in button event listener
document.getElementById('lock-in-btn').addEventListener('click', function() {
  const fighter1Name = document.getElementById('fighter1-name').value;
  const fighter2Name = document.getElementById('fighter2-name').value;
  totalRounds = parseInt(document.getElementById('rounds-selection').value);

  // Display fighter names
  document.getElementById('fighter1-display').innerText = fighter1Name;
  document.getElementById('fighter2-display').innerText = fighter2Name;

  // Disable input fields after lock-in
  document.getElementById('fighter1-name').disabled = true;
  document.getElementById('fighter2-name').disabled = true;
  document.getElementById('rounds-selection').disabled = true;
  document.getElementById('lock-in-btn').disabled = true;

  // Show scorecard and next round button
  document.getElementById('scorecard').style.display = 'flex';

  // Setup round inputs
  setupRounds();
});

// Function to setup round inputs
function setupRounds() {
  const fighter1Rounds = document.getElementById('fighter1-rounds');
  const fighter2Rounds = document.getElementById('fighter2-rounds');
  fighter1Rounds.innerHTML = ''; // Clear previous inputs
  fighter2Rounds.innerHTML = ''; // Clear previous inputs

  for (let i = 1; i <= totalRounds; i++) {
    const f1RoundInput = document.createElement('input');
    f1RoundInput.type = 'number';
    f1RoundInput.className = 'round-input';
    f1RoundInput.id = `f1r${i}`;
    f1RoundInput.min = 0;
    f1RoundInput.max = 10;
    f1RoundInput.style.display = 'none';
    fighter1Rounds.appendChild(f1RoundInput);

    const f2RoundInput = document.createElement('input');
    f2RoundInput.type = 'number';
    f2RoundInput.className = 'round-input';
    f2RoundInput.id = `f2r${i}`;
    f2RoundInput.min = 0;
    f2RoundInput.max = 10;
    f2RoundInput.style.display = 'none';
    fighter2Rounds.appendChild(f2RoundInput);
  }

  // Display inputs for the first round
  document.getElementById(`f1r${currentRound}`).style.display = 'block';
  document.getElementById(`f2r${currentRound}`).style.display = 'block';
}

// Next round button event listener
document.getElementById('next-round-btn').addEventListener('click', function() {
  const f1RoundScore = parseInt(document.getElementById(`f1r${currentRound}`).value) || 0;
  const f2RoundScore = parseInt(document.getElementById(`f2r${currentRound}`).value) || 0;

  // Validate scores
  if (f1RoundScore < 0 || f1RoundScore > 10 || f2RoundScore < 0 || f2RoundScore > 10) {
    alert('Scores must be between 0 and 10.');
    return;
  }

  // Disable inputs after scoring
  document.getElementById(`f1r${currentRound}`).disabled = true;
  document.getElementById(`f2r${currentRound}`).disabled = true;

  // Update total scores
  const f1Total = parseInt(document.getElementById('f1-total').innerText) + f1RoundScore;
  const f2Total = parseInt(document.getElementById('f2-total').innerText) + f2RoundScore;

  // Display updated total scores
  document.getElementById('f1-total').innerText = f1Total;
  document.getElementById('f2-total').innerText = f2Total;

  currentRound++;
  if (currentRound <= totalRounds) {
    // Display inputs for the next round
    document.getElementById(`f1r${currentRound}`).style.display = 'block';
    document.getElementById(`f2r${currentRound}`).style.display = 'block';
  } else {
    // Hide next round button and show calculate winner button
    document.getElementById('next-round-btn').style.display = 'none';
    document.getElementById('winner-display').style.display = 'block';
  }
});

// Calculate winner button event listener
document.getElementById("calculate-btn").addEventListener("click", () => {
  const f1Total = parseInt(document.getElementById('f1-total').innerText);
  const f2Total = parseInt(document.getElementById('f2-total').innerText);

  const fighter1Name = document.getElementById("fighter1-display").innerText;
  const fighter2Name = document.getElementById("fighter2-display").innerText;

  // Determine and display the winner
  let result = '';
  if (f1Total > f2Total) {
    result = `Winner: ${fighter1Name}`;
  } else if (f2Total > f1Total) {
    result = `Winner: ${fighter2Name}`;
  } else {
    result = "Winner: Draw!";
  }
  document.getElementById("winner").textContent = result;
});
