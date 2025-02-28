// Global variable to track if the extension is activated
let isExtensionActivated = false;
let isInitialized = false;
let isInitializing = false;

// Immediately remove any existing UI elements on page load
removeExtensionUI();

// Check activation status on initialization
async function checkActivationStatus() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_ACTIVATION_STATUS' }, (response) => {
        // Check for runtime error first (this occurs if background script isn't ready)
        const error = chrome.runtime.lastError;
        if (error) {
          console.error('❌ Error checking activation status:', error.message);
          isExtensionActivated = false;
          removeExtensionUI();
          resolve(false);
          return;
        }
        
        if (response && response.success) {
          isExtensionActivated = response.activated;
          console.log('📊 Extension activation status:', isExtensionActivated);
          
          // If not activated, make sure UI is removed
          if (!isExtensionActivated) {
            removeExtensionUI();
          }
        } else {
          isExtensionActivated = false;
          console.error('❌ Failed to get activation status - invalid response');
          removeExtensionUI();
        }
        resolve(isExtensionActivated);
      });
    } catch (err) {
      // Fallback error handling
      console.error('❌ Exception during activation check:', err);
      isExtensionActivated = false;
      removeExtensionUI();
      resolve(false);
    }
  });
}

// Listen for activation status changes from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'ACTIVATION_STATUS_CHANGED') {
    const wasActivated = isExtensionActivated;
    isExtensionActivated = message.activated === true;
    console.log('📊 Extension activation status changed:', isExtensionActivated);
    
    // If newly activated, initialize features
    if (isExtensionActivated && !wasActivated) {
      initialize();
      setupUrlObserver();
    } 
    // If deactivated, clean up UI and observers
    else if (!isExtensionActivated && wasActivated) {
      removeExtensionUI();
      if (urlObserver) {
        urlObserver.disconnect();
        observerActive = false;
      }
    }
  }
  return true;
});

// Function to remove all extension UI elements
function removeExtensionUI() {
  // Remove all our injected buttons and elements
  document.querySelectorAll('.gemini-generate-buttons, .post-progress-widget, .generate-product-button').forEach(el => {
    el.remove();
  });
}

async function extractPostContext(postElement) {
  // Skip if extension is not activated
  if (!isExtensionActivated) {
    console.log('🔒 Extension not activated, skipping context extraction');
    return null;
  }
  
  console.log('Extracting context from:', postElement);

  // Get main tweet text
  const tweetText = postElement.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';

  // Get parent tweet by following the thread structure
  let parentTweet = '';
  let parentAuthor = '';
  let originalTweet = '';
  let originalAuthor = '';

  // Track images from both current tweet and original tweet
  let allImages = [];
  let allImageUrls = [];

  // Function to extract images from an article
  const extractImagesFromArticle = async (article) => {
    const images = [];
    const imageUrls = [];
    const imageElements = article.querySelectorAll('img[src*="media"]');
    
    for (const img of imageElements) {
      imageUrls.push(img.src);
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
    return { images, imageUrls };
  };

  // Find the thread container
  const threadContainer = postElement.closest('div[aria-label="Timeline: Conversation"]');
  if (threadContainer) {
    // Find the original tweet (first tweet in the thread)
    const originalArticle = threadContainer.querySelector('article');
    if (originalArticle) {
      originalTweet = originalArticle.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';
      originalAuthor = originalArticle.querySelector('[data-testid="User-Name"]')?.textContent?.trim() || '';
      
      // Get images from original tweet
      const { images: origImages, imageUrls: origUrls } = await extractImagesFromArticle(originalArticle);
      allImages = [...allImages, ...origImages];
      allImageUrls = [...allImageUrls, ...origUrls];
    }

    // Find the immediate parent tweet (the one directly above)
    const articles = Array.from(threadContainer.querySelectorAll('article'));
    const currentIndex = articles.indexOf(postElement);
    if (currentIndex > 0) {
      // Check if this tweet is part of a thread by looking for the thread indicator
      const isInThread = postElement.closest('.r-1ut4w64') || // Thread indicator class
                        postElement.closest('[role="link"]')?.closest('article')?.previousElementSibling?.querySelector('.r-1bnu78o'); // Thread line element
      
      if (isInThread) {
        const parentArticle = articles[currentIndex - 1];
        parentTweet = parentArticle.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';
        parentAuthor = parentArticle.querySelector('[data-testid="User-Name"]')?.textContent?.trim() || '';
      }
    }
  }

  // Get images from current tweet
  const { images: currentImages, imageUrls: currentUrls } = await extractImagesFromArticle(postElement);
  allImages = [...allImages, ...currentImages];
  allImageUrls = [...allImageUrls, ...currentUrls];

  console.log('Found image elements:', allImageUrls.length);

  // Combine text with proper thread context
  let fullText = tweetText;
  
  // Add immediate parent tweet context if it exists
  if (parentTweet && parentAuthor) {
    fullText = `${fullText}\n\nReplying to ${parentAuthor}'s tweet: "${parentTweet}"`;
  }
  
  // Add original tweet context if this isn't the original tweet and it's different from parent
  if (originalTweet && originalAuthor && 
      originalTweet !== tweetText && 
      originalTweet !== parentTweet) {
    fullText = `${fullText}\n\nOriginal tweet by ${originalAuthor}: "${originalTweet}"`;
  }

  // Get meaningful links (exclude internal twitter/x links)
  const links = Array.from(postElement.querySelectorAll('a[role="link"]'))
    .map(link => link.href)
    .filter(href => !href.includes('twitter.com') && !href.includes('x.com'))
    .filter(Boolean);

  if (links.length) {
    fullText += `\nLinks: ${links.join(', ')}`;
  }

  console.log('Found tweet text:', fullText);
  console.log('Found parent tweet:', parentTweet);
  console.log('Found parent author:', parentAuthor);

  // Get author
  const authorElement = postElement.querySelector(':scope > div [data-testid="User-Name"]') || 
                       postElement.querySelector(':scope > div [data-testid="author-name"]');
  const authorName = authorElement?.textContent?.trim() || '';
  
  console.log('Found author:', authorName);

  const context = {
    text: fullText,
    author: authorName,
    parentTweet,
    quotedAuthor: '',
    images: allImages.length > 0 ? allImages : null,
    imageUrls: allImageUrls,
    timestamp: new Date().toISOString()
  };

  console.log('Final extracted context:', context);

  return context;
}

// Create and inject the generate button
function createGenerateButton(postElement) {
  // Skip if extension is not activated
  if (!isExtensionActivated) {
    return;
  }

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
    console.log('📊 handleGeneration - Starting generation process, isQRT:', isQRT);
    const context = await extractPostContext(postElement);
    console.log('📊 handleGeneration - Extracted context successfully:', context);
    
    console.log('📊 handleGeneration - Checking for Gemini API key in storage...');
    const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
    
    if (!geminiApiKey) {
      console.error('❌ handleGeneration - No Gemini API key found in storage');
      alert('Please set your Gemini API key in the extension popup');
      // Reset button state
      button.textContent = originalText;
      button.disabled = false;
      return;
    }
    console.log('📊 handleGeneration - API key found in storage (redacted):', geminiApiKey.substring(0, 3) + '...' + geminiApiKey.substring(geminiApiKey.length - 3));

    // Click the appropriate button based on isQRT
    if (isQRT) {
      console.log('📊 handleGeneration - Processing Quote Retweet (QRT)');
      const qrtButton = postElement.querySelector('[data-testid="retweet"]');
      console.log('📊 handleGeneration - Found QRT button:', !!qrtButton);
      qrtButton?.click();
      
      // Wait for the dropdown menu and click Quote
      console.log('📊 handleGeneration - Waiting for QRT dropdown menu...');
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
        console.error('❌ handleGeneration - Could not find Quote option in dropdown');
        throw new Error('Could not find Quote option');
      }
      console.log('📊 handleGeneration - Found Quote button, clicking...');
      quoteButton.click();
    } else {
      console.log('📊 handleGeneration - Processing Reply');
      const replyButton = postElement.querySelector('[data-testid="reply"]');
      console.log('📊 handleGeneration - Found reply button:', !!replyButton);
      replyButton?.click();
    }

    // Wait for the textarea with retries
    console.log('📊 handleGeneration - Waiting for textarea to appear...');
    let tweetTextArea = null;
    let draftEditor = null;
    
    // First try to find the Draft.js editor directly
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Try to find the draft editor container
      draftEditor = document.querySelector('.DraftEditor-editorContainer');
      if (draftEditor) {
        console.log('📊 handleGeneration - Found Draft.js editor container');
        const editableDiv = draftEditor.querySelector('[contenteditable="true"]') || 
                           draftEditor.querySelector('[role="textbox"]');
        
        if (editableDiv) {
          console.log('📊 handleGeneration - Found editable div within Draft.js editor');
          tweetTextArea = editableDiv;
          break;
        }
      }
      
      // Try using the exact selector the user provided
      const exactEditor = document.querySelector('#layers > div:nth-child(2) > div > div > div > div > div > div.css-175oi2r.r-1ny4l3l.r-18u37iz.r-1pi2tsx.r-1777fci.r-1xcajam.r-ipm5af.r-g6jmlv.r-1habvwh > div.css-175oi2r.r-1wbh5a2.r-htvplk.r-1udh08x.r-1867qdf.r-rsyp9y.r-1pjcn9w.r-1potc6q > div > div > div > div:nth-child(3) > div.css-175oi2r.r-1h8ys4a.r-dq6lxq.r-hucgq0 > div:nth-child(2) > div > div > div > div.css-175oi2r.r-18u37iz.r-184en5c > div.css-175oi2r.r-1iusvr4.r-16y2uox.r-1777fci.r-1h8ys4a.r-1bylmt5.r-13tjlyg.r-7qyjyx.r-1ftll1t > div > div > div > div > div > div > div > div > div > div > div > div > div.css-175oi2r.r-1wbh5a2.r-16y2uox > div > div > div > div > div > div.DraftEditor-editorContainer > div');
      
      if (exactEditor) {
        console.log('📊 handleGeneration - Found editor using exact CSS selector');
        tweetTextArea = exactEditor;
        break;
      }
    }
    
    // Fall back to previous methods if Draft.js editor not found
    if (!tweetTextArea) {
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        tweetTextArea = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                       document.querySelector('#layers textarea') ||
                       document.querySelector('#layers [role="textbox"]') ||
                       document.querySelector('#layers div[contenteditable="true"]');
        if (tweetTextArea) {
          console.log('📊 handleGeneration - Found textarea using traditional selectors after', i+1, 'attempts');
          break;
        }
      }
    }

    if (!tweetTextArea) {
      console.error('❌ handleGeneration - Could not find tweet textarea after multiple attempts');
      console.log('📷 handleGeneration - Taking DOM snapshot for debugging:');
      console.log(document.querySelector('#layers')?.innerHTML || 'No #layers element found');
      throw new Error('Could not find tweet textarea');
    }
    
    console.log('📊 handleGeneration - Found textarea:', {
      tagName: tweetTextArea.tagName,
      role: tweetTextArea.getAttribute('role'),
      contentEditable: tweetTextArea.getAttribute('contenteditable'),
      className: tweetTextArea.className,
      id: tweetTextArea.id
    });

    // Prepare message for background.js
    const message = {
      type: isQRT ? 'GENERATE_QRT' : 'GENERATE_RESPONSE',
      context
    };
    console.log('📤 handleGeneration - Sending message to background.js:', JSON.stringify(message, null, 2));

    // Generate the response - add try/catch for better error handling
    try {
      console.log('⏳ handleGeneration - Awaiting response from background.js...');
      const response = await chrome.runtime.sendMessage(message);
      console.log('📥 handleGeneration - Received response from background.js:', response);

      // Check for specific error conditions
      if (!response) {
        console.error('❌ handleGeneration - Received empty response from background.js');
        throw new Error('Empty response from background script');
      }

      if (chrome.runtime.lastError) {
        console.error('❌ handleGeneration - Chrome runtime error:', chrome.runtime.lastError);
        throw new Error(`Chrome runtime error: ${chrome.runtime.lastError.message}`);
      }

      if (response.success) {
        console.log('✅ handleGeneration - Generation successful, setting text in textarea');
        
        // Directly use our specialized function for Twitter
        await setTextInTwitterEditor(response.text);
        
        // Find the tweet button and observe it for clicks
        console.log('📊 handleGeneration - Looking for tweet button...');
        const tweetButton = document.querySelector('[data-testid="tweetButton"]');
        if (tweetButton) {
          console.log('📊 handleGeneration - Found tweet button, adding click listener');
          tweetButton.addEventListener('click', async () => {
            console.log('📊 handleGeneration - Tweet button clicked');
            // Wait a bit for the tweet to post
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Increment post count
            incrementPostCount();
            
            // Find and click the like button on the original post
            const likeButton = postElement.querySelector('[data-testid="like"]');
            if (likeButton && !likeButton.querySelector('[data-testid="unlike"]')) {
              console.log('📊 handleGeneration - Auto-liking original post');
              likeButton.click();
            }
          });
        } else {
          console.log('⚠️ handleGeneration - No tweet button found');
        }
      } else {
        console.error('❌ handleGeneration - Generation failed, response error:', response.error);
        throw new Error(response.error || 'Generation failed');
      }
    } catch (sendError) {
      console.error('❌ handleGeneration - Error during generation/sending:', sendError);
      alert(`Error: ${sendError.message || 'Failed to generate response'}`);
    } finally {
      // Reset button state regardless of success/failure
      button.textContent = originalText;
      button.disabled = false;
    }
  } catch (error) {
    console.error('❌ handleGeneration - Unexpected error:', error);
    alert(`An unexpected error occurred: ${error.message}`);
    
    // Reset button state
    button.textContent = originalText;
    button.disabled = false;
  }
}

// Helper function to wait for an element
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Timeout after specified duration
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

// Function to process a single tweet
function processTweet(article) {
  if (!article || article.hasAttribute('data-gemini-processed')) return;
  
  // CRITICAL: Skip processing if extension is not activated
  if (!isExtensionActivated) return;
  
  // Mark as processed to avoid duplicates
  article.setAttribute('data-gemini-processed', 'true');
  createGenerateButton(article);
}

// Add this function to handle trending summaries
function processTrendingSummary(summaryElement) {
  if (!summaryElement || summaryElement.hasAttribute('data-gemini-processed')) return;

  // Mark as processed
  summaryElement.setAttribute('data-gemini-processed', 'true');

  // Find or create the button container
  let buttonContainer = summaryElement.querySelector('.css-175oi2r.r-1pz39u2.r-1777fci');
  if (!buttonContainer) {
    buttonContainer = document.createElement('div');
    buttonContainer.className = 'css-175oi2r r-1pz39u2 r-1777fci';
    buttonContainer.style.marginTop = '12px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
  }

  // Create Post button similar to share button
  const postButton = document.createElement('div');
  postButton.className = 'css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21';
  postButton.style.cursor = 'pointer';
  postButton.innerHTML = `
    <div dir="ltr" class="css-146c3p1 r-bcqeeo r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-1777fci" style="color: rgb(239, 243, 244);">
      <span class="css-1jxf684 r-bcqeeo r-qvutc0 r-poiln3" style="margin-right: 4px;">Post this</span>
    </div>
  `;

  // Add click handler
  postButton.onclick = () => handleTrendingPost(summaryElement);

  buttonContainer.appendChild(postButton);
  summaryElement.appendChild(buttonContainer);
}

// Add this function to handle posting trending content
async function handleTrendingPost(summaryElement) {
  try {
    // Extract content with updated selectors
    const title = summaryElement.querySelector('div[dir="auto"] .css-1jxf684[style*="color: rgb(231, 233, 234)"]')?.textContent;
    const content = summaryElement.querySelector('div.css-175oi2r.r-knv0ih .css-1jxf684[style*="text-overflow: unset"]')?.textContent;
    
    console.log('Trending title:', title);
    console.log('Trending content:', content);

    const context = {
      text: `${title}\n\n${content}`,
      author: 'Trending Topic',
      parentTweet: '',
      images: null,
      imageUrls: [],
      timestamp: new Date().toISOString()
    };

    console.log('Final trending context:', context);

    const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
    
    if (!geminiApiKey) {
      alert('Please set your Gemini API key in the extension popup');
      return;
    }

    // Click the share button
    const shareButton = document.querySelector('[data-testid="share-button"]');
    shareButton?.click();
    
    // Wait for the dropdown menu and click "Post this"
    await new Promise(resolve => setTimeout(resolve, 500));
    let postThisButton = null;
    
    // Find the Post this button by looking for the specific data-testid
    postThisButton = document.querySelector('[data-testid="share-by-tweet"]');

    if (!postThisButton) {
      throw new Error('Could not find Post this option');
    }
    postThisButton.click();

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

    // Get the existing URL from the textarea
    const existingUrl = tweetTextArea.value || tweetTextArea.textContent || '';

    // Generate and set the response
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_RESPONSE',
      context
    });

    if (response.success) {
      // Set the generated text in the textarea, preserving the URL at the bottom
      const setText = async (element) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const combinedText = `${response.text}\n${existingUrl}`;
          element.value = combinedText;
          element.textContent = combinedText;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {
          await navigator.clipboard.writeText(`${response.text}\n${existingUrl}`);
          alert('Text copied to clipboard - please paste it manually (Ctrl/Cmd + V)');
        }
      };

      await setText(tweetTextArea);
    } else {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('Post generation failed:', error);
    alert('Failed to generate post. Please try again.');
  }
}

// Observer function to handle new posts
function observeTimeline() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Process articles
          if (node.tagName === 'ARTICLE') {
            processTweet(node);
          }
          node.querySelectorAll('article').forEach(processTweet);

          // Process trending summaries
          const trendingSummary = node.querySelector('.css-175oi2r.r-kzbkwu.r-3pj75a');
          if (trendingSummary) {
            processTrendingSummary(trendingSummary);
          }
          node.querySelectorAll('.css-175oi2r.r-kzbkwu.r-3pj75a').forEach(processTrendingSummary);
        }
      });
    });
  });

  // Start observing
  const timeline = document.querySelector('[data-testid="primaryColumn"]');
  if (timeline) {
    observer.observe(timeline, {
      childList: true,
      subtree: true
    });
    
    // Process existing content
    timeline.querySelectorAll('article').forEach(processTweet);
    timeline.querySelectorAll('.css-175oi2r.r-kzbkwu.r-3pj75a').forEach(processTrendingSummary);
  }
}

// Modify the initialize function to check activation
function initialize() {
  console.log('🚀 Initializing Tweet Generator Extension, activation status:', isExtensionActivated);
  
  // Skip initialization if not activated
  if (!isExtensionActivated) {
    console.log('🔒 Extension not activated, skipping initialization');
    return;
  }
  
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

  observeForModal();

  // Initialize progress bar
  updateProgressBar();
}

// Re-run initialization when navigation occurs
let lastUrl = location.href;
let observerActive = false;
let urlObserver = null;

// Initialize URL observer only if extension is activated
function setupUrlObserver() {
  if (urlObserver) {
    urlObserver.disconnect();
  }
  
  // Only set up the observer if the extension is activated
  if (isExtensionActivated) {
    urlObserver = new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        if (isExtensionActivated) {
          console.log('URL changed, reinitializing extension...');
          initialize();
        }
      }
    });
    
    urlObserver.observe(document, { subtree: true, childList: true });
    observerActive = true;
    console.log('URL observer initialized');
  } else {
    observerActive = false;
    console.log('URL observer not initialized (extension not activated)');
  }
}

// Initialize content script with a delay to ensure background script is ready
function initializeContentScript() {
  // Prevent double initialization
  if (isInitialized || isInitializing) {
    console.log('⚠️ Content script already initialized or initializing, skipping');
    return;
  }
  
  isInitializing = true;
  console.log('🔄 Content script loaded, initializing...');
  
  // Clear any UI elements first
  removeExtensionUI();
  
  // Wait a moment before checking activation status
  // This helps prevent errors when background script isn't fully initialized
  setTimeout(() => {
    checkActivationStatus().then((activated) => {
      if (activated) {
        console.log('🚀 Extension activated, initializing features...');
        initialize();
        setupUrlObserver();
      } else {
        console.log('🔒 Extension not activated, waiting for authentication');
        // Make absolutely sure no UI elements are present
        removeExtensionUI();
      }
      isInitialized = true;
      isInitializing = false;
    }).catch(error => {
      console.error('❌ Error during initialization:', error);
      removeExtensionUI();
      isInitializing = false;
    });
  }, 500); // 500ms delay
}

// Start the content script
initializeContentScript();

async function handlePopulate() {
  const imageInput = document.querySelector('.DrawerModal.Modal .ViewNavigator-view.is-active .Panel-body input[placeholder*="demin_jeans"]') ||
                    document.querySelector('.DrawerModal.Modal .ViewNavigator-view.is-active .Panel-body input[aria-labelledby="feather-form-field-text-86"]');
  
  console.log('Looking for image input with specific selectors');

  if (!imageInput || !imageInput.value) {
    console.log('No image URL found');
    return;
  }

  const imageUrl = imageInput.value.trim();
  console.log('Processing image URL:', imageUrl);

  try {
    console.log('Sending message to background.js...');
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_PRODUCT',
      context: {
        imageUrl: imageUrl
      }
    });

    console.log('Received response:', response);

    if (!response.success) {
      console.error('Error response:', response);
      throw new Error(response.error);
    }

    // Updated selectors to match the exact fields
    const fields = {
      title: document.querySelector('input[aria-labelledby="feather-form-field-text-69"]'), // Product title
      description: document.querySelector('textarea[aria-labelledby="feather-form-field-text-70"]'), // Product description
      brand: document.querySelector('input[aria-labelledby="feather-form-field-text-89"]') // Brand field
    };

    console.log('Found form fields:', fields);

    // Populate title
    if (fields.title) {
      fields.title.value = response.title || '';
      fields.title.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('Set title to:', response.title);
    }

    // Populate description
    if (fields.description) {
      fields.description.value = response.description || '';
      fields.description.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('Set description to:', response.description);
    }

    // Always set brand to 'imjacoblopez'
    if (fields.brand) {
      fields.brand.value = 'imjacoblopez';
      fields.brand.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('Set brand to: imjacoblopez');
    }

    console.log('Form fields populated successfully');

  } catch (error) {
    console.error('Failed to populate fields:', error);
    alert(`Failed to generate product content: ${error.message}`);
  }
}

// Helper function to extract product type from URL
function extractProductType(url) {
  const lowercase = url.toLowerCase();
  if (lowercase.includes('hoodie')) return 'HOOD';
  if (lowercase.includes('shirt')) return 'SHIRT';
  if (lowercase.includes('hat')) return 'HAT';
  return 'ITEM';
}

function injectPopulateButton() {
  console.log('Checking for modal drawer...');
  
  // Find the modal drawer
  const modalDrawer = document.querySelector('.DrawerModal.Modal');
  if (!modalDrawer) {
    console.log('Modal drawer not found');
    return;
  }

  // Find all Panel-footer elements within the modal
  const footers = modalDrawer.querySelectorAll('.Panel-footer');
  footers.forEach(footer => {
    if (footer.querySelector('.generate-product-button')) {
      return;
    }

    // Create the generate button
    const generateButton = document.createElement('button');
    generateButton.className = 'Button Button--primary generate-product-button';
    generateButton.tabIndex = '0';
    generateButton.type = 'button';
    generateButton.style.marginRight = '8px';
    
    const buttonLabel = document.createElement('span');
    buttonLabel.className = 'Button-label';
    buttonLabel.textContent = 'Generate Product';
    
    generateButton.appendChild(buttonLabel);
    
    // Add click handler
    generateButton.onclick = () => {
      console.log('Generate button clicked');
      try {
        handlePopulate();
      } catch (error) {
        console.log('Generation failed:', error);
      }
    };

    // Insert at the start of the footer
    footer.insertBefore(generateButton, footer.firstChild);
  });
}

// Update the observer to watch for view changes
function observeForModal() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check for new modal or view changes
          if (node.classList?.contains('DrawerModal') || 
              node.classList?.contains('ViewNavigator-view') ||
              node.classList?.contains('Panel-footer')) {
            injectPopulateButton();
          }
          
          // Also check children
          const modal = node.querySelector('.DrawerModal');
          const view = node.querySelector('.ViewNavigator-view');
          const footer = node.querySelector('.Panel-footer');
          if (modal || view || footer) {
            injectPopulateButton();
          }
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function createProgressWidget() {
  const widget = document.createElement('div');
  widget.className = 'post-progress-widget';
  widget.innerHTML = `
    <div class="progress-bar">
      <div class="progress-fill"></div>
    </div>
    <div class="progress-text">0/200 posts today</div>
  `;
  document.body.appendChild(widget);
  return widget;
}

function updateProgressBar() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem('postProgress') || '{}');
  
  // Reset if it's a new day
  if (stored.date !== today) {
    stored.date = today;
    stored.count = 0;
  }
  
  const widget = document.querySelector('.post-progress-widget') || createProgressWidget();
  const fill = widget.querySelector('.progress-fill');
  const text = widget.querySelector('.progress-text');
  
  const percentage = Math.min((stored.count / 200) * 100, 100);
  fill.style.width = `${percentage}%`;
  text.textContent = `${stored.count}/200 posts today`;
  
  localStorage.setItem('postProgress', JSON.stringify(stored));
}

function incrementPostCount() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem('postProgress') || '{}');
  
  if (stored.date !== today) {
    stored.date = today;
    stored.count = 0;
  }
  
  stored.count++;
  localStorage.setItem('postProgress', JSON.stringify(stored));
  updateProgressBar();
}

/**
 * Specialized function to set text in Twitter's Draft.js editor
 * This aims to handle Twitter's complex editing environment
 */
async function setTextInTwitterEditor(text) {
  console.log('📝 setTextInTwitterEditor - Starting specialized text insertion for Twitter');
  console.log('📝 setTextInTwitterEditor - Text to insert:', text);
  
  try {
    // First, try to find the Draft.js editor - using brute force approach to find all possible editors
    const possibleEditors = [
      document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]'),
      document.querySelector('.DraftEditor-root [contenteditable="true"]'),
      document.querySelector('[data-testid="tweetTextarea_0"]'),
      document.querySelector('[data-testid="tweetTextarea_1"]'),
      document.querySelector('#layers [contenteditable="true"]'),
      document.querySelector('[role="textbox"][contenteditable="true"]'),
      document.querySelector('[aria-label*="Tweet text"]'),
      document.querySelector('[aria-label*="Post text"]'),
      ...Array.from(document.querySelectorAll('[contenteditable="true"]')),
      ...Array.from(document.querySelectorAll('[role="textbox"]'))
    ].filter(Boolean);
    
    console.log('📝 setTextInTwitterEditor - Found', possibleEditors.length, 'possible editors');
    
    if (possibleEditors.length === 0) {
      throw new Error('Could not find any suitable text editor element');
    }
    
    // Get the most likely editor (visible in the current layer)
    const editableElement = possibleEditors[0];
    console.log('📝 setTextInTwitterEditor - Selected editor:', {
      tagName: editableElement.tagName,
      className: editableElement.className,
      id: editableElement.id,
      role: editableElement.getAttribute('role')
    });
    
    // APPROACH 1: Try using the Selection API to set text
    console.log('📝 setTextInTwitterEditor - Trying Selection API approach');
    try {
      // Focus and clear selection
      editableElement.focus();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create a selection in the editor
      const selection = window.getSelection();
      selection.selectAllChildren(editableElement);
      
      // Insert text with proper handling of newlines
      if (text.includes('\n')) {
        // For multi-line text, use insertHTML to preserve line breaks
        const htmlText = text.replace(/\n/g, '<br>');
        document.execCommand('insertHTML', false, htmlText);
      } else {
        // For single-line text, use the simpler insertText
        document.execCommand('insertText', false, text);
      }
      
      // Dispatch all possible events that Twitter might be listening for
      ['input', 'change', 'keydown', 'keyup', 'blur', 'focus'].forEach(eventType => {
        editableElement.dispatchEvent(new Event(eventType, { bubbles: true }));
      });
      
      // Dispatch a more specific input event
      editableElement.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
      
      console.log('📝 setTextInTwitterEditor - Selection API approach completed');
    } catch (selectionError) {
      console.error('❌ setTextInTwitterEditor - Selection API approach failed:', selectionError);
    }
    
    // APPROACH 2: Direct property manipulation 
    if (!editableElement.textContent.includes(text.substring(0, 5))) {
      console.log('📝 setTextInTwitterEditor - Trying direct property manipulation');
      try {
        editableElement.textContent = text;
        editableElement.innerHTML = text.replace(/\n/g, '<br>');
        
        ['input', 'change', 'keydown', 'keyup'].forEach(eventType => {
          editableElement.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
        
        console.log('📝 setTextInTwitterEditor - Direct property manipulation completed');
      } catch (propertyError) {
        console.error('❌ setTextInTwitterEditor - Direct property manipulation failed:', propertyError);
      }
    }
    
    // APPROACH 3: Use clipboard
    if (!editableElement.textContent.includes(text.substring(0, 5))) {
      console.log('📝 setTextInTwitterEditor - Trying clipboard approach');
      try {
        // Save current clipboard
        const originalClipboard = await navigator.clipboard.readText().catch(() => null);
        
        // Set our text to clipboard
        await navigator.clipboard.writeText(text);
        
        // Focus and select all text
        editableElement.focus();
        document.execCommand('selectAll', false, null);
        
        // Paste
        document.execCommand('paste', false);
        
        // Simulate paste event
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        
        editableElement.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          clipboardData,
          cancelable: true
        }));
        
        // Restore original clipboard if we had one
        if (originalClipboard) {
          setTimeout(() => {
            navigator.clipboard.writeText(originalClipboard).catch(() => {});
          }, 500);
        }
        
        console.log('📝 setTextInTwitterEditor - Clipboard approach completed');
      } catch (clipboardError) {
        console.error('❌ setTextInTwitterEditor - Clipboard approach failed:', clipboardError);
      }
    }
    
    // HACK: Force enable the Reply button after a short delay
    setTimeout(() => {
      console.log('📝 setTextInTwitterEditor - Checking tweet button status');
      const tweetButton = document.querySelector('[data-testid="tweetButton"]');
      
      if (tweetButton && tweetButton.getAttribute('aria-disabled') === 'true') {
        console.log('📝 setTextInTwitterEditor - Tweet button is disabled, applying force enable hack');
        
        // Remove disabled attributes
        tweetButton.removeAttribute('aria-disabled');
        tweetButton.removeAttribute('disabled');
        
        // Make sure the button is styled as enabled
        tweetButton.style.opacity = '1';
        tweetButton.style.cursor = 'pointer';
        
        // Add our own click handler that will bypass Twitter's disabled state
        if (!tweetButton.getAttribute('data-gemini-enhanced')) {
          tweetButton.setAttribute('data-gemini-enhanced', 'true');
          
          // Create a clone of the button to replace the original
          // This removes any event listeners that might be preventing clicks
          const newButton = tweetButton.cloneNode(true);
          tweetButton.parentNode.replaceChild(newButton, tweetButton);
          
          // Make absolutely sure our text is in the editor
          if (editableElement && !editableElement.textContent.includes(text.substring(0, 5))) {
            editableElement.textContent = text;
            editableElement.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          console.log('📝 setTextInTwitterEditor - Tweet button has been force-enabled');
        }
      } else if (tweetButton) {
        console.log('📝 setTextInTwitterEditor - Tweet button already enabled');
      } else {
        console.log('📝 setTextInTwitterEditor - Tweet button not found');
      }
    }, 1000);
    
    // Final check - if text is still not in the editor, notify the user
    setTimeout(() => {
      if (editableElement && !editableElement.textContent.includes(text.substring(0, 5))) {
        console.warn('⚠️ setTextInTwitterEditor - Text insertion may have failed, copying to clipboard');
        navigator.clipboard.writeText(text);
        alert('Text copied to clipboard. Please paste manually with Ctrl/Cmd+V');
      }
    }, 1500);
    
    return true;
  } catch (error) {
    console.error('❌ setTextInTwitterEditor - Fatal error:', error);
    // Final fallback - copy to clipboard
    await navigator.clipboard.writeText(text);
    alert('Text copied to clipboard. Please paste manually (Ctrl/Cmd+V)');
    return false;
  }
}
