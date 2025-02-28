// Import the environment variables
import { ENV } from './manifest.env.js';

// Get the password from environment variables
const EXTENSION_PASSWORD = ENV.EXTENSION_PASSWORD;

// Function to check authentication state
function checkAuthentication() {
  chrome.storage.sync.get(['extensionAuthenticated'], (result) => {
    if (result.extensionAuthenticated) {
      document.body.classList.add('authenticated');
      
      // Check for existing API key after authentication
      chrome.storage.sync.get(['geminiApiKey'], (keyResult) => {
        updateUIState(!!keyResult.geminiApiKey);
      });
    } else {
      document.body.classList.remove('authenticated');
    }
  });
}

// Validate password against API endpoint or environment variable
document.getElementById('validatePassword').addEventListener('click', async () => {
  const password = document.getElementById('authPassword').value.trim();
  const passwordStatus = document.getElementById('passwordStatus');
  
  if (!password) {
    passwordStatus.textContent = 'Please enter a password';
    passwordStatus.className = 'status error';
    return;
  }
  
  // Show loading state
  const validateButton = document.getElementById('validatePassword');
  const originalButtonText = validateButton.textContent;
  validateButton.textContent = 'Validating...';
  validateButton.disabled = true;
  
  try {
    // Option 1: Compare against environment variable (current implementation)
    // This is a fallback method if API validation fails
    let isValid = (password === ENV.EXTENSION_PASSWORD);
    
    // Option 2: Validate using API endpoint (try first)
    if (ENV.API_VALIDATION_ENDPOINT) {
      try {
        const response = await fetch(ENV.API_VALIDATION_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password }),
          mode: 'cors',
          credentials: 'omit'
        });
        
        // If API response is successful, use that validation result instead
        if (response.ok) {
          const data = await response.json();
          isValid = data.valid === true;
          
          // If the API returned a Gemini API key, store it
          if (data.geminiApiKey) {
            chrome.storage.sync.set({ geminiApiKey: data.geminiApiKey }, () => {
              console.log('API key from server saved successfully!');
            });
          }
        }
      } catch (apiError) {
        console.warn('API validation failed, falling back to environment variable check:', apiError);
        // Continue with the environment variable check (isValid already set above)
      }
    }
    
    if (isValid) {
      // Store authentication state
      chrome.storage.sync.set({ extensionAuthenticated: true }, () => {
        passwordStatus.textContent = 'Authentication successful!';
        passwordStatus.className = 'status success';
        
        // Notify background script that extension is activated
        chrome.runtime.sendMessage({ 
          type: 'ACTIVATE_EXTENSION', 
          activated: true 
        });
        
        // Update UI after successful authentication
        setTimeout(() => {
          document.body.classList.add('authenticated');
        }, 1000);
      });
    } else {
      passwordStatus.textContent = 'Invalid password. Please try again.';
      passwordStatus.className = 'status error';
      
      // Ensure extension is deactivated
      chrome.storage.sync.set({ extensionAuthenticated: false });
      chrome.runtime.sendMessage({ 
        type: 'ACTIVATE_EXTENSION', 
        activated: false 
      });
    }
  } catch (error) {
    console.error('Authentication error:', error);
    passwordStatus.textContent = 'Authentication error. Please try again.';
    passwordStatus.className = 'status error';
  } finally {
    // Reset button state
    validateButton.textContent = originalButtonText;
    validateButton.disabled = false;
  }
});

// Function to update UI based on API key presence
function updateUIState(hasKey) {
  const keyStatus = document.getElementById('keyStatus');
  const clearKeyBtn = document.getElementById('clearKey');
  const apiKeyInput = document.getElementById('apiKey');
  const testKeyBtn = document.getElementById('testKey');
  
  if (hasKey) {
    keyStatus.textContent = 'API key is saved';
    keyStatus.style.color = '#006700';
    clearKeyBtn.style.display = 'block';
    testKeyBtn.style.display = 'block';
    apiKeyInput.value = ''; // Clear the input for security
    apiKeyInput.placeholder = '••••••••• (API key is saved)';
  } else {
    keyStatus.textContent = 'No API key saved';
    keyStatus.style.color = '#666';
    clearKeyBtn.style.display = 'none';
    testKeyBtn.style.display = 'none';
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

// Function to append to test results
function appendToTestResults(message, isError = false) {
  const testOutput = document.getElementById('testOutput');
  const testResults = document.getElementById('testResults');
  
  // Show the test results container if hidden
  testResults.style.display = 'block';
  
  // Create a new line with timestamp
  const timestamp = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.textContent = `[${timestamp}] ${message}`;
  
  if (isError) {
    line.style.color = '#dc3545';
  }
  
  // Append the line to the output
  testOutput.appendChild(line);
  
  // Scroll to bottom
  testResults.scrollTop = testResults.scrollHeight;
}

// Test API Connection
document.getElementById('testKey').addEventListener('click', async () => {
  const testBtn = document.getElementById('testKey');
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  
  // Clear previous test results
  document.getElementById('testOutput').innerHTML = '';
  document.getElementById('testResults').style.display = 'block';
  
  appendToTestResults('Beginning Gemini API test...');
  
  try {
    // Get the saved API key
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = result.geminiApiKey;
    
    if (!apiKey) {
      appendToTestResults('No API key found in storage. Please save an API key first.', true);
      return;
    }
    
    appendToTestResults(`Found API key in storage (redacted): ${apiKey.substring(0, 3)}...${apiKey.substring(apiKey.length - 3)}`);
    
    // Send a simple test message to Gemini
    appendToTestResults('Sending test request to Gemini API...');
    
    const testMessage = {
      type: 'TEST_GEMINI_API', 
      prompt: 'Say hello in exactly 5 words'
    };
    
    // Send the message to background script
    appendToTestResults('Sending message to background script...');
    
    const response = await chrome.runtime.sendMessage(testMessage);
    
    appendToTestResults('Received response from background script');
    appendToTestResults(`Response success: ${response.success}`);
    
    if (response.success) {
      appendToTestResults('Test completed successfully!');
      appendToTestResults(`Generated text: "${response.text}"`);
      showStatus('API test successful!');
    } else {
      appendToTestResults(`Error: ${response.error}`, true);
      showStatus('API test failed. See details.', true);
    }
  } catch (error) {
    appendToTestResults(`Error during test: ${error.message}`, true);
    if (error.stack) {
      appendToTestResults(`Stack trace: ${error.stack}`, true);
    }
    showStatus('API test failed. See details.', true);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test API Connection';
  }
});

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
  // First check authentication status
  checkAuthentication();
});
