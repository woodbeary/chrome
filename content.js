// Utility function to extract post context
async function extractPostContext(postElement) {
  // Debug log the element
  console.log('Extracting context from:', postElement);

  // Get main tweet text
  const tweetText = postElement.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';

  // Get quoted tweet if any
  const quotedTweet = postElement.querySelector('[role="blockquote"]')?.textContent?.trim() || '';
  
  // Combine text, preserving original formatting
  let fullText = tweetText;
  if (quotedTweet && !fullText.includes(quotedTweet)) {
    fullText += `\nQuoted Tweet: ${quotedTweet}`;
  }

  // Get meaningful links (exclude internal twitter/x links)
  const links = Array.from(postElement.querySelectorAll('a[role="link"]'))
    .map(link => link.href)
    .filter(href => !href.includes('twitter.com') && !href.includes('x.com'))
    .filter(Boolean);

  if (links.length) {
    fullText += `\nLinks: ${links.join(', ')}`;
  }

  // Just clean up excessive whitespace, preserve original newlines
  fullText = fullText.replace(/\s+/g, ' ').trim();

  console.log('Found tweet text:', fullText);

  // More robust author extraction
  const authorElement = postElement.querySelector('[data-testid="User-Name"]') || 
                       postElement.querySelector('[data-testid="author-name"]');
  const authorName = authorElement?.textContent?.trim() || '';
  
  console.log('Found author:', authorName);

  // More robust parent tweet extraction
  const parentArticle = postElement.closest('article')?.previousElementSibling;
  const parentTweet = parentArticle?.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';
  
  console.log('Found parent tweet:', parentTweet);

  // Extract images
  const images = [];
  const imageElements = postElement.querySelectorAll('img[src*="media"]');
  console.log('Found image elements:', imageElements.length);

  for (const img of imageElements) {
    try {
      const response = await fetch(img.src);
      const blob = await response.blob();
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
      images.push(base64);
    } catch (error) {
      console.warn('Failed to process image:', error);
    }
  }

  const context = {
    text: fullText,
    author: authorName,
    parentTweet,
    images: images.length > 0 ? images : null,
    imageUrls: Array.from(imageElements).map(img => img.src),
    timestamp: new Date().toISOString()
  };

  // Debug log the final context
  console.log('Final extracted context:', context);

  return context;
}

// Create and inject the generate button
function createGenerateButton(postElement) {
  // Check if button already exists
  if (postElement.querySelector('.gemini-generate-button')) return;

  // Find the actions bar (where reply, retweet, like buttons are)
  const actionsBar = postElement.querySelector('[role="group"]');
  if (!actionsBar) return;

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'gemini-generate-button';
  
  const generateButton = document.createElement('button');
  generateButton.textContent = 'Generate';
  generateButton.onclick = async () => {
    // Show loading state
    generateButton.textContent = 'Generating...';
    generateButton.disabled = true;

    try {
      // FIXED: Await the context extraction
      const context = await extractPostContext(postElement);
      
      console.log('Extracted context:', context); // Debug log
      
      // Get the API key from storage
      const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
      
      if (!geminiApiKey) {
        alert('Please set your Gemini API key in the extension popup');
        return;
      }

      // Click the reply button to open the reply modal
      const replyButton = postElement.querySelector('[data-testid="reply"]');
      replyButton?.click();

      // Wait for the reply textarea with retries
      let tweetTextArea = null;
      for (let i = 0; i < 25; i++) {  // Try for up to 5 seconds (25 * 200ms)
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Try multiple selectors to find the textarea
        const selectors = [
          '[data-testid="tweetTextarea_0"]',
          '#layers textarea',
          '#layers [role="textbox"]',
          '#layers div[contenteditable="true"]',
          // The full specific selector as fallback
          '#layers > div:nth-child(2) > div > div > div > div > div > div.css-175oi2r.r-1ny4l3l.r-18u37iz.r-1pi2tsx.r-1777fci.r-1xcajam.r-ipm5af.r-g6jmlv.r-1habvwh > div.css-175oi2r.r-1wbh5a2.r-htvplk.r-1udh08x.r-1867qdf.r-rsyp9y.r-1pjcn9w.r-1potc6q > div > div > div > div:nth-child(3) > div.css-175oi2r.r-kemksi.r-1h8ys4a.r-dq6lxq.r-hucgq0 > div:nth-child(2) > div > div > div > div.css-175oi2r.r-18u37iz.r-184en5c > div.css-175oi2r.r-1iusvr4.r-16y2uox.r-1777fci.r-1h8ys4a.r-1bylmt5.r-13tjlyg.r-7qyjyx.r-1ftll1t > div > div > div > div > div > div > div > div > div > div > div > div > div.css-175oi2r.r-1wbh5a2.r-16y2uox > div > textarea'
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            console.log('Found textarea element with selector:', selector);
            tweetTextArea = element;
            break;
          }
        }
        
        if (tweetTextArea) break;
      }
      
      if (!tweetTextArea) {
        throw new Error('Could not find reply textarea after waiting');
      }

      // Send message to background script
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_RESPONSE',
        context
      });

      if (response.success) {
        try {
          // More gentle approach to setting text
          const setText = async (element) => {
            // Wait a bit for Twitter's UI to stabilize
            await new Promise(resolve => setTimeout(resolve, 500));

            // Try different methods to set text
            try {
              // Method 1: Direct value setting
              element.value = response.text;
            } catch (e) {
              console.warn('Method 1 failed:', e);
            }

            try {
              // Method 2: Clipboard method
              const originalClipboard = await navigator.clipboard.readText().catch(() => '');
              await navigator.clipboard.writeText(response.text);
              element.focus();
              document.execCommand('paste');
              await navigator.clipboard.writeText(originalClipboard);
            } catch (e) {
              console.warn('Method 2 failed:', e);
            }

            try {
              // Method 3: Input events only
              const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                data: response.text,
                inputType: 'insertText'
              });
              element.dispatchEvent(inputEvent);
            } catch (e) {
              console.warn('Method 3 failed:', e);
            }
          };

          // Try to set text with retries
          let success = false;
          for (let i = 0; i < 3; i++) {
            try {
              await setText(tweetTextArea);
              success = true;
              break;
            } catch (e) {
              console.warn(`Attempt ${i + 1} failed:`, e);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }

          if (!success) {
            // Fallback: Show manual copy dialog
            const shouldCopy = confirm('Could not auto-insert text. Click OK to copy to clipboard instead.');
            if (shouldCopy) {
              await navigator.clipboard.writeText(response.text);
              alert('Response copied to clipboard! You can now paste it manually.');
            }
          }

        } catch (e) {
          console.warn('Error setting text:', e);
          // Final fallback
          await navigator.clipboard.writeText(response.text);
          alert('Text copied to clipboard - please paste it manually (Ctrl/Cmd + V)');
        }
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('Generation failed:', error);
      alert('Failed to generate response. Please try again.');
    } finally {
      // Reset button state
      generateButton.textContent = 'Generate';
      generateButton.disabled = false;
    }
  };
  
  buttonContainer.appendChild(generateButton);
  actionsBar.appendChild(buttonContainer);
}

// Function to process a single tweet
function processTweet(article) {
  if (!article || article.hasAttribute('data-gemini-processed')) return;
  
  // Mark as processed to avoid duplicates
  article.setAttribute('data-gemini-processed', 'true');
  createGenerateButton(article);
}

// Observer function to handle new posts
function observeTimeline() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Process any articles directly added
          if (node.tagName === 'ARTICLE') {
            processTweet(node);
          }
          // Process any articles within added nodes
          node.querySelectorAll('article').forEach(processTweet);
        }
      });
    });
  });

  // Start observing the timeline
  const timeline = document.querySelector('[data-testid="primaryColumn"]');
  if (timeline) {
    observer.observe(timeline, {
      childList: true,
      subtree: true
    });
    
    // Process existing tweets
    timeline.querySelectorAll('article').forEach(processTweet);
  }
}

// Initialize the extension
function initialize() {
  // Start observing for new posts
  observeTimeline();
  
  // Add styles for loading state
  const style = document.createElement('style');
  style.textContent = `
    .gemini-generate-button button:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}

// Start the extension
initialize();

// Re-run initialization when navigation occurs
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    initialize();
  }
}).observe(document, { subtree: true, childList: true });
