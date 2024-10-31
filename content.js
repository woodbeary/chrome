async function extractPostContext(postElement) {
  console.log('Extracting context from:', postElement);

  // Get main tweet text
  const tweetText = postElement.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';

  // Get quoted tweet using more specific selectors
  const quotedTweetContainer = postElement.querySelector('div.css-175oi2r.r-adacv.r-1udh08x.r-1kqtdi0.r-1867qdf.r-rs99b7.r-o7ynqc.r-6416eg.r-1ny4l3l.r-1loqt21');
  let quotedTweet = '';
  let quotedAuthor = '';

  if (quotedTweetContainer) {
    // Try to get the quoted tweet text
    const quotedTextElement = quotedTweetContainer.querySelector('[data-testid="tweetText"]');
    if (quotedTextElement) {
      quotedTweet = quotedTextElement.textContent.trim();
    }

    // Try to get the quoted tweet author
    const quotedAuthorElement = quotedTweetContainer.querySelector('[data-testid="User-Name"]');
    if (quotedAuthorElement) {
      quotedAuthor = quotedAuthorElement.textContent.trim();
    }
  }

  // Combine text, preserving original formatting
  let fullText = tweetText;
  if (quotedTweet) {
    fullText += `\nQuoted Tweet${quotedAuthor ? ` from ${quotedAuthor}` : ''}: "${quotedTweet}"`;
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

  // More robust author extraction
  const authorElement = postElement.querySelector(':scope > div [data-testid="User-Name"]') || 
                       postElement.querySelector(':scope > div [data-testid="author-name"]');
  const authorName = authorElement?.textContent?.trim() || '';
  
  console.log('Found author:', authorName);

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
    parentTweet: quotedTweet,
    quotedAuthor: quotedAuthor || '',
    images: images.length > 0 ? images : null,
    imageUrls: Array.from(imageElements).map(img => img.src),
    timestamp: new Date().toISOString()
  };

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

// Extracting context from the tweet
function extractContext(articleElement) {
  const tweetTextElement = articleElement.querySelector('[data-testid="tweetText"]');
  const authorElement = articleElement.querySelector('[data-testid="User-Name"]');
  const parentTweetElement = articleElement.closest('[role="article"]').previousElementSibling?.querySelector('[data-testid="tweetText"]');

  const text = tweetTextElement ? tweetTextElement.innerText : '';
  const author = authorElement ? authorElement.innerText : '';
  const parentTweet = parentTweetElement ? parentTweetElement.innerText : '';

  return {
    text,
    author,
    parentTweet,
    images: null,
    imageUrls: [],
    timestamp: new Date().toISOString()
  };
}

// Example usage
const articleElement = document.querySelector('article[role="article"]');
const context = extractContext(articleElement);
console.log('Final extracted context:', context);
