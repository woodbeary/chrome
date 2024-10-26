// Function to update UI based on API key presence
function updateUIState(hasKey) {
  const keyStatus = document.getElementById('keyStatus');
  const clearKeyBtn = document.getElementById('clearKey');
  const apiKeyInput = document.getElementById('apiKey');
  
  if (hasKey) {
    keyStatus.textContent = 'API key is saved';
    keyStatus.style.color = '#006700';
    clearKeyBtn.style.display = 'block';
    apiKeyInput.value = ''; // Clear the input for security
    apiKeyInput.placeholder = '••••••••• (API key is saved)';
  } else {
    keyStatus.textContent = 'No API key saved';
    keyStatus.style.color = '#666';
    clearKeyBtn.style.display = 'none';
    apiKeyInput.placeholder = 'Enter your Gemini API key';
  }
}

// Function to show status message
function showStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}

// Save API key
document.getElementById('saveKey').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  
  if (!apiKey) {
    showStatus('Please enter an API key', true);
    return;
  }

  chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
    showStatus('API key saved successfully!');
    updateUIState(true);
  });
});

// Clear API key
document.getElementById('clearKey').addEventListener('click', () => {
  chrome.storage.sync.remove('geminiApiKey', () => {
    showStatus('API key removed');
    updateUIState(false);
  });
});

// Check for existing API key on popup open
window.addEventListener('load', () => {
  chrome.storage.sync.get(['geminiApiKey'], (result) => {
    updateUIState(!!result.geminiApiKey);
  });
});
