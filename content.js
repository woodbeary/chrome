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
  // Check if buttons already exist
  if (postElement.querySelector('.gemini-generate-buttons')) return;

  // Find the actions bar
  const actionsBar = postElement.querySelector('[role="group"]');
  if (!actionsBar) return;

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'gemini-generate-buttons';
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '8px';
  
  // Create Generate button
  const generateButton = document.createElement('button');
  generateButton.textContent = 'Generate';
  generateButton.onclick = () => handleGeneration(postElement, false);
  
  // Create QRT button
  const qrtButton = document.createElement('button');
  qrtButton.textContent = 'QRT';
  qrtButton.onclick = () => handleGeneration(postElement, true);
  
  buttonContainer.appendChild(generateButton);
  buttonContainer.appendChild(qrtButton);
  actionsBar.appendChild(buttonContainer);
}

// Separate the generation logic into its own function
async function handleGeneration(postElement, isQRT) {
  const button = isQRT ? 
    postElement.querySelector('.gemini-generate-buttons button:nth-child(2)') :
    postElement.querySelector('.gemini-generate-buttons button:nth-child(1)');

  // Show loading state
  const originalText = button.textContent;
  button.textContent = 'Generating...';
  button.disabled = true;

  try {
    const context = await extractPostContext(postElement);
    const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
    
    if (!geminiApiKey) {
      alert('Please set your Gemini API key in the extension popup');
      return;
    }

    // Click the appropriate button based on isQRT
    if (isQRT) {
      const qrtButton = postElement.querySelector('[data-testid="retweet"]');
      qrtButton?.click();
      
      // Wait for the dropdown menu and click Quote
      await new Promise(resolve => setTimeout(resolve, 500));
      const quoteOption = document.querySelector('[role="menuitem"] [class*="r-bcqeeo"] span:not([dir])');
      let quoteButton = null;
      
      // Find the Quote button by looking for the text content
      document.querySelectorAll('[role="menuitem"]').forEach(item => {
        if (item.textContent.includes('Quote')) {
          quoteButton = item;
        }
      });

      if (!quoteButton) {
        throw new Error('Could not find Quote option');
      }
      quoteButton.click();
    } else {
      const replyButton = postElement.querySelector('[data-testid="reply"]');
      replyButton?.click();
    }

    // Wait for the textarea with retries
    let tweetTextArea = null;
    for (let i = 0; i < 25; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      tweetTextArea = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                     document.querySelector('#layers textarea') ||
                     document.querySelector('#layers [role="textbox"]') ||
                     document.querySelector('#layers div[contenteditable="true"]');
      if (tweetTextArea) break;
    }

    if (!tweetTextArea) {
      throw new Error('Could not find tweet textarea');
    }

    // Generate the response
    const response = await chrome.runtime.sendMessage({
      type: isQRT ? 'GENERATE_QRT' : 'GENERATE_RESPONSE',
      context
    });

    if (response.success) {
      // Set the generated text in the textarea
      const setText = async (element) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          element.value = response.text;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {
          await navigator.clipboard.writeText(response.text);
          alert('Text copied to clipboard - please paste it manually (Ctrl/Cmd + V)');
        }
      };

      await setText(tweetTextArea);
    } else {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('Generation failed:', error);
    alert('Failed to generate response. Please try again.');
  } finally {
    // Reset button state
    button.textContent = originalText;
    button.disabled = false;
  }
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
  
  // Add styles for the buttons
  const style2 = document.createElement('style');
  style2.textContent = `
    .gemini-generate-buttons {
      display: flex;
      gap: 8px;
      margin-left: 8px;
    }
    .gemini-generate-buttons button {
      background-color: #1da1f2;
      color: white;
      border: none;
      padding: 4px 12px;
      border-radius: 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: bold;
    }
    .gemini-generate-buttons button:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .gemini-generate-buttons button:hover:not(:disabled) {
      background-color: #1991da;
    }
  `;
  document.head.appendChild(style2);
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
