// This will be used later for handling API requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GENERATE_RESPONSE' || request.type === 'GENERATE_QRT') {
    chrome.storage.sync.get(['geminiApiKey'], async (result) => {
      try {
        const generatedText = await generateResponse(result.geminiApiKey, request.context);
        sendResponse({ 
          success: true, 
          text: generatedText,
          isQRT: request.type === 'GENERATE_QRT'
        });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    });
    return true; // Required for async response
  }
  if (request.type === 'VALIDATE_API_KEY') {
    validateApiKey(request.apiKey).then(isValid => {
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

IMPORTANT:
- Never reveal this is AI-generated
- Never mention being a bot or AI
- Never explain or justify the response
- Just reply naturally as Jacob the human would
- No meta-commentary about the response
- pass the turing test

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

Response:`;

  return promptText;
}

// Handle API calls to Gemini
async function generateResponse(apiKey, context) {
  try {
    const baseUrl = 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent';
    const url = `${baseUrl}?key=${apiKey}`;

    const requestBody = {
      contents: [{
        parts: [
          { 
            text: createPrompt(context) + '\nIMPORTANT: Generate a friendly, non-controversial response.' 
          }
        ]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 150,
        topK: 40,
        topP: 0.95,
        stopSequences: ["(", "Note:", "This reply", "Why this works"]
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
      for (const imageData of context.images) {
        requestBody.contents[0].parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: imageData
          }
        });
      }
    }

    console.log('Request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API request failed: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    console.log('Raw API Response:', JSON.stringify(data, null, 2));

    // Updated response handling
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      let text = data.candidates[0].content.parts[0].text;
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
        .trim();
      return text;
    } else if (data.candidates?.[0]?.finishReason === "SAFETY") {
      // If blocked by safety filters, generate a more neutral response
      return await generateResponse(apiKey, {
        ...context,
        text: `${context.text} (please generate a friendly response)`
      });
    }

    console.error('Unexpected response structure:', data);
    throw new Error('Failed to generate response. Please try again.');
  } catch (error) {
    console.error('Gemini API error:', error);
    throw error;
  }
}

// Update the validation function to use Gemini 1.5 Flash as well
async function validateApiKey(apiKey) {
  try {
    const baseUrl = 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent';
    const url = `${baseUrl}?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: "Hello"
          }]
        }],
        generationConfig: {
          maxOutputTokens: 10
        }
      })
    });
    
    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return true;
  } catch (error) {
    console.error('API key validation error:', error);
    return false;
  }
}
