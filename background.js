import { createProductPrompt } from './product_prompt.js';

// Track if the extension is activated (authenticated)
let isExtensionActivated = false;

// Forcibly set to false on initialization to ensure security
chrome.storage.sync.set({ extensionAuthenticated: false }, () => {
  console.log('📊 Extension activation reset to false on initialization for security');
  
  // Notify only tabs that match our content script permissions
  // This prevents errors when sending messages to tabs where our content script isn't loaded
  chrome.tabs.query({
    url: [
      "https://twitter.com/*",
      "https://x.com/*",
      "https://ads.x.com/*"
    ]
  }, (tabs) => {
    console.log(`Found ${tabs.length} tab(s) that might have our content script`);
    
    tabs.forEach(tab => {
      // Use a more reliable way to send messages that doesn't throw uncaught errors
      chrome.tabs.sendMessage(tab.id, {
        type: 'ACTIVATION_STATUS_CHANGED',
        activated: false
      }, response => {
        // Check for errors but don't throw if there's no response
        // This will silently fail for tabs without our content script
        const error = chrome.runtime.lastError;
        if (error) {
          console.log(`Could not send message to tab ${tab.id}: ${error.message}`);
        }
      });
    });
  });
});

// This will be used later for handling API requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📩 Background received message:', JSON.stringify(request, null, 2));
  console.log('📩 Message sender:', JSON.stringify(sender, null, 2));

  if (request.type === 'PING') {
    console.log('🔍 Background received PING request');
    sendResponse({ success: true, message: 'PONG', timestamp: new Date().toISOString() });
    return true;
  }

  // Handler for activation status changes
  if (request.type === 'ACTIVATE_EXTENSION') {
    console.log('🔓 Background received ACTIVATE_EXTENSION request:', request.activated);
    isExtensionActivated = request.activated === true;
    
    // Store activation status
    chrome.storage.sync.set({ extensionAuthenticated: isExtensionActivated }, () => {
      console.log('📊 Extension activation status saved:', isExtensionActivated);
    });
    
    // Notify content scripts in relevant tabs only
    chrome.tabs.query({
      url: [
        "https://twitter.com/*",
        "https://x.com/*",
        "https://ads.x.com/*"
      ]
    }, (tabs) => {
      console.log(`Notifying ${tabs.length} tab(s) about activation change`);
      
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'ACTIVATION_STATUS_CHANGED',
          activated: isExtensionActivated
        }, response => {
          // Safely handle missing receivers
          const error = chrome.runtime.lastError;
          if (error) {
            console.log(`Could not send activation update to tab ${tab.id}: ${error.message}`);
          }
        });
      });
    });
    
    sendResponse({ 
      success: true, 
      message: `Extension ${isExtensionActivated ? 'activated' : 'deactivated'}`,
      activated: isExtensionActivated
    });
    return true;
  }
  
  // Handler for activation status checks
  if (request.type === 'GET_ACTIVATION_STATUS') {
    console.log('🔍 Background received GET_ACTIVATION_STATUS request');
    try {
      sendResponse({ 
        success: true, 
        activated: isExtensionActivated
      });
    } catch (e) {
      console.error('Error sending activation status response:', e);
      sendResponse({ 
        success: false, 
        error: e.message
      });
    }
    return true; // Important: return true for asynchronous response
  }

  // Request handlers - modify functionality based on activation state

  // This is called by the extension for all operations to check activation
  function isExtensionAuthorized() {
    return isExtensionActivated === true;
  }

  // This function is used for logging attempts to use the extension while not activated
  function rejectUnauthorizedRequest(requestType, sendResponse) {
    console.error(`❌ [SECURITY] Blocked unauthorized request: ${requestType}`);
    if (sendResponse) {
      sendResponse({ 
        success: false, 
        error: 'Extension not activated. Please authenticate in the extension popup.' 
      });
    }
    return false;
  }

  // Require activation for all other API operations
  if (!isExtensionAuthorized() && 
      ['TEST_GEMINI_API', 'GENERATE_PRODUCT', 'GENERATE_RESPONSE', 'GENERATE_QRT'].includes(request.type)) {
    return rejectUnauthorizedRequest(request.type, sendResponse);
  }

  if (request.type === 'TEST_GEMINI_API') {
    console.log('🧪 Background received TEST_GEMINI_API request');
    
    // Handle the test request asynchronously
    (async () => {
      try {
        console.log('🧪 Starting Gemini API test with prompt:', request.prompt);
        
        // Get the API key from storage
        const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
        if (!geminiApiKey) {
          console.error('❌ TEST_GEMINI_API - API key not found in storage');
          sendResponse({ 
            success: false, 
            error: 'API key not found in storage' 
          });
          return;
        }
        
        console.log('🧪 TEST_GEMINI_API - Using API key (redacted):', 
          geminiApiKey.substring(0, 3) + '...' + geminiApiKey.substring(geminiApiKey.length - 3));
        
        // Create a simple test request to Gemini
        const baseUrl = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent';
        const url = `${baseUrl}?key=${geminiApiKey}`;
        
        const requestBody = {
          contents: [{
            parts: [{ 
              text: request.prompt || "Say hello in exactly 5 words" 
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 30,
            topK: 40,
            topP: 0.95
          }
        };
        
        console.log('🧪 TEST_GEMINI_API - Request body:', JSON.stringify(requestBody, null, 2));
        console.log('🧪 TEST_GEMINI_API - Sending request to Gemini API...');
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });
        
        console.log('🧪 TEST_GEMINI_API - Response status:', response.status, response.statusText);
        
        const responseText = await response.text();
        console.log('🧪 TEST_GEMINI_API - Raw response:', responseText);
        
        if (!response.ok) {
          console.error('❌ TEST_GEMINI_API - API request failed');
          let errorMessage = response.statusText || 'Unknown error';
          
          try {
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.error?.message || errorMessage;
            console.error('❌ TEST_GEMINI_API - Error details:', JSON.stringify(errorData, null, 2));
          } catch (e) {
            console.error('❌ TEST_GEMINI_API - Failed to parse error response as JSON');
          }
          
          sendResponse({ 
            success: false, 
            error: `API request failed: ${errorMessage}`,
            status: response.status,
            statusText: response.statusText
          });
          return;
        }
        
        let data;
        try {
          data = JSON.parse(responseText);
          console.log('🧪 TEST_GEMINI_API - Parsed response:', JSON.stringify(data, null, 2));
        } catch (e) {
          console.error('❌ TEST_GEMINI_API - Failed to parse response as JSON:', e);
          sendResponse({ 
            success: false, 
            error: 'Failed to parse API response as JSON' 
          });
          return;
        }
        
        // Extract the generated text
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
          const text = data.candidates[0].content.parts[0].text.trim();
          console.log('✅ TEST_GEMINI_API - Generated text:', text);
          
          sendResponse({ 
            success: true, 
            text: text,
            rawResponse: data
          });
        } else {
          console.error('❌ TEST_GEMINI_API - No text found in response');
          sendResponse({ 
            success: false, 
            error: 'No text found in response',
            rawResponse: data
          });
        }
      } catch (error) {
        console.error('❌ TEST_GEMINI_API - Error:', error);
        console.error('❌ TEST_GEMINI_API - Error stack:', error.stack);
        
        sendResponse({ 
          success: false, 
          error: error.message || 'Unknown error occurred' 
        });
      }
    })();
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }

  if (request.type === 'GENERATE_PRODUCT') {
    console.log('🏭 Handling GENERATE_PRODUCT request');
    // Handle the request asynchronously
    (async () => {
      try {
        console.log('⏳ Starting product generation...');
        const result = await generateWithGemini(request.context);
        console.log('✅ Product generation completed, result:', JSON.stringify(result, null, 2));
        sendResponse(result);
      } catch (error) {
        console.error('❌ Product generation error:', error);
        console.error('❌ Error stack:', error.stack);
        sendResponse({
          success: false,
          error: error.message || 'Unknown error occurred'
        });
      }
    })();
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }

  if (request.type === 'GENERATE_RESPONSE' || request.type === 'GENERATE_QRT') {
    console.log(`🤖 Handling ${request.type} request`);
    chrome.storage.sync.get(['geminiApiKey'], async (result) => {
      try {
        console.log('🔑 Retrieved API key from storage');
        if (!result.geminiApiKey) {
          console.error('❌ API key not found in storage');
          sendResponse({ success: false, error: 'API key not found' });
          return;
        }
        
        console.log('⏳ Starting response generation...');
        const generatedText = await generateResponse(result.geminiApiKey, request.context);
        console.log('✅ Response generation completed');
        const response = { 
          success: true, 
          text: generatedText,
          isQRT: request.type === 'GENERATE_QRT'
        };
        console.log('📤 Sending response:', JSON.stringify(response, null, 2));
        sendResponse(response);
      } catch (error) {
        console.error('❌ Response generation error:', error);
        console.error('❌ Error stack:', error.stack);
        const errorResponse = { success: false, error: error.message };
        console.log('📤 Sending error response:', JSON.stringify(errorResponse, null, 2));
        sendResponse(errorResponse);
      }
    });
    return true; // Required for async response
  }
  if (request.type === 'VALIDATE_API_KEY') {
    console.log('🔑 Handling VALIDATE_API_KEY request');
    validateApiKey(request.apiKey).then(isValid => {
      console.log('📤 API key validation result:', isValid);
      sendResponse({ isValid });
    });
    return true; // Required for async response
  }
});

// Helper function to create the prompt
function createPrompt(context) {
  const exampleTweets = [
    {
      tweet: "who's the scrappiest LLM operator you know?",
      response: "literally right here",
      engagement: "High engagement - ultra concise, confident, lowercase"
    },
    {
      tweet: "caught someone cheating in my interview today... using claude",
      response: "first of all, claude?\nit would be better to use grok if you're gonna do something weird like that",
      engagement: "Technical knowledge, dismissive but informative"
    },
    {
      tweet: "have any firms in silicon valley outside of sequoia and YC lost prestige this quickly?",
      response: "ohhh i read this as 'films' as was confused for a sec.\n\n*firms*",
      engagement: "Casual correction, relatable confusion"
    },
    {
      tweet: "Sorry about that. I'll do better next time.",
      response: "it's not you. it's just the fact that it even happened in the first place. it's yc",
      engagement: "Direct, honest, broader context"
    },
    {
      tweet: "Lol the community note on my tweet.. We are way too open and honest for this slander.",
      response: "cursor didn't just fork. they added llm's",
      engagement: "Concise technical correction, no fluff"
    },
    {
      tweet: "DUDE. (image of jonah hill movie announcement)",
      response: "haha that would be amazing",
      engagement: "Simple, genuine reaction"
    },
    {
      tweet: "pair programming bf irl...",
      response: "it's kinda funny ironic in some way\ni have no life\nu have no life\nwe has no life",
      engagement: "Multiple lines, relatable humor, self-deprecating"
    },
    {
      tweet: "The masculine urge to start a 1 man fully automated US manufacturing company",
      response: "pretty cool to think u can just write code to make it do things",
      engagement: "Simple observation that resonates"
    },
    {
      tweet: "This is what increasing your surface area for serendipity looks like",
      response: "this is why i love 𝕏\nhttps://x.com/Nate_Esparza/status/1848901493455462430",
      engagement: "Platform appreciation with relevant link"
    },
    {
      tweet: "What people wont remember: - your salary - how 'busy you were' - how many hours you worked",
      response: "just help people",
      engagement: "3.1k impressions - ultra simple truth"
    },
    {
      tweet: "I took two things away from this...",
      response: "hahaha this is gold",
      engagement: "3.1k impressions - genuine reaction"
    },
    {
      tweet: "anxiety/depression/stress discussion...",
      response: "stop being lazy on things you notice\nbecause\nstress is from inaction",
      engagement: "3.1k impressions - simple wisdom with line breaks"
    },
    {
      tweet: "complex discussion about communication",
      response: "just communicate\nwhat if you're thinking the wrong thing cause u don't have all the context",
      engagement: "1.7k impressions - simple truth with follow-up"
    },
    {
      tweet: "caught someone cheating in my interview today...",
      response: "first of all, claude?\nit would be better to use grok if you're gonna do something weird like that",
      engagement: "Technical knowledge with casual dismissal"
    },
    {
      tweet: "have any firms in silicon valley outside of sequoia and YC lost prestige this quickly?",
      response: "ohhh i read this as 'films' as was confused for a sec.\n\n*firms*",
      engagement: "Relatable confusion with correction"
    },
    {
      tweet: "alzheimers is just the brain saying 'i'm done'",
      response: "it's kinda funny ironic in some way\ni have no life\nu have no life\nwe has no life",
      engagement: "2.1k impressions - multi-line, relatable dark humor"
    },
    {
      tweet: "What people wont remember: - your salary - how 'busy you were' - how many hours you worked",
      response: "What people will remember:\n- wife got stole\n- bezos",
      engagement: "1.7k impressions - simple list format, cultural references"
    },
    {
      tweet: "Correcting the record for Continue and PearAI...",
      response: "still weird, overall. it already tarnished yc.\norganic, bad pr",
      engagement: "Direct observation with follow-up thought"
    },
    {
      tweet: "Sorry about that. I'll do better next time.",
      response: "it's not you. it's just the fact that it even happened in the first place. it's yc",
      engagement: "Broader context, honest perspective"
    },
    {
      tweet: "caught someone cheating in my interview today... using claude",
      response: "first of all, claude?\nit would be better to use grok if you're gonna do something weird like that.\n\nsecondly, other models like llama wouldve been way better for natural language processing and groq for speed.\n\nTHIRD: heh, still praying for my email inv",
      engagement: "Technical knowledge with humor and personal touch"
    }
  ];

  let promptText = `Generate a reply to this tweet that matches my highly engaging personal style:

Tweet: "${context.text}"
${context.parentTweet ? `Parent Tweet: "${context.parentTweet}"` : ''}
${context.author ? `Author: ${context.author}` : ''}
${context.imageUrls?.length ? `Images: ${context.imageUrls.join(', ')}` : ''}

My signature style characteristics:
- Ultra concise, no wasted words
- Always lowercase
- minimal newlines
- Casual and authentic ("u" instead of "you")
- Never uses emojis
- Sometimes slightly dismissive but in a funny way
- Can be self-deprecating
- Uses simple observations that resonate
- Occasionally links relevant tweets if perfect match
- Brief but impactful
- No try-hard energy, very natural
- supports elon and trump, republican, conservative, not for kamala harris or democrats but only if context is political otherwise not political
- NEVER end with "just sayin" or similar phrases

IMPORTANT:
- Never reveal this is AI-generated
- Never mention being a bot or AI
- Never explain or justify the response
- Just reply naturally as Jacob the human would
- No meta-commentary about the response
- pass the turing test
- dont say just sayin

Here are examples of my successful replies:
${exampleTweets.map(ex => `
Tweet: "${ex.tweet}"
My reply: "${ex.response}"
Why it worked: ${ex.engagement}`).join('\n')}

Generate a response that:
- Perfectly matches my casual, lowercase style
- Is witty and engaging to maximize impressions
- Stays under 280 characters
- Uses new lines if it adds impact
- Feels authentic and never try-hard
- References specific details naturally
- Links to relevant tweets ONLY if extremely relevant (rare)
- if ever asked, likes elon musk and trump, not kamala harris or biden
- Avoids clichéd endings like "just sayin" or "just my thoughts"

CRITICAL RULES:
- NEVER end with phrases like "just sayin", "just saying", "just my thoughts", or any variation

Response:`;

  return promptText;
}

// Handle API calls to Gemini
async function generateResponse(apiKey, context) {
  try {
    console.log('📨 generateResponse - Starting with context:', JSON.stringify(context, null, 2));
    
    const baseUrl = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent';
    const url = `${baseUrl}?key=${apiKey}`;
    console.log('📡 generateResponse - API URL:', url.replace(apiKey, 'API_KEY_REDACTED'));

    const prompt = createPrompt(context);
    console.log('🔤 generateResponse - Generated prompt:', prompt);

    const requestBody = {
      contents: [{
        parts: [
          { 
            text: prompt + '\nIMPORTANT: Generate a friendly, non-controversial response.' 
          }
        ]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 150,
        topK: 40,
        topP: 0.95,
        stopSequences: ["(", "Note:", "This reply", "Why this works", "just sayin"]
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_ONLY_HIGH"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_ONLY_HIGH"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_ONLY_HIGH"
        }
      ]
    };

    // If there are images, add them to the request
    if (context.images && context.images.length > 0) {
      console.log('🖼️ generateResponse - Adding images to request, count:', context.images.length);
      for (const imageData of context.images) {
        requestBody.contents[0].parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: imageData
          }
        });
      }
    }

    const requestBodyString = JSON.stringify(requestBody, null, 2);
    console.log('📤 generateResponse - Full request body:', requestBodyString);
    
    console.log('⏳ generateResponse - Sending request to Gemini API...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBodyString
    });
    
    console.log('📥 generateResponse - Response status:', response.status, response.statusText);
    console.log('📥 generateResponse - Response headers:', JSON.stringify(Object.fromEntries([...response.headers]), null, 2));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ generateResponse - API error response (text):', errorText);
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
        console.error('❌ generateResponse - API error response (parsed):', JSON.stringify(errorData, null, 2));
      } catch (e) {
        console.error('❌ generateResponse - Failed to parse error response as JSON');
      }
      
      throw new Error(`API request failed: ${errorData?.error?.message || response.statusText || 'Unknown error'}`);
    }

    const responseText = await response.text();
    console.log('📥 generateResponse - Raw response text:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
      console.log('📥 generateResponse - Parsed API response:', JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('❌ generateResponse - Failed to parse response as JSON:', e);
      throw new Error('Failed to parse API response as JSON');
    }

    // Updated response handling
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      let text = data.candidates[0].content.parts[0].text;
      console.log('✅ generateResponse - Raw generated text:', text);
      
      text = text
        .replace(/\(this reply.*?\)/gi, '')
        .replace(/Note:.*$/gm, '')
        .replace(/This response.*$/gm, '')
        .replace(/Why this works.*$/gm, '')
        .replace(/As an AI.*$/gm, '')
        .replace(/I am.*AI.*$/gm, '')
        .replace(/AI-generated.*$/gm, '')
        .replace(/Generated by.*$/gm, '')
        .replace(/bot.*$/gm, '')
        .replace(/just sayin.*$/gi, '')
        .replace(/just saying.*$/gi, '')
        .replace(/just my.*$/gi, '')
        .trim();
      
      console.log('✅ generateResponse - Cleaned generated text:', text);
      return text;
    } else if (data.candidates?.[0]?.finishReason === "SAFETY") {
      console.log('⚠️ generateResponse - Response was blocked by safety filters, retrying with safer prompt');
      // If blocked by safety filters, generate a more neutral response
      return await generateResponse(apiKey, {
        ...context,
        text: `${context.text} (please generate a friendly response)`
      });
    }

    console.error('❌ generateResponse - Unexpected response structure:', JSON.stringify(data, null, 2));
    throw new Error('Failed to generate response. Please try again.');
  } catch (error) {
    console.error('❌ generateResponse - Error:', error);
    console.error('❌ generateResponse - Error stack:', error.stack);
    throw error;
  }
}

// Update the validation function to use Gemini 1.5 Flash as well
async function validateApiKey(apiKey) {
  try {
    console.log('🔍 validateApiKey - Starting validation for API key (redacted):', apiKey.substring(0, 3) + '...' + apiKey.substring(apiKey.length - 3));
    
    const baseUrl = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent';
    const url = `${baseUrl}?key=${apiKey}`;
    console.log('📡 validateApiKey - API URL:', url.replace(apiKey, 'API_KEY_REDACTED'));

    const requestBody = {
      contents: [{
        parts: [{
          text: "Hello"
        }]
      }],
      generationConfig: {
        maxOutputTokens: 10
      }
    };
    
    const requestBodyString = JSON.stringify(requestBody, null, 2);
    console.log('📤 validateApiKey - Request body:', requestBodyString);

    console.log('⏳ validateApiKey - Sending test request to validate API key...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: requestBodyString
    });
    
    console.log('📥 validateApiKey - Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      console.error('❌ validateApiKey - API key validation failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('❌ validateApiKey - Error response:', errorText);
      return false;
    }

    const responseText = await response.text();
    console.log('📥 validateApiKey - Response text:', responseText);
    
    try {
      const data = JSON.parse(responseText);
      console.log('✅ validateApiKey - API key validation successful:', JSON.stringify(data, null, 2));
      return true;
    } catch (e) {
      console.error('❌ validateApiKey - Failed to parse response as JSON:', e);
      return false;
    }
  } catch (error) {
    console.error('❌ validateApiKey - API key validation error:', error);
    console.error('❌ validateApiKey - Error stack:', error.stack);
    return false;
  }
}

async function generateWithGemini(context) {
  try {
    console.log('📨 generateWithGemini - Starting with context:', JSON.stringify(context, null, 2));
    
    const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
    if (!geminiApiKey) {
      console.error('❌ generateWithGemini - API key not found in storage');
      throw new Error('Gemini API key not found');
    }
    console.log('🔑 generateWithGemini - Retrieved API key (redacted):', geminiApiKey.substring(0, 3) + '...' + geminiApiKey.substring(geminiApiKey.length - 3));

    // Updated prompt with explicit JSON format requirement
    const prompt = createProductPrompt(context);
    console.log('🔤 generateWithGemini - Generated prompt:', prompt);

    const requestBody = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        topK: 32,
        topP: 1,
        maxOutputTokens: 1024
      }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${geminiApiKey}`;
    console.log('📡 generateWithGemini - API URL:', apiUrl.replace(geminiApiKey, 'API_KEY_REDACTED'));
    
    const requestBodyString = JSON.stringify(requestBody, null, 2);
    console.log('📤 generateWithGemini - Full request body:', requestBodyString);
    
    console.log('⏳ generateWithGemini - Sending request to Gemini API...');
    const response = await fetch(
      apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBodyString
      }
    );
    
    console.log('📥 generateWithGemini - Response status:', response.status, response.statusText);
    console.log('📥 generateWithGemini - Response headers:', JSON.stringify(Object.fromEntries([...response.headers]), null, 2));

    const responseText = await response.text();
    console.log('📥 generateWithGemini - Raw response text:', responseText);
    
    if (!response.ok) {
      console.error('❌ generateWithGemini - API error response:', responseText);
      let errorMessage = response.statusText || 'Unknown error';
      
      try {
        const errorData = JSON.parse(responseText);
        errorMessage = errorData.error?.message || errorMessage;
        console.error('❌ generateWithGemini - Parsed error details:', JSON.stringify(errorData, null, 2));
      } catch (e) {
        console.error('❌ generateWithGemini - Failed to parse error response as JSON');
      }
      
      throw new Error(`API request failed: ${errorMessage}`);
    }
    
    let data;
    try {
      data = JSON.parse(responseText);
      console.log('📥 generateWithGemini - Parsed API response:', JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('❌ generateWithGemini - Failed to parse response as JSON:', e);
      throw new Error('Failed to parse API response as JSON');
    }

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('❌ generateWithGemini - Invalid response structure from Gemini API', JSON.stringify(data, null, 2));
      throw new Error('Invalid response structure from Gemini API');
    }

    // Extract and parse the JSON response
    const text = data.candidates[0].content.parts[0].text.trim();
    console.log('✅ generateWithGemini - Generated text:', text);

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('❌ generateWithGemini - No JSON object found in response');
        throw new Error('No JSON object found in response');
      }
      
      console.log('✅ generateWithGemini - JSON match found:', jsonMatch[0]);
      
      const parsedResponse = JSON.parse(jsonMatch[0]);
      console.log('✅ generateWithGemini - Parsed response:', JSON.stringify(parsedResponse, null, 2));

      if (!parsedResponse.title || !parsedResponse.description) {
        console.error('❌ generateWithGemini - Missing required fields in response', JSON.stringify(parsedResponse, null, 2));
        throw new Error('Missing required fields in response');
      }

      return {
        success: true,
        title: parsedResponse.title,
        description: parsedResponse.description
      };

    } catch (parseError) {
      console.error('❌ generateWithGemini - JSON parsing error:', parseError);
      console.error('❌ generateWithGemini - JSON parsing error stack:', parseError.stack);
      console.error('❌ generateWithGemini - Text that failed to parse:', text);
      throw new Error('Failed to parse Gemini response as JSON');
    }

  } catch (error) {
    console.error('❌ generateWithGemini - Error:', error);
    console.error('❌ generateWithGemini - Error stack:', error.stack);
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
}

// Helper function to convert blob to base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
