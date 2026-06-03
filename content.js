// content.js - Injected into every page

let modal = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SHOW_LOADING") showModal(msg);
  if (msg.type === "SHOW_RESULT")  updateModal(msg);
  if (msg.type === "SHOW_ERROR")   showError(msg.error);
});

function getOrCreateModal() {
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "refactor-modal-root";
  document.body.appendChild(modal);

  modal.innerHTML = `
    <div class="rf-backdrop"></div>
    <div class="rf-panel">
      <div class="rf-header">
        <span class="rf-title">Wordsmith</span>
        <button class="rf-close" aria-label="Close">x</button>
      </div>
      <div class="rf-body">
        <div class="rf-section">
          <label class="rf-label">ORIGINAL</label>
          <div class="rf-box rf-original"></div>
        </div>
        <div class="rf-divider">
          <span class="rf-action-badge"></span>
          <div class="rf-arrow">to</div>
        </div>
        <div class="rf-section">
          <label class="rf-label">RESULT</label>
          <div class="rf-box rf-result">
            <div class="rf-loader">
              <div class="rf-dot"></div><div class="rf-dot"></div><div class="rf-dot"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="rf-footer">
        <button class="rf-btn rf-btn-secondary rf-copy">Copy Result</button>
        <button class="rf-btn rf-btn-primary rf-replace" disabled>Replace on Page</button>
      </div>
    </div>
  `;

  // Close handlers
  modal.querySelector(".rf-close").addEventListener("click", closeModal);
  modal.querySelector(".rf-backdrop").addEventListener("click", closeModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal?.classList.contains("rf-open")) closeModal();
  });

  // Copy button
  modal.querySelector(".rf-copy").addEventListener("click", () => {
    const text = modal.querySelector(".rf-result")?.dataset.text;
    if (text) {
      navigator.clipboard.writeText(text);
      const btn = modal.querySelector(".rf-copy");
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy Result"), 1500);
    }
  });

  return modal;
}

function showModal({ originalText, action }) {
  const m = getOrCreateModal();
  m.querySelector(".rf-original").textContent = originalText;
  m.querySelector(".rf-result").innerHTML = `
    <div class="rf-loader">
      <div class="rf-dot"></div><div class="rf-dot"></div><div class="rf-dot"></div>
    </div>`;
  m.querySelector(".rf-result").dataset.text = "";
  m.querySelector(".rf-action-badge").textContent = action;
  m.querySelector(".rf-replace").disabled = true;

  requestAnimationFrame(() => m.classList.add("rf-open"));
}

function updateModal({ originalText, resultText, action }) {
  if (!modal) return;

  const resultBox = modal.querySelector(".rf-result");
  resultBox.textContent = resultText;
  resultBox.dataset.text = resultText;

  modal.querySelector(".rf-original").textContent = originalText;
  modal.querySelector(".rf-action-badge").textContent = action;

  const replaceBtn = modal.querySelector(".rf-replace");
  replaceBtn.disabled = false;
  replaceBtn.onclick = () => {
    replaceSelectedText(resultText);
    closeModal();
  };
}

function showError(message) {
  if (!modal) return;
  const resultBox = modal.querySelector(".rf-result");
  resultBox.innerHTML = "";

  const errorText = document.createElement("span");
  errorText.className = "rf-error";
  errorText.textContent = `Error: ${message}`;
  resultBox.appendChild(errorText);
}

function closeModal() {
  if (!modal) return;
  modal.classList.remove("rf-open");
}

function replaceSelectedText(newText) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(newText));
  sel.removeAllRanges();
}
