const fighter1Inputs = Array.from(document.querySelectorAll("#fighter1 input.round-input"));
const fighter2Inputs = Array.from(document.querySelectorAll("#fighter2 input.round-input"));
const f1TotalDisplay = document.getElementById("f1-total");
const f2TotalDisplay = document.getElementById("f2-total");
const calculateBtn = document.getElementById("calculate-btn");
const winnerDisplay = document.getElementById("winner");

function calculateTotal(inputs) {
  return inputs.reduce((total, input) => total + parseInt(input.value), 0);
}

function updateTotals() {
  const f1Total = calculateTotal(fighter1Inputs);
  const f2Total = calculateTotal(fighter2Inputs);

  f1TotalDisplay.textContent = f1Total;
  f2TotalDisplay.textContent = f2Total;

  return { f1Total, f2Total };
}

fighter1Inputs.forEach((input) =>
  input.addEventListener("input", updateTotals)
);
fighter2Inputs.forEach((input) =>
  input.addEventListener("input", updateTotals)
);

calculateBtn.addEventListener("click", () => {
  const { f1Total, f2Total } = updateTotals();

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

// Initialize totals on page load
updateTotals();
