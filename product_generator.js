async function generateProductContent(imageUrl) {
    const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
    
    if (!geminiApiKey) {
      throw new Error('Please set your Gemini API key in the extension popup');
    }
  
    // Extract product type from URL (assuming it contains keywords)
    const type = extractProductType(imageUrl);
    
    const context = {
      imageUrl,
      type,
      timestamp: new Date().toISOString()
    };
  
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_PRODUCT',
      context
    });
  
    if (!response.success) {
      throw new Error(response.error);
    }
  
    return {
      productId: response.productId,
      title: response.title,
      description: response.description,
      brand: 'imjacoblopez' // Always constant
    };
  }
  
  function extractProductType(url) {
    const lowercase = url.toLowerCase();
    if (lowercase.includes('hoodie')) return 'hoodie';
    if (lowercase.includes('shirt')) return 'shirt';
    if (lowercase.includes('hat')) return 'hat';
    return 'apparel';
  }
  
  // Inject the populate button
  function injectPopulateButton() {
    console.log('Checking URL:', window.location.href);
    if (!window.location.href.includes('ads.x.com/shopping_manager/catalog')) {
      console.log('Not on catalog page, skipping button injection');
      return;
    }
  
    console.log('Looking for image input field...');
    const imageInput = document.querySelector('input[type="text"][placeholder*="URL"]');
    console.log('Image input found:', imageInput);
  
    if (!imageInput || imageInput.hasAttribute('data-product-processed')) {
      console.log('Input already processed or not found');
      return;
    }
  
    console.log('Processing image input...');
    imageInput.setAttribute('data-product-processed', 'true');
  
    // Create the button
    console.log('Creating generate button...');
    const button = document.createElement('button');
    button.textContent = 'Generate Product';
    button.className = 'Button Button--primary Button--small';
    button.style.cssText = `
      margin-left: 8px;
      padding: 8px 16px;
      border-radius: 4px;
      background-color: #1DA1F2;
      color: white;
      border: none;
      cursor: pointer;
    `;
  
    // Add click handler
    button.onclick = async () => {
      console.log('Generate button clicked');
      handlePopulate(imageInput);
    }
  
    // Insert after the input
    console.log('Appending button to parent:', imageInput.parentNode);
    imageInput.parentNode.appendChild(button);
  }
  
  async function handlePopulate(imageInput) {
    console.log('Starting population process');
    const imageUrl = imageInput.value.trim();
    console.log('Image URL:', imageUrl);
  
    if (!imageUrl) {
      console.log('No image URL provided');
      alert('Please enter an image URL first');
      return;
    }
  
    try {
      console.log('Generating content...');
      const content = await generateProductContent(imageUrl);
      console.log('Generated content:', content);
      
      // Updated selectors for form fields
      const fields = {
        title: '.Panel-body .Grid--withGutter input[placeholder*="title"]',
        description: '.Panel-body .Grid--withGutter textarea',
        brand: '.Panel-body .Grid--withGutter input[placeholder*="brand"]'
      };
  
      // Fill in each field
      for (const [key, selector] of Object.entries(fields)) {
        console.log(`Looking for ${key} field with selector: ${selector}`);
        const element = document.querySelector(selector);
        console.log(`Found element for ${key}:`, element);
        
        if (element) {
          element.value = content[key] || (key === 'brand' ? 'imjacoblopez' : '');
          element.dispatchEvent(new Event('input', { bubbles: true }));
          console.log(`Set ${key} value to:`, element.value);
        }
      }
  
    } catch (error) {
      console.error('Failed to populate fields:', error);
      alert('Failed to populate fields. Please try again.');
    }
  }
  
  // Initialize with a mutation observer to handle dynamic content
  function initialize() {
    console.log('Initializing product generator...');
    
    // Initial check
    injectPopulateButton();
  
    // Set up mutation observer
    const observer = new MutationObserver((mutations) => {
      console.log('DOM mutation detected');
      injectPopulateButton();
    });
  
    console.log('Setting up mutation observer');
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  // Start the extension
  console.log('Starting product generator extension');
  initialize();
  
  // Re-run initialization when URL changes
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('URL changed, reinitializing...');
      initialize();
    }
  }).observe(document, { subtree: true, childList: true });