// Function to create a product analysis prompt
export function createProductPrompt(context) {
  return `Analyze the following tweet about a product or business and create a JSON response with title and description:

Tweet: "${context.text}"
${context.parentTweet ? `Parent Tweet: "${context.parentTweet}"` : ''}
${context.author ? `Author: ${context.author}` : ''}

Please generate a JSON object with the following structure:
{
  "title": "A concise title that captures the main product or business idea",
  "description": "A brief description of what makes this product or business interesting"
}

IMPORTANT: The response MUST be in valid JSON format.
`;
} 